import { afterEach, describe, expect, it, vi } from 'vitest'
import { alSchedule } from '../app/data/anilist/queries'

const schedulePage = (page: number, lastPage: number, episodes: number[]) => ({
  data: {
    Page: {
      pageInfo: {
        currentPage: page,
        lastPage,
        hasNextPage: page < lastPage,
        total: episodes.length,
      },
      airingSchedules: episodes.map((episode) => ({
        episode,
        airingAt: 1_700_000_000 + episode,
        media: {
          id: episode,
          title: { romaji: `Anime ${episode}`, english: null },
          coverImage: { large: null },
          format: 'TV',
          status: 'RELEASING',
          genres: [],
        },
      })),
    },
  },
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('alSchedule pagination', () => {
  it('fetches remaining pages serially and preserves episode order', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const seenPages: number[] = []
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      const page = (JSON.parse(String(init?.body)) as { variables: { page: number } }).variables.page
      seenPages.push(page)
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      try {
        await new Promise((resolve) => setTimeout(resolve, 20))
        const episodes = page === 1 ? [1, 2] : page === 2 ? [3, 4] : [5, 6]
        return new Response(JSON.stringify(schedulePage(page, 3, episodes)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      } finally {
        inFlight -= 1
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const items = await alSchedule(1_700_000_000, 1_700_100_000)

    expect(items.map((item) => item.episode)).toEqual([1, 2, 3, 4, 5, 6])
    expect(seenPages).toEqual(expect.arrayContaining([1, 2, 3]))
    // Serial pages never trip AniList's undocumented burst limiter.
    expect(maxInFlight).toBeLessThanOrEqual(1)
  })

  it('returns the single page without extra requests', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(schedulePage(1, 1, [7])), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const items = await alSchedule(1_700_000_000, 1_700_100_000)

    expect(items).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('survives a rate-limited page via the client retry instead of surfacing 429', async () => {
    const attempts = new Map<number, number>()
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      const page = (JSON.parse(String(init?.body)) as { variables: { page: number } }).variables.page
      const count = (attempts.get(page) ?? 0) + 1
      attempts.set(page, count)
      await new Promise((resolve) => setTimeout(resolve, 5))
      // Page 2 hits the minute quota once; the shared client cooldown waits
      // out Retry-After and the single retry succeeds.
      if (page === 2 && count === 1) {
        return new Response(JSON.stringify({ data: null }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '0.05' },
        })
      }
      const episodes = page === 1 ? [1, 2] : page === 2 ? [3, 4] : [5, 6]
      return new Response(JSON.stringify(schedulePage(page, 3, episodes)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const items = await alSchedule(1_700_000_000, 1_700_100_000)

    expect(items.map((item) => item.episode)).toEqual([1, 2, 3, 4, 5, 6])
    expect(fetchMock).toHaveBeenCalledTimes(4)
  }, 15_000)
})
