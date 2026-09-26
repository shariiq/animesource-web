import { z } from 'zod'
import { Redis } from '@upstash/redis'
import { serverSecret } from '../../lib/serverSecret'
import { clientWeekId } from '../../lib/proofOfWork'
import {
  attestationDigest,
  countLeadingZeroBits,
  fromBase64Url,
  hmacSha256,
  powSolutionPreimage,
  toBase64Url,
} from '../../lib/proofOfWork'

/**
 * Proof-of-work session issuance (ADR 0007). Server-only: the minting secret
 * never leaves configuration. Challenges are stateless HMAC-signed blobs
 * (cheap to mint and verify, so verification itself cannot be DoS'd);
 * single-use is enforced through a spent-challenge store, which is Redis in
 * production and intentionally absent in development (dev challenges stay
 * reusable inside their freshness window — never rely on single-use there).
 */

export const POW_CHALLENGE_TTL_SECONDS = 5 * 60
export const POW_DEFAULT_DIFFICULTY = 20
export const POW_MIN_DIFFICULTY = 1
export const POW_MAX_DIFFICULTY = 30
/** Challenge issuance budget per IP per minute: minting is one HMAC, but an
 * unbounded tap lets attackers stockpile fresh challenges. */
export const POW_CHALLENGE_BUDGET_PER_MINUTE = 60
/** Exchange attempts per IP per minute: verification is one hash, so this
 * only bounds Redis writes, not legitimate retries. */
export const POW_EXCHANGE_BUDGET_PER_MINUTE = 20

const textEncoder = new TextEncoder()
const MAX_CHALLENGE_LENGTH = 512
/** Automated sessions rot fast: re-verification is transparent, so a short
 * leash prices farms continuously without bothering real browsers. */
export const POW_SHORT_SESSION_TTL_SECONDS = 20 * 60
/** Budget hits pre-burned on a suspicious exchange: enough to push the next
 * challenges from the same network into the escalation tiers. */
export const POW_SUSPICIOUS_BURN_AMOUNT = 30

const attestationSchema = z.object({
  webdriver: z.boolean().nullable(),
  userAgent: z.string().max(256).nullable(),
  plugins: z.number().int().min(0).nullable(),
  languages: z.number().int().min(0).nullable(),
  hardwareConcurrency: z.number().int().min(0).nullable(),
  screenWidth: z.number().int().min(0).nullable(),
  screenHeight: z.number().int().min(0).nullable(),
  touchPoints: z.number().int().min(0).nullable(),
  mobile: z.boolean().nullable(),
  av: z.number().int().min(0).nullable(),
  cw: z.string().regex(/^\d{4}W\d{2}$/).nullable(),
}).strict()

const exchangeBodySchema = z.object({
  challenge: z.string().min(1).max(MAX_CHALLENGE_LENGTH),
  solution: z.object({ nonce: z.number().int().min(0) }).strict(),
  attestation: attestationSchema,
}).strict()

export type PowExchangeBody = z.infer<typeof exchangeBodySchema>

/**
 * Client-week freshness: a hardcoded attestation rots within weeks while the
 * web client is always current. Null is allowed (unverifiable, not guilty);
 * a present-but-stale week fails closed with upgrade semantics.
 */
export function clientWeekInWindow(week: string | null, nowMs: number): boolean {
  if (week === null) return true
  if (!/^\d{4}W\d{2}$/.test(week)) return false
  const window = [-7, 0, 7].map((offsetDays) => clientWeekId(nowMs + offsetDays * 86_400_000))
  return window.includes(week)
}

export function parseExchangeBody(raw: unknown): PowExchangeBody | null {
  const parsed = exchangeBodySchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/** Operator-tunable difficulty in leading zero bits; each bit doubles the work. */
export function powDifficulty(): number {
  const parsed = Number.parseInt(process.env.ANISOURCE_POW_DIFFICULTY ?? '', 10)
  if (!Number.isFinite(parsed)) return POW_DEFAULT_DIFFICULTY
  return Math.min(POW_MAX_DIFFICULTY, Math.max(POW_MIN_DIFFICULTY, Math.trunc(parsed)))
}

export interface ChallengeStore {
  /** Atomically spend one challenge id; false means already spent. */
  claim(id: string, ttlSeconds: number): Promise<boolean>
  /** Allow `limit` hits per window; the count drives difficulty escalation. */
  hitBudget(key: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; count: number }>
  /** Pre-burn budget hits (abuse pricing); never blocks on its own. */
  burnBudget(key: string, amount: number, windowSeconds: number): Promise<void>
}

function redisChallengeStore(redis: Redis): ChallengeStore {
  return {
    claim: async (id, ttlSeconds) => {
      const stored = await redis.set(`anisource:pow:${id}`, '1', { nx: true, ex: ttlSeconds })
      return stored === 'OK'
    },
    hitBudget: async (key, limit, windowSeconds) => {
      const count = await redis.incr(`anisource:pow:budget:${key}`)
      if (count === 1) await redis.expire(`anisource:pow:budget:${key}`, windowSeconds)
      return { allowed: count <= limit, count }
    },
    burnBudget: async (key, amount, windowSeconds) => {
      await redis.incrby(`anisource:pow:budget:${key}`, amount)
      await redis.expire(`anisource:pow:budget:${key}`, windowSeconds)
    },
  }
}

/**
 * Null store outside production without Redis configuration: development
 * challenges are reusable inside their window and unbudgeted. Production
 * callers must fail closed on null (fail open would silently drop
 * single-use and budgets exactly where abuse pays).
 */
export function challengeStore(): ChallengeStore | null {
  const env = typeof process === 'undefined' ? undefined : process.env
  const url = env?.UPSTASH_REDIS_REST_URL
  const token = env?.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) return null
  } catch {
    return null
  }
  return redisChallengeStore(new Redis({ url, token, retry: false }))
}

