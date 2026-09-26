// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PLAYBACK_CAP_PARAM,
  appendPlaybackCapability,
  capTtlSeconds,
  mintPlaybackCapability,
  playbackCapKeyId,
  playbackSecrets,
} from '../app/data/anisource/capability.server'

const SECRET = 'test-playback-capability-secret-0123456789'
const VECTOR = 'v1.eyJleHAiOjE3NTAwMDA5MDAsImlhdCI6MTc1MDAwMDAwMCwia2lkIjoiZjkyYzQ4NTgiLCJzY29wZSI6IjY5N2JhNjYxNzIyODk4YTk4YTRmODJmOGMwMDQzMjlhNzdjYmQxNTJjOWNkM2IyODQ3OTI5NzM4NmE3MDg5MTEiLCJzaWQiOiJkNjI3ZTc0M2NjYjUwZmIxYjMwZmFmN2JhNTlkOTIzMyIsInYiOjF9.X-5R7JVLxgvgPhheztrsHTpuD9XQMH-AOa4ajDvuKVo'

describe('playback capabilities', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('ANISOURCE_PLAYBACK_SECRETS', SECRET)
    vi.stubEnv('ANISOURCE_PLAYBACK_TTL', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('mints the ADR 0006 interop vector byte-identically', async () => {
    const cap = await mintPlaybackCapability('master-token-abc', 'test-session-sid', 1750000000)
    expect(cap).toBe(VECTOR)
  })

  it('binds scope to the API token and identity to the session', async () => {
    const cap = await mintPlaybackCapability('token-a', 'session-a', 1750000000)
    const otherToken = await mintPlaybackCapability('token-b', 'session-a', 1750000000)
    const otherSession = await mintPlaybackCapability('token-a', 'session-b', 1750000000)
    expect(cap).not.toBe(otherToken)
    expect(cap).not.toBe(otherSession)
  })

  it('expires TTL seconds after issuance and honors the TTL override', async () => {
    const now = 1750000000
    const payload = (token: string) => JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as { iat: number; exp: number }
    expect(payload(await mintPlaybackCapability('t', 's', now)).exp - now).toBe(900)
    vi.stubEnv('ANISOURCE_PLAYBACK_TTL', '300')
    expect(capTtlSeconds()).toBe(300)
    expect(payload(await mintPlaybackCapability('t', 's', now)).exp - now).toBe(300)
  })

  it('derives the key id from the primary secret and lists rotation secrets', async () => {
    expect(await playbackCapKeyId(SECRET)).toBe('f92c4858')
    expect(playbackSecrets()).toMatchObject({ primary: SECRET, previous: [] })
    const previous = `${SECRET}-previous-`.padEnd(48, 'x')
    vi.stubEnv('ANISOURCE_PLAYBACK_SECRETS', `${SECRET}, ${previous}, short`)
    expect(playbackSecrets()).toMatchObject({ primary: SECRET, previous: [previous] })
  })

  it('fails closed in production without a secret and falls back in development', () => {
    vi.stubEnv('ANISOURCE_PLAYBACK_SECRETS', '')
    vi.stubEnv('NODE_ENV', 'production')
    expect(playbackSecrets()).toBeNull()
    vi.stubEnv('NODE_ENV', 'test')
    expect(playbackSecrets()).not.toBeNull()
  })

  it('appends the capability while preserving query and fragment', () => {
    expect(appendPlaybackCapability('https://api.test/api/v1/proxy/hls/tok', 'c'))
      .toBe(`https://api.test/api/v1/proxy/hls/tok?${PLAYBACK_CAP_PARAM}=c`)
    expect(appendPlaybackCapability('https://api.test/x?quality=720p#frag', 'c d'))
      .toBe(`https://api.test/x?quality=720p&${PLAYBACK_CAP_PARAM}=c%20d#frag`)
  })
})
