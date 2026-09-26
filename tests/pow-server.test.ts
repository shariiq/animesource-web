// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type ChallengeStore,
  escalatedDifficulty,
  mintPowChallenge,
  parseExchangeBody,
  powDifficulty,
  redeemPowChallenge,
} from '../app/data/anisource/pow.server'
import {
  attestationDigest,
  countLeadingZeroBits,
  powSolutionPreimage,
  solvePowChallenge,
} from '../app/lib/proofOfWork'

const SECRET = 'pow-test-secret-'.padEnd(48, 'p')

const TEST_ATTESTATION = {
  webdriver: false,
  userAgent: 'test-agent',
  plugins: 1,
  languages: 1,
  hardwareConcurrency: 2,
  screenWidth: 100,
  screenHeight: 100,
  touchPoints: 0,
  mobile: false,
}

function fakeStore(): ChallengeStore & { claimed: string[] } {
  const claimed: string[] = []
  const budgets = new Map<string, number>()
  return {
    claimed,
    claim: async (id: string) => {
      if (claimed.includes(id)) return false
      claimed.push(id)
      return true
    },
    hitBudget: async (key: string, limit: number) => {
      const count = (budgets.get(key) ?? 0) + 1
      budgets.set(key, count)
      return { allowed: count <= limit, count }
    },
    burnBudget: async (key: string, amount: number) => {
      budgets.set(key, (budgets.get(key) ?? 0) + amount)
    },
  }
}

