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
  it('fetches remaining pages concurrently and preserves episode order', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const seenPages: number[] = []
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      const page = (JSON.parse(String(init?.body)) as { variables: { page: number } }).variables.page
      seenPages.push(page)
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      try {
        // Overlap window: with a serial loop the second fetch starts only
        // after the first resolves, so maxInFlight stays 1.
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
    expect(maxInFlight).toBeGreaterThanOrEqual(2)
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

  it('never bursts more than 3 concurrent AniList requests across a wide range', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      const page = (JSON.parse(String(init?.body)) as { variables: { page: number } }).variables.page
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      try {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return new Response(JSON.stringify(schedulePage(page, 8, [page])), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      } finally {
        inFlight -= 1
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const items = await alSchedule(1_700_000_000, 1_700_100_000)

    expect(items.map((item) => item.episode)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(fetchMock).toHaveBeenCalledTimes(8)
    expect(maxInFlight).toBeLessThanOrEqual(3)
  })

  it('survives an AniList burst limit instead of surfacing 429', async () => {
    let burstInFlight = 0
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      const page = (JSON.parse(String(init?.body)) as { variables: { page: number } }).variables.page
      // Simulate AniList burst protection: more than 3 in flight is rejected.
      // The hold lets overlapping requests accumulate so a wide fan-out trips
      // it, and the single client retry re-bursts and exhausts its budget.
      burstInFlight += 1
      await new Promise((resolve) => setTimeout(resolve, 10))
      const burst = burstInFlight > 3
      try {
        if (burst) {
          return new Response(JSON.stringify({ data: null }), {
            status: 429,
            headers: { 'content-type': 'application/json', 'retry-after': '0.05' },
          })
        }
        return new Response(JSON.stringify(schedulePage(page, 10, [page])), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      } finally {
        burstInFlight -= 1
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const items = await alSchedule(1_700_000_000, 1_700_100_000)

    expect(items.map((item) => item.episode)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  }, 15_000)
})