function ipBinding(ip: string | null, secret: string): string {
  const digest = hmacSha256(textEncoder.encode(secret), textEncoder.encode(ip ?? 'unknown'))
  return [...digest.slice(0, 8)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export interface PowChallenge {
  challenge: string
  difficulty: number
  expiresIn: number
}

/**
 * Difficulty under pressure: networks burning through their challenge budget
 * get harder puzzles within the same minute window, at zero extra round
 * trips (the count rides along with the budget check). A lone browser does
 * one challenge per session and never leaves the base tier; +2/+4 bits
 * quadruple/cap the cost for whoever is hammering issuance.
 */
export function escalatedDifficulty(baseDifficulty: number, budgetCount: number): number {
  if (budgetCount > 45) return Math.min(POW_MAX_DIFFICULTY, baseDifficulty + 4)
  if (budgetCount > 30) return Math.min(POW_MAX_DIFFICULTY, baseDifficulty + 2)
  return baseDifficulty
}

/** Mint a stateless challenge bound to the requesting network. */
export function mintPowChallenge(ip: string | null, nowSeconds: number, difficulty: number = powDifficulty()): PowChallenge | null {
  const secret = serverSecret()
  if (!secret) return null
  const now = Math.floor(nowSeconds)
  const id = toBase64Url(crypto.getRandomValues(new Uint8Array(16)))
  const exp = now + POW_CHALLENGE_TTL_SECONDS
  const binding = ipBinding(ip, secret)
  const tag = toBase64Url(hmacSha256(
    textEncoder.encode(secret),
    textEncoder.encode(`pow-challenge-v1:${id}:${exp}:${difficulty}:${binding}`),
  ))
  return { challenge: `${id}.${exp}.${difficulty}.${binding}.${tag}`, difficulty, expiresIn: POW_CHALLENGE_TTL_SECONDS }
}

export type PowRedeemResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'expired' | 'spent' | 'misconfigured' }

function tagsEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let diff = 0
  for (let index = 0; index < left.length; index += 1) diff |= left[index]! ^ right[index]!
  return diff === 0
}

/**
 * Verify a solution and spend the challenge. The solution must satisfy the
 * preimage bound to the submitted attestation — a solve cannot be cut from
 * one attestation and pasted onto another. Pure except for the spend: pass a
 * null store only in development, where challenges stay reusable.
 */
export async function redeemPowChallenge(
  challenge: string,
  nonce: number,
  attestation: z.infer<typeof attestationSchema>,
  ip: string | null,
  store: ChallengeStore | null,
  nowSeconds: number,
): Promise<PowRedeemResult> {
  const secret = serverSecret()
  if (!secret) return { ok: false, reason: 'misconfigured' }
  if (!challenge || challenge.length > MAX_CHALLENGE_LENGTH) return { ok: false, reason: 'invalid' }
  const parts = challenge.split('.')
  if (parts.length !== 5) return { ok: false, reason: 'invalid' }
  const id = parts[0] ?? ''
  const expRaw = parts[1] ?? ''
  const difficultyRaw = parts[2] ?? ''
  const binding = parts[3] ?? ''
  const tag = parts[4] ?? ''
  if (!id || !expRaw || !difficultyRaw || !binding || !tag) return { ok: false, reason: 'invalid' }
  if (!/^\d{1,20}$/.test(expRaw) || !/^\d{1,3}$/.test(difficultyRaw)) return { ok: false, reason: 'invalid' }
  const exp = Number(expRaw)
  const difficulty = Number(difficultyRaw)
  const now = Math.floor(nowSeconds)
  if (!Number.isSafeInteger(exp) || exp <= now) return { ok: false, reason: 'expired' }
  if (exp - now > POW_CHALLENGE_TTL_SECONDS + 60) return { ok: false, reason: 'invalid' }
  if (difficulty < POW_MIN_DIFFICULTY || difficulty > POW_MAX_DIFFICULTY) return { ok: false, reason: 'invalid' }
  let provided: Uint8Array
  try {
    provided = fromBase64Url(tag)
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  const expected = hmacSha256(
    textEncoder.encode(secret),
    textEncoder.encode(`pow-challenge-v1:${id}:${exp}:${difficulty}:${binding}`),
  )
  if (!tagsEqual(provided, expected)) return { ok: false, reason: 'invalid' }
  // Stolen challenges die cross-network: the binding only matches the
  // network that requested it.
  const actualBinding = ipBinding(ip, secret)
  if (actualBinding.length !== binding.length) return { ok: false, reason: 'invalid' }
  let bindingDiff = 0
  for (let index = 0; index < binding.length; index += 1) {
    bindingDiff |= binding.charCodeAt(index) ^ actualBinding.charCodeAt(index)
  }
  if (bindingDiff !== 0) return { ok: false, reason: 'invalid' }
  if (!Number.isInteger(nonce) || nonce < 0) return { ok: false, reason: 'invalid' }
  const solutionBinding = attestationDigest(attestation)
  if (countLeadingZeroBits(powSolutionPreimage(id, nonce, solutionBinding)) < difficulty) return { ok: false, reason: 'invalid' }
  if (store && !(await store.claim(id, POW_CHALLENGE_TTL_SECONDS))) return { ok: false, reason: 'spent' }
  return { ok: true }
}