describe('proof-of-work session issuance', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('ANISOURCE_SESSION_SECRET', SECRET)
    vi.stubEnv('ANISOURCE_POW_DIFFICULTY', '8')
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('mints challenges bound to difficulty and expiry', () => {
    const issued = mintPowChallenge('10.0.0.1', 1_700_000_000)
    expect(issued).not.toBeNull()
    expect(issued?.difficulty).toBe(8)
    expect(issued?.expiresIn).toBe(5 * 60)
    expect(issued?.challenge.split('.')).toHaveLength(5)
  })

  it('returns null without a signing secret', () => {
    vi.stubEnv('ANISOURCE_SESSION_SECRET', '')
    vi.stubEnv('NODE_ENV', 'production')
    expect(mintPowChallenge('10.0.0.1', 1_700_000_000)).toBeNull()
  })

  it('clamps operator difficulty into the sane range', () => {
    vi.stubEnv('ANISOURCE_POW_DIFFICULTY', '999')
    expect(powDifficulty()).toBe(30)
    vi.stubEnv('ANISOURCE_POW_DIFFICULTY', '0')
    expect(powDifficulty()).toBe(1)
    vi.stubEnv('ANISOURCE_POW_DIFFICULTY', 'nope')
    expect(powDifficulty()).toBe(20)
  })

  it('redeems a solved challenge and spends it exactly once', async () => {
    const now = Math.floor(Date.now() / 1000)
    const store = fakeStore()
    const issued = mintPowChallenge('10.0.0.1', now)
    if (!issued) throw new Error('Expected a challenge.')
    const id = issued.challenge.split('.')[0]
    if (!id) throw new Error('Expected the challenge to carry an id.')
    const binding = attestationDigest(TEST_ATTESTATION)
    const { nonce } = await solvePowChallenge(id, issued.difficulty, { binding })
    expect(await redeemPowChallenge(issued.challenge, nonce, TEST_ATTESTATION, '10.0.0.1', store, now))
      .toMatchObject({ ok: true })
    expect(await redeemPowChallenge(issued.challenge, nonce, TEST_ATTESTATION, '10.0.0.1', store, now)).toEqual({
      ok: false,
      reason: 'spent',
    })
  })

  it('rejects wrong solutions, tampered challenges, expiry, and foreign networks', async () => {
    const now = Math.floor(Date.now() / 1000)
    const store = fakeStore()
    const issued = mintPowChallenge('10.0.0.1', now)
    if (!issued) throw new Error('Expected a challenge.')
    const id = issued.challenge.split('.')[0]
    if (!id) throw new Error('Expected the challenge to carry an id.')
    const binding = attestationDigest(TEST_ATTESTATION)
    const { nonce } = await solvePowChallenge(id, issued.difficulty, { binding })
    let wrong = nonce + 1
    while (countLeadingZeroBits(powSolutionPreimage(id, wrong, binding)) >= issued.difficulty) wrong += 1
    expect(await redeemPowChallenge(issued.challenge, wrong, TEST_ATTESTATION, '10.0.0.1', store, now))
      .toEqual({ ok: false, reason: 'invalid' })
    const tampered = `${issued.challenge.slice(0, -1)}${issued.challenge.endsWith('A') ? 'B' : 'A'}`
    expect(await redeemPowChallenge(tampered, nonce, TEST_ATTESTATION, '10.0.0.1', store, now))
      .toEqual({ ok: false, reason: 'invalid' })
    expect(await redeemPowChallenge(issued.challenge, nonce, TEST_ATTESTATION, '10.0.0.1', store, now + 5 * 60 + 1))
      .toEqual({ ok: false, reason: 'expired' })
    // A stolen challenge is useless cross-network: the binding mismatches.
    expect(await redeemPowChallenge(issued.challenge, nonce, TEST_ATTESTATION, '10.9.9.9', store, now))
      .toEqual({ ok: false, reason: 'invalid' })
  })

  it('rejects solutions transplanted onto a different attestation', async () => {
    const now = Math.floor(Date.now() / 1000)
    const store = fakeStore()
    const issued = mintPowChallenge('10.0.0.1', now)
    if (!issued) throw new Error('Expected a challenge.')
    const id = issued.challenge.split('.')[0]
    if (!id) throw new Error('Expected the challenge to carry an id.')
    const { nonce } = await solvePowChallenge(id, issued.difficulty, { binding: attestationDigest(TEST_ATTESTATION) })
    const swapped = { ...TEST_ATTESTATION, plugins: 0 }
    expect(await redeemPowChallenge(issued.challenge, nonce, swapped, '10.0.0.1', store, now))
      .toEqual({ ok: false, reason: 'invalid' })
  })

  it('reports the redeemed difficulty', async () => {
    const now = Math.floor(Date.now() / 1000)
    const store = fakeStore()
    const issued = mintPowChallenge('10.0.0.1', now)
    if (!issued) throw new Error('Expected a challenge.')
    const id = issued.challenge.split('.')[0]
    if (!id) throw new Error('Expected the challenge to carry an id.')
    const { nonce } = await solvePowChallenge(id, issued.difficulty, { binding: attestationDigest(TEST_ATTESTATION) })
    const redeemed = await redeemPowChallenge(issued.challenge, nonce, TEST_ATTESTATION, '10.0.0.1', store, now)
    expect(redeemed).toEqual({ ok: true })
  })

  it('stays reusable in development without a spent store', async () => {
    const now = Math.floor(Date.now() / 1000)
    const issued = mintPowChallenge(null, now)
    if (!issued) throw new Error('Expected a challenge.')
    const id = issued.challenge.split('.')[0]
    if (!id) throw new Error('Expected the challenge to carry an id.')
    const binding = attestationDigest(TEST_ATTESTATION)
    const { nonce } = await solvePowChallenge(id, issued.difficulty, { binding })
    expect(await redeemPowChallenge(issued.challenge, nonce, TEST_ATTESTATION, null, null, now)).toMatchObject({ ok: true })
    expect(await redeemPowChallenge(issued.challenge, nonce, TEST_ATTESTATION, null, null, now)).toMatchObject({ ok: true })
  })

  it('escalates difficulty for networks burning their budget', () => {
    expect(escalatedDifficulty(20, 1)).toBe(20)
    expect(escalatedDifficulty(20, 30)).toBe(20)
    expect(escalatedDifficulty(20, 31)).toBe(22)
    expect(escalatedDifficulty(20, 46)).toBe(24)
    expect(escalatedDifficulty(29, 100)).toBe(30)
  })

  it('validates exchange bodies strictly, attestation included', () => {
    const attestation = {
      webdriver: false,
      userAgent: 'agent',
      plugins: 1,
      languages: 1,
      hardwareConcurrency: 2,
      screenWidth: 100,
      screenHeight: 100,
      touchPoints: 0,
      mobile: false,
    }
    expect(parseExchangeBody({ challenge: 'c', solution: { nonce: 3 }, attestation })).toMatchObject({ challenge: 'c' })
    for (const bad of [null, {}, { challenge: 'c' }, { challenge: 'c', solution: {} }, { challenge: 'c', solution: { nonce: -1 } }, {
      challenge: 'c',
      solution: { nonce: 1.5 },
    }, { challenge: 'c', solution: { nonce: 1 } }, { challenge: 'c', solution: { nonce: 1 }, attestation: { ...attestation, extra: 1 } }]) {
      expect(parseExchangeBody(bad)).toBeNull()
    }
  })
})
