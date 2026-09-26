// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  ABUSE_IP_ANON_LIMIT,
  ABUSE_SHARE_BAN_TTL_SECONDS,
  ABUSE_SID_BAN_TTL_SECONDS,
  ABUSE_SID_MEDIA_LIMIT,
  ABUSE_SID_SHARE_LIMIT,
  ABUSE_SID_VELOCITY_LIMIT,
  type AbuseStore,
  checkAbuse,
  isNetworkDenied,
  networkFingerprint,
  sessionFingerprint,
} from '../app/data/anisource/abuse.server'

function fakeAbuseStore(): AbuseStore {
  const kv = new Map<string, string>()
  const counters = new Map<string, number>()
  const hll = new Map<string, Set<string>>()
  return {
    get: async (key: string) => (kv.has(key) ? kv.get(key) ?? null : null),
    set: async (key: string, value: string) => {
      kv.set(key, value)
    },
    incr: async (key: string) => {
      const count = (counters.get(key) ?? 0) + 1
      counters.set(key, count)
      return count
    },
    expire: async () => undefined,
    pfadd: async (key: string, member: string) => {
      let set = hll.get(key)
      if (!set) {
        set = new Set()
        hll.set(key, set)
      }
      const size = set.size
      set.add(member)
      return set.size > size ? 1 : 0
    },
    pfcount: async (key: string) => hll.get(key)?.size ?? 0,
  }
}

const NOW = 1_700_000_000

describe('abuse tripwires', () => {
  it('passes everything through without a store', async () => {
    expect(await checkAbuse(null, { ipHash: 'x', sessionFingerprint: 'y', sessionless: false }, NOW))
      .toEqual({ ok: true })
    expect(await isNetworkDenied(null, 'x')).toBe(false)
  })

  it('bans sessions past sustained velocity', async () => {
    const store = fakeAbuseStore()
    const signal = { ipHash: 'net-1', sessionFingerprint: 'sid-1', sessionless: false, forceSample: true }
    for (let attempt = 0; attempt < ABUSE_SID_VELOCITY_LIMIT; attempt += 1) {
      expect(await checkAbuse(store, signal, NOW)).toEqual({ ok: true })
    }
    expect(await checkAbuse(store, signal, NOW)).toEqual({
      ok: false,
      retryAfterSeconds: ABUSE_SID_BAN_TTL_SECONDS,
      reason: 'velocity',
    })
    // Standing denial fails fast on reads alone.
    expect(await checkAbuse(store, signal, NOW)).toEqual({
      ok: false,
      retryAfterSeconds: ABUSE_SID_BAN_TTL_SECONDS,
      reason: 'velocity',
    })
  })

  it('bans sessions shared across networks', async () => {
    const store = fakeAbuseStore()
    for (let index = 0; index < ABUSE_SID_SHARE_LIMIT; index += 1) {
      const verdict = await checkAbuse(store, {
        ipHash: `net-${index}`,
        sessionFingerprint: 'shared-sid',
        sessionless: false,
        forceSample: true,
      }, NOW)
      expect(verdict).toEqual({ ok: true })
    }
    expect(await checkAbuse(store, {
      ipHash: 'net-final',
      sessionFingerprint: 'shared-sid',
      sessionless: false,
      forceSample: true,
    }, NOW)).toEqual({ ok: false, retryAfterSeconds: ABUSE_SHARE_BAN_TTL_SECONDS, reason: 'shared' })
  })

  it('paces media resolution unsampled: one resolve serves a whole episode', async () => {
    const store = fakeAbuseStore()
    const signal = { ipHash: 'net-1', sessionFingerprint: 'sid-media', sessionless: false, mediaResolve: true }
    for (let attempt = 0; attempt < ABUSE_SID_MEDIA_LIMIT; attempt += 1) {
      expect(await checkAbuse(store, signal, NOW)).toEqual({ ok: true })
    }
    // The 31st Streams/Pages resolve in 10 minutes trips the same session
    // ban human pacing (single digits) never approaches.
    expect(await checkAbuse(store, signal, NOW)).toEqual({
      ok: false,
      retryAfterSeconds: ABUSE_SID_BAN_TTL_SECONDS,
      reason: 'velocity',
    })
  })

  it('reads standing denials for asset tickets without writing telemetry', async () => {
    const store = fakeAbuseStore()
    const signal = { ipHash: 'net-1', sessionFingerprint: 'sid-asset', sessionless: false, readOnly: true }
    expect(await checkAbuse(store, signal, NOW)).toEqual({ ok: true })
    const denied = { ipHash: 'net-1', sessionFingerprint: 'sid-asset', sessionless: false, forceSample: true }
    for (let attempt = 0; attempt <= ABUSE_SID_VELOCITY_LIMIT; attempt += 1) {
      await checkAbuse(store, denied, NOW)
    }
    expect(await checkAbuse(store, signal, NOW)).toEqual({
      ok: false,
      retryAfterSeconds: ABUSE_SID_BAN_TTL_SECONDS,
      reason: 'velocity',
    })
  })
  it('bans networks flooding sessionless requests', async () => {
    const store = fakeAbuseStore()
    const signal = { ipHash: 'scan-net', sessionFingerprint: null, sessionless: true }
    for (let attempt = 0; attempt < ABUSE_IP_ANON_LIMIT; attempt += 1) {
      expect(await checkAbuse(store, signal, NOW)).toEqual({ ok: true })
    }
    expect(await checkAbuse(store, signal, NOW)).toEqual({
      ok: false,
      retryAfterSeconds: 900,
      reason: 'probing',
    })
    expect(await isNetworkDenied(store, 'scan-net')).toBe(true)
    expect(await isNetworkDenied(store, 'other-net')).toBe(false)
  })

  it('fingerprints stably without leaking identities', () => {
    expect(sessionFingerprint('sid')).toBe(sessionFingerprint('sid'))
    expect(sessionFingerprint('sid-a')).not.toBe(sessionFingerprint('sid-b'))
    expect(sessionFingerprint('sid-a')).not.toContain('sid-a')
    expect(networkFingerprint('1.2.3.4')).not.toContain('1.2.3.4')
  })
})
