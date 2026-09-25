import { afterEach, describe, expect, it, vi } from 'vitest'
import { serverSecret } from '../app/lib/serverSecret'

describe('serverSecret', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns a configured secret of at least 32 bytes', () => {
    vi.stubEnv('ANISOURCE_SESSION_SECRET', 'x'.repeat(32))
    expect(serverSecret()).toBe('x'.repeat(32))
  })

  it('falls back to process-local randomness outside production', () => {
    vi.stubEnv('ANISOURCE_SESSION_SECRET', '')
    vi.stubEnv('NODE_ENV', 'test')
    const first = serverSecret()
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(serverSecret()).toBe(first)
  })

  it('fails closed in production without a configured secret', () => {
    vi.stubEnv('ANISOURCE_SESSION_SECRET', '')
    vi.stubEnv('NODE_ENV', 'production')
    expect(serverSecret()).toBeNull()
  })

  it('rejects short secrets', () => {
    vi.stubEnv('ANISOURCE_SESSION_SECRET', 'too-short')
    vi.stubEnv('NODE_ENV', 'production')
    expect(serverSecret()).toBeNull()
  })
})
