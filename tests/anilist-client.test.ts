import { describe, expect, it, vi } from 'vitest'
import { AniListError, createAniListClient } from '../app/data/anilist/client'

const response = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
const transport = (fetch: (input: string, init?: RequestInit) => Promise<Response>) => ({
  fetch,
  sleep: vi.fn().mockResolvedValue(undefined),
  setTimeout: vi.fn(() => 1 as unknown as ReturnType<typeof setTimeout>),
  clearTimeout: vi.fn(),
})

describe('AniList client', () => {
  it('returns GraphQL data on success', async () => {
    const client = createAniListClient({ transport: transport(async () => response({ data: { Media: { id: 1 } } })) })
    await expect(client.request('query', { id: 1 })).resolves.toEqual({ Media: { id: 1 } })
  })
  it('surfaces GraphQL errors from a 200 response', async () => {
    const client = createAniListClient({ transport: transport(async () => response({ data: null, errors: [{ message: 'Bad query' }] })) })
    await expect(client.request('query')).rejects.toMatchObject({ name: 'AniListError', isGraphQL: true, message: 'Bad query' })
  })

  it('preserves complexity-limit GraphQL details for an expanded query', async () => {
    const errors = [{ message: 'Complexity limit exceeded', locations: [{ line: 4, column: 7 }], path: ['Media', 'staff'] }]
    const client = createAniListClient({ transport: transport(async () => response({ data: null, errors })) })
    await expect(client.request('expanded detail query')).rejects.toMatchObject({
      name: 'AniListError',
      isGraphQL: true,
      message: 'Complexity limit exceeded',
      details: errors,
    })
  })
  it('turns network failures into AniListError', async () => {
    const client = createAniListClient({ transport: transport(async () => { throw new TypeError('offline') }) })
    await expect(client.request('query')).rejects.toMatchObject({ name: 'AniListError', message: expect.stringContaining("Couldn't reach") })
  })
  it('turns aborts into timeout errors', async () => {
    const client = createAniListClient({ transport: transport(async () => { const error = new Error('aborted'); error.name = 'AbortError'; throw error }) })
    await expect(client.request('query')).rejects.toMatchObject({ name: 'AniListError', message: expect.stringContaining('too long') })
  })
  it('passes caller cancellation to the transport without retrying it', async () => {
    const controller = new AbortController()
    const fetch = vi.fn(async (_input: string, _init?: RequestInit) => {
      controller.abort()
      const error = new Error('aborted')
      error.name = 'AbortError'
      throw error
    })
    const client = createAniListClient({ transport: transport(fetch) })

    await expect(client.request('query', {}, controller.signal)).rejects.toMatchObject({
      name: 'AniListError',
      options: { cancelled: true },
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('rejects malformed JSON', async () => {
    const badResponse = { ok: true, status: 200, json: async () => { throw new SyntaxError('bad json') } } as unknown as Response
    const client = createAniListClient({ transport: transport(async () => badResponse) })
    await expect(client.request('query')).rejects.toMatchObject({ name: 'AniListError', message: expect.stringContaining('malformed JSON') })
  })
  it('retries 429 using Retry-After', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ data: null }, 429, { 'retry-after': '2' }))
      .mockResolvedValueOnce(response({ data: { Media: { id: 1 } } }))
    const clientTransport = transport(fetch)
    const client = createAniListClient({ transport: clientTransport, maxRetries: 1 })
    await expect(client.request('query')).resolves.toEqual({ Media: { id: 1 } })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(clientTransport.sleep).toHaveBeenCalledTimes(1)
    expect(clientTransport.sleep.mock.calls[0]?.[0]).toBeGreaterThan(0)
    expect(clientTransport.sleep.mock.calls[0]?.[0]).toBeLessThanOrEqual(2_000)
  })
  it('does not retry non-rate-limit HTTP failures', async () => {
    const client = createAniListClient({ transport: transport(async () => response({}, 500)) })
    await expect(client.request('query')).rejects.toBeInstanceOf(AniListError)
  })
})
