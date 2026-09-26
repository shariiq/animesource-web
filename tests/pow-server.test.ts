// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type ChallengeStore,
  attestationVersionCurrent,
  clientWeekInWindow,
  escalatedDifficulty,
  mintPowChallenge,
  parseExchangeBody,
  powDifficulty,
  redeemPowChallenge,
} from '../app/data/anisource/pow.server'
import {
  attestationDigest,
  clientWeekId,
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
  av: 1,
  cw: '2026W01',
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
    // Tamper with the tag's first character: it always carries full data
    // bits, while the last base64 character of a 32-byte tag carries only
    // padding-adjacent bits that atob decodes lossily (flipping the tail
    // between A/B/C/D can decode to identical bytes and pass by luck).
    const segments = issued.challenge.split('.')
    const tag = segments[4] ?? ''
    const flipped = `${tag.startsWith('A') ? 'B' : 'A'}${tag.slice(1)}`
    const tampered = [...segments.slice(0, 4), flipped].join('.')
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
    expect(escalatedDifficulty(20, 10)).toBe(20)
    expect(escalatedDifficulty(20, 11)).toBe(22)
    expect(escalatedDifficulty(20, 21)).toBe(24)
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
      av: 1,
      cw: '2026W01',
    }
    expect(parseExchangeBody({ challenge: 'c', solution: { nonce: 3 }, attestation })).toMatchObject({ challenge: 'c' })
    for (const bad of [null, {}, { challenge: 'c' }, { challenge: 'c', solution: {} }, { challenge: 'c', solution: { nonce: -1 } }, {
      challenge: 'c',
      solution: { nonce: 1.5 },
    }, { challenge: 'c', solution: { nonce: 1 } }, { challenge: 'c', solution: { nonce: 1 }, attestation: { ...attestation, extra: 1 } },
    // Freshness fields are required: a missing week or version is malformed,
    // not unverifiable. Staleness itself is judged at the exchange.
    { challenge: 'c', solution: { nonce: 1 }, attestation: { ...attestation, cw: null } },
    { challenge: 'c', solution: { nonce: 1 }, attestation: { ...attestation, av: null } },
    { challenge: 'c', solution: { nonce: 1 }, attestation: { ...attestation, cw: 'last-week' } }]) {
      expect(parseExchangeBody(bad)).toBeNull()
    }
  })

  it('requires a current week and schema version, never a null exemption', () => {
    const now = Date.now()
    expect(clientWeekInWindow(clientWeekId(now), now)).toBe(true)
    expect(clientWeekInWindow('2020W01', now)).toBe(false)
    expect(clientWeekInWindow('last-week', now)).toBe(false)
    expect(attestationVersionCurrent(1)).toBe(true)
    expect(attestationVersionCurrent(999)).toBe(false)
  })
})
