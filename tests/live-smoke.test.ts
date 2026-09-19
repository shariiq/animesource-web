import { fetchWithRetry } from '../scripts/live-smoke.mjs'

describe('live smoke transient request handling', () => {
  it('recovers from a cold-start timeout before returning a response', async () => {
    let calls = 0

    const result = await fetchWithRetry('https://example.test/health', {
      attempts: 3,
      timeoutMs: 1,
      sleep: async () => undefined,
      fetchImpl: async () => {
        calls += 1
        if (calls < 3) throw new Error('The operation was aborted due to timeout')
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      },
    })

    expect(calls).toBe(3)
    expect(result.attempt).toBe(3)
    expect(result.response?.status).toBe(200)
    expect(result.error).toBeUndefined()
  })

  it('does not retry a permanent client error', async () => {
    let calls = 0

    const result = await fetchWithRetry('https://example.test/sources', {
      attempts: 3,
      timeoutMs: 1,
      sleep: async () => undefined,
      fetchImpl: async () => {
        calls += 1
        return new Response('{}', { status: 404, statusText: 'Not Found' })
      },
    })

    expect(calls).toBe(1)
    expect(result.attempt).toBe(1)
    expect(result.response?.status).toBe(404)
  })
})
