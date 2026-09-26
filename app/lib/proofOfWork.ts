/**
 * Hashcash-style proof-of-work primitives (ADR 0007). Isomorphic on purpose:
 * the browser solves with this code and the tests drive it without a server.
 * Secret-bearing mint/verify logic lives in `pow.server.ts`; nothing here
 * reads configuration, so importing this can never leak a secret.
 */

function rightRotate(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount))
}

/**
 * Indexed word read. Schedule indices are statically bounded, so the
 * fallback only satisfies the type checker and never fires — it keeps the
 * hot loop free of non-null assertions without hiding real bounds errors
 * behind a directive.
 */
function word(words: Uint32Array | Uint8Array, index: number): number {
  return words[index] ?? 0
}

const SHA256_INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]

const SHA256_ROUND = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

function sha256Digest(data: Uint8Array): Uint8Array {
  let paddedLength = data.length + 1 + 8
  while (paddedLength % 64 !== 0) paddedLength += 1
  const padded = new Uint8Array(paddedLength)
  padded.set(data)
  padded[data.length] = 0x80
  const view = new DataView(padded.buffer)
  // Messages here are far below 2^32 bits, so the high length word stays zero.
  view.setUint32(paddedLength - 4, data.length * 8)
  // 32-bit words: free wraparound semantics and no undefined-index assertions.
  const h = Uint32Array.from(SHA256_INITIAL)
  const w = new Uint32Array(64)
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) w[index] = view.getUint32(offset + index * 4)
    for (let index = 16; index < 64; index += 1) {
      const s0 = rightRotate(word(w, index - 15), 7) ^ rightRotate(word(w, index - 15), 18) ^ (word(w, index - 15) >>> 3)
      const s1 = rightRotate(word(w, index - 2), 17) ^ rightRotate(word(w, index - 2), 19) ^ (word(w, index - 2) >>> 10)
      w[index] = word(w, index - 16) + s0 + word(w, index - 7) + s1
    }
    let a = word(h, 0)
    let b = word(h, 1)
    let c = word(h, 2)
    let d = word(h, 3)
    let e = word(h, 4)
    let f = word(h, 5)
    let g = word(h, 6)
    let hh = word(h, 7)
    for (let index = 0; index < 64; index += 1) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (hh + s1 + ch + word(SHA256_ROUND, index) + word(w, index)) | 0
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (s0 + maj) | 0
      hh = g
      g = f
      f = e
      e = (d + temp1) | 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) | 0
    }
    h[0] = word(h, 0) + a
    h[1] = word(h, 1) + b
    h[2] = word(h, 2) + c
    h[3] = word(h, 3) + d
    h[4] = word(h, 4) + e
    h[5] = word(h, 5) + f
    h[6] = word(h, 6) + g
    h[7] = word(h, 7) + hh
  }
  const digest = new Uint8Array(32)
  const out = new DataView(digest.buffer)
  for (let index = 0; index < 8; index += 1) out.setUint32(index * 4, word(h, index) >>> 0)
  return digest
}

/** Synchronous HMAC-SHA256 over raw bytes. */
export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  const keyBlock = key.length > 64 ? sha256Digest(key) : key
  const inner = new Uint8Array(64 + message.length)
  const outer = new Uint8Array(64 + 32)
  for (let index = 0; index < 64; index += 1) {
    const byte = index < keyBlock.length ? word(keyBlock, index) : 0
    inner[index] = byte ^ 0x36
    outer[index] = byte ^ 0x5c
  }
  inner.set(message, 64)
  outer.set(sha256Digest(inner), 64)
  return sha256Digest(outer)
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4))
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** Count leading zero bits of a digest: bit-granular difficulty (each bit doubles the work). */
export function countLeadingZeroBits(digest: Uint8Array): number {
  let count = 0
  for (const byte of digest) {
    if (byte === 0) {
      count += 8
      continue
    }
    count += Math.clz32(byte) - 24
    break
  }
  return count
}

const textEncoder = new TextEncoder()

/** Hash input for one solution attempt: `challengeId:nonce`. */
export function powAttemptHash(challengeId: string, nonce: number): Uint8Array {
  return sha256Digest(textEncoder.encode(`${challengeId}:${Math.trunc(nonce)}`))
}

/**
 * Canonical attestation encoding: sorted keys, compact separators, nulls
 * included. One implementation shared by solver and verifier, so the bytes
 * cannot drift between them.
 */
export function canonicalizeAttestation(attestation: PowAttestation): string {
  return JSON.stringify({
    hardwareConcurrency: attestation.hardwareConcurrency,
    languages: attestation.languages,
    mobile: attestation.mobile,
    plugins: attestation.plugins,
    screenHeight: attestation.screenHeight,
    screenWidth: attestation.screenWidth,
    touchPoints: attestation.touchPoints,
    userAgent: attestation.userAgent,
    webdriver: attestation.webdriver,
  })
}

/** Short binding digest: 128 bits, far past collision concern for this use, short enough to keep preimages small. */
export function attestationDigest(attestation: PowAttestation): string {
  const digest = sha256Digest(textEncoder.encode(canonicalizeAttestation(attestation)))
  return [...digest.slice(0, 16)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Bound solution preimage: `challengeId:nonce[:binding]`. Binding ties the
 * solve to the exact attestation submitted with it — a solution cannot be
 * cut from one attestation and pasted onto another. Unbound (null) preserves
 * the bare format for tests; the server never accepts unbound solutions.
 */
export function powSolutionPreimage(challengeId: string, nonce: number, binding: string | null): Uint8Array {
  const input = binding === null ? `${challengeId}:${Math.trunc(nonce)}` : `${challengeId}:${Math.trunc(nonce)}:${binding}`
  return sha256Digest(textEncoder.encode(input))
}

/**
 * Coarse, privacy-preserving environment signals collected while solving.
 * Counts and viewport dimensions only — no language strings, no canvas, no
 * identifiers. Every field is nullable because hardened browsers omit APIs;
 * missing data scores nothing and never blocks. Client-asserted by nature,
 * so this attests nothing: it prices automation, with stealthy clients
 * passing clean by construction (see scoreAttestation).
 */
export interface PowAttestation {
  webdriver: boolean | null
  userAgent: string | null
  plugins: number | null
  languages: number | null
  hardwareConcurrency: number | null
  screenWidth: number | null
  screenHeight: number | null
  touchPoints: number | null
  mobile: boolean | null
}

export function collectEnvironmentAttestation(): PowAttestation {
  const empty: PowAttestation = {
    webdriver: null,
    userAgent: null,
    plugins: null,
    languages: null,
    hardwareConcurrency: null,
    screenWidth: null,
    screenHeight: null,
    touchPoints: null,
    mobile: null,
  }
  try {
    if (typeof navigator === 'undefined') return empty
    const userAgent = typeof navigator.userAgent === 'string' ? navigator.userAgent.slice(0, 256) : null
    const screen = typeof window !== 'undefined' ? window.screen ?? null : null
    return {
      webdriver: typeof navigator.webdriver === 'boolean' ? navigator.webdriver : null,
      userAgent,
      plugins: typeof navigator.plugins?.length === 'number' ? navigator.plugins.length : null,
      languages: Array.isArray(navigator.languages) ? navigator.languages.length : null,
      hardwareConcurrency: typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : null,
      screenWidth: typeof screen?.width === 'number' ? screen.width : null,
      screenHeight: typeof screen?.height === 'number' ? screen.height : null,
      touchPoints: typeof navigator.maxTouchPoints === 'number' ? navigator.maxTouchPoints : null,
      mobile: userAgent === null ? null : /Mobile|Android|iPhone|iPad/i.test(userAgent),
    }
  } catch {
    return empty
  }
}

export interface AttestationScore {
  score: number
  reasons: string[]
}

export interface FingerprintScore {
  score: number
  reasons: string[]
}

const AUTOMATION_UA = /okhttp|curl|wget|python-requests|python-urllib|go-http-client|java|apache-httpclient|axios|node-fetch|undici|dalvik|phantomjs|slimerjs|selenium|puppeteer|playwright|headless/i
const CHROMIUM_UA = /Chrome\/|Chromium\/|Edg\/|OPR\/|Brave\/|SamsungBrowser\//i

/**
 * Server-observed request fingerprint. Unlike attestation, the client
 * declares none of this — it leaks from the HTTP stack itself: automation
 * libraries announce themselves in User-Agent, and non-browsers omit the
 * fetch-metadata and client-hint headers real browsers always send.
 * Deliberately presence-and-consistency only, never header order: platform
 * proxies may normalize order, but they do not invent missing headers.
 * A forged stack must replicate a browser's exact header set and keep it
 * consistent with its claimed UA across every release — possible, but
 * maintained impersonation instead of free riding.
 */
export function scoreRequestFingerprint(headers: Headers): FingerprintScore {
  const reasons: string[] = []
  let score = 0
  const userAgent = headers.get('user-agent') ?? ''
  if (userAgent === '') {
    reasons.push('no user agent')
    score += 1
  } else if (AUTOMATION_UA.test(userAgent)) {
    reasons.push('automation user agent')
    score += 3
  }
  const fetchSite = headers.get('sec-fetch-site')
  const fetchMode = headers.get('sec-fetch-mode')
  if (fetchSite === null && fetchMode === null) {
    reasons.push('no fetch metadata')
    score += 2
  } else if (fetchMode !== null && fetchMode !== 'cors') {
    reasons.push('unexpected fetch mode')
    score += 1
  }
  if (CHROMIUM_UA.test(userAgent) && headers.get('sec-ch-ua') === null) {
    reasons.push('chromium claim without client hints')
    score += 2
  }
  return { score, reasons }
}

/** Score at or above which a session is treated as automated. */
export const SUSPICIOUS_ATTESTATION_SCORE = 3

/**
 * Scores automation tells from coarse signals. Forged-clean passes by
 * design, so the score only ever prices (shorter sessions, hotter puzzles)
 * and never blocks — a spoofable signal must not deny service. Thresholds
 * are tuned so stock desktop/mobile browsers score 0 and default headless
 * automation scores past the bar; the matrix test pins both sides.
 */
export function scoreAttestation(attestation: PowAttestation): AttestationScore {
  const reasons: string[] = []
  let score = 0
  const flag = (reason: string, points: number): void => {
    reasons.push(reason)
    score += points
  }
  if (attestation.webdriver === true) flag('automation flag', 3)
  if (
    attestation.userAgent !== null &&
    /headless|playwright|selenium|puppeteer|phantomjs|slimerjs|webdriver/i.test(attestation.userAgent)
  ) {
    flag('automation token', 2)
  }
  if (attestation.languages === 0) flag('no languages', 1)
  if (attestation.hardwareConcurrency !== null && attestation.hardwareConcurrency <= 1) flag('single core', 1)
  if (attestation.screenWidth === 0 || attestation.screenHeight === 0) flag('null screen', 1)
  // Heuristic tied to old headless defaults (Playwright uses 1280x720,
  // modern headless Chrome varies): revisit periodically as tooling shifts,
  // and never promote viewport matching past a single point — common laptop
  // resolutions must stay clean.
  if (attestation.screenWidth === 800 && attestation.screenHeight === 600) flag('default headless viewport', 1)
  // Mobile browsers legitimately expose zero plugins; only the desktop
  // combination is a tell. Touch works the mirror way.
  if (attestation.plugins === 0 && attestation.mobile === false) flag('no plugins on desktop', 1)
  if (attestation.touchPoints === 0 && attestation.mobile === true) flag('no touch on mobile', 1)
  return { score, reasons }
}

export interface PowSolution {
  nonce: number
}

export interface SolvePowOptions {
  /** AbortSignal cancels the search between batches. */
  signal?: AbortSignal
  /** Hashes per macrotask; keeps the main thread responsive while solving. */
  batchSize?: number
  /** Lowest nonce to try; tests pin ranges without touching timing. */
  fromNonce?: number
  /**
   * Total nonce attempts before giving up loudly. Without a cap a
   * misconfigured difficulty spins forever; with one, misuse fails fast
   * instead of silently pegging the CPU.
   */
  maxAttempts?: number
  /**
   * Worker count for parallel search. 1 (default) solves on the calling
   * thread; higher values fan out across Web Workers on disjoint nonce
   * strides when workers exist, falling back to sequential otherwise
   * (SSR, tests, CSP-blocked worker construction).
   */
  workers?: number
  /** Test seam for the worker pool; defaults to real module workers. */
  createWorker?: PowWorkerFactory
  /**
   * Attestation binding digest: when present, solutions satisfy the bound
   * preimage and cannot be transplanted onto another attestation. Null
   * preserves the bare format; servers only accept bound solutions.
   */
  binding?: string | null
}

const DEFAULT_BATCH_SIZE = 20_000

export interface PowWorkerTask {
  challengeId: string
  difficulty: number
  fromNonce: number
  stride: number
  /** Nonce attempts for this worker; null searches until found or aborted. */
  attempts: number | null
  /** Attestation binding digest; null solves the bare preimage. */
  binding: string | null
}

export type PowWorkerResult = { type: 'found'; nonce: number } | { type: 'exhausted' }

/**
 * Minimal worker surface the pool needs. Narrower than the DOM Worker type
 * on purpose: fakes implement this in tests without DOM casts, and the one
 * real-Worker adapter documents its single cast at the boundary.
 */
export interface PowWorkerPort {
  postMessage(task: PowWorkerTask): void
  terminate(): void
  set onmessage(handler: ((event: { data: PowWorkerResult }) => void) | null)
  set onerror(handler: (() => void) | null)
}

export type PowWorkerFactory = () => PowWorkerPort

function defaultCreateWorker(): PowWorkerPort {
  const worker = new Worker(new URL('./pow.worker.ts', import.meta.url), { type: 'module' })
  return {
    postMessage: (task) => worker.postMessage(task),
    terminate: () => worker.terminate(),
    set onmessage(handler: ((event: { data: PowWorkerResult }) => void) | null) {
      // Narrow adapter: the worker script only ever posts PowWorkerResult,
      // which the DOM MessageEvent type cannot express.
      worker.onmessage = handler as ((this: Worker, event: MessageEvent) => unknown) | null
    },
    set onerror(handler: (() => void) | null) {
      worker.onerror = handler ? () => handler() : null
    },
  }
}

/** First nonce of a worker's stride: strides partition the space with no overlap and no gaps. */
export function powStrideStart(workerIndex: number, fromNonce: number): number {
  return fromNonce + workerIndex
}

function maxAttemptsError(maxAttempts: number): PowExhaustedError {
  return new PowExhaustedError(`Proof-of-work search exceeded ${maxAttempts} attempts.`)
}

/** The pool searched its whole capped budget without a hit. */
export class PowExhaustedError extends Error {}

/** Every worker errored; nothing about the search space is known. Only the
 *  all-errored pool rejects this way — a lone flaky worker is dropped and
 *  the survivors continue, so this error specifically means no stride
 *  completed. The caller retries sequentially rather than claiming
 *  exhaustion. */
export class PowWorkersFailedError extends Error {
  constructor() {
    super('Proof-of-work workers failed.')
  }
}

async function solveSequential(
  challengeId: string,
  difficulty: number,
  fromNonce: number,
  batchSize: number,
  maxAttempts: number | undefined,
  signal: AbortSignal | undefined,
  binding: string | null,
): Promise<PowSolution> {
  let nonce = fromNonce
  let attempts = 0
  for (;;) {
    if (signal?.aborted) throw new Error('Proof-of-work search was cancelled.')
    const end = nonce + batchSize
    while (nonce < end) {
      if (maxAttempts !== undefined && attempts >= maxAttempts) throw maxAttemptsError(maxAttempts)
      if (countLeadingZeroBits(powSolutionPreimage(challengeId, nonce, binding)) >= difficulty) {
        return { nonce }
      }
      nonce += 1
      attempts += 1
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

function solveParallel(
  challengeId: string,
  difficulty: number,
  fromNonce: number,
  workerCount: number,
  maxAttempts: number | undefined,
  signal: AbortSignal | undefined,
  createWorker: PowWorkerFactory,
  binding: string | null,
): Promise<PowSolution> {
  const workers: PowWorkerPort[] = []
  try {
    for (let index = 0; index < workerCount; index += 1) {
      workers.push(createWorker())
    }
  } catch (error) {
    for (const worker of workers) {
      try {
        worker.terminate()
      } catch {
        // Cleanup is best-effort on a path that already failed.
      }
    }
    throw error
  }
  return new Promise<PowSolution>((resolve, reject) => {
    let settled = false
    let exhausted = 0
    let errored = 0
    const finish = (outcome: () => void) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      for (const worker of workers) {
        try {
          worker.terminate()
        } catch {
          // Termination is best-effort cleanup after the race is decided.
        }
      }
      outcome()
    }
    const onAbort = () => finish(() => reject(new Error('Proof-of-work search was cancelled.')))
    if (signal?.aborted) {
      finish(() => reject(new Error('Proof-of-work search was cancelled.')))
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    workers.forEach((worker, index) => {
      worker.onmessage = (event) => {
        const result = event.data
        if (result.type === 'found') {
          finish(() => resolve({ nonce: result.nonce }))
          return
        }
        exhausted += 1
        checkTerminal()
      }
      worker.onerror = () => {
        // One flaky worker costs one worker, not the pool: drop it and let
        // the surviving strides continue. Only total failure is terminal.
        try {
          worker.terminate()
        } catch {
          // Cleanup is best-effort on a path that already failed.
        }
        errored += 1
        checkTerminal()
      }
      worker.postMessage({
        challengeId,
        difficulty,
        fromNonce: powStrideStart(index, fromNonce),
        stride: workerCount,
        attempts: maxAttempts === undefined ? null : workerAttemptCap(maxAttempts, workerCount, index),
        binding,
      })
    })

    function checkTerminal(): void {
      if (settled || exhausted + errored < workers.length) return
      if (errored === 0) {
        // Every stride searched to its exact cap with no hit: the budget is
        // genuinely spent.
        finish(() => reject(maxAttemptsError(maxAttempts ?? 0)))
      } else {
        // Searched ranges may still hold the solution; the caller retries
        // sequentially rather than lying about exhaustion.
        finish(() => reject(new PowWorkersFailedError()))
      }
    }
  })
}

/**
 * This worker's share of a capped budget, dealt like cards so the shares sum
 * to exactly maxAttempts: the pool can never overshoot the cap, and a dropped
 * worker only shrinks the searched space, never grows it.
 */
export function workerAttemptCap(maxAttempts: number, workerCount: number, workerIndex: number): number {
  const base = Math.floor(maxAttempts / workerCount)
  return base + (workerIndex < maxAttempts % workerCount ? 1 : 0)
}

/**
 * Find a nonce whose attempt hash carries at least `difficulty` leading zero
 * bits. Runs in slices (sequential) or across workers (parallel) so page
 * interaction stays alive during multi-second solves; rejects promptly on
 * abort. Throws only on invalid input, abort, or an exhausted attempt cap.
 * Dead workers fall back to the sequential search rather than failing
 * verification for an environment reason.
 */
export async function solvePowChallenge(
  challengeId: string,
  difficulty: number,
  options: SolvePowOptions = {},
): Promise<PowSolution> {
  if (!challengeId || !Number.isInteger(difficulty) || difficulty < 1 || difficulty > 256) {
    throw new Error('Invalid proof-of-work challenge.')
  }
  if (options.maxAttempts !== undefined && (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1)) {
    throw new Error('Invalid proof-of-work attempt cap.')
  }
  const batchSize = Math.max(1, Math.trunc(options.batchSize ?? DEFAULT_BATCH_SIZE))
  const fromNonce = Math.max(0, Math.trunc(options.fromNonce ?? 0))
  const workerCount = Math.max(1, Math.trunc(options.workers ?? 1))
  const binding = options.binding ?? null
  if (workerCount > 1) {
    const createWorker = options.createWorker ?? defaultCreateWorker
    // Construction can fail where workers don't exist (SSR, tests) or are
    // blocked (CSP worker-src): fall back to the sequential search instead
    // of failing verification for an environment reason. A fully dead pool
    // retries the same way; only genuine exhaustion propagates.
    try {
      return await solveParallel(challengeId, difficulty, fromNonce, workerCount, options.maxAttempts, options.signal, createWorker, binding)
    } catch (error) {
      if (error instanceof PowExhaustedError) throw error
      if (options.signal?.aborted) throw error
    }
  }
  return solveSequential(challengeId, difficulty, fromNonce, batchSize, options.maxAttempts, options.signal, binding)
}
