import { afterEach, describe, expect, it, vi } from 'vitest'
import { browseSearchSchema, makeBrowseSearch, pageWindow, searchAtPage, searchWithoutFilter } from '../app/lib/browse'

import { alBrowse, alHome } from '../app/data/anilist/queries'

const response = (data: unknown) => new Response(JSON.stringify({ data }), {
  status: 200,
  headers: { 'content-type': 'application/json' },
})

function stubAniList(data: unknown) {
  const fetch = vi.fn(async (_input: string, _init?: RequestInit) => response(data))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

function requestedBody(fetch: ReturnType<typeof stubAniList>) {
  return JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as {
    query: string
    variables: Record<string, unknown>
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('browse search state', () => {
  it('normalizes blank controls and restores page and sort defaults', () => {
    expect(browseSearchSchema.parse({ format: '', status: '', season: '', sort: '', page: '' })).toEqual({
      query: undefined,
      genre: undefined,
      format: undefined,
      status: undefined,
      countryOfOrigin: undefined,
      season: undefined,
      year: undefined,
      sort: 'TRENDING_DESC',
      page: 1,
    })
  })

  it('preserves filters across pages and returns to page 1 when one is removed', () => {
    const search = makeBrowseSearch({ genre: 'Action', status: 'RELEASING', countryOfOrigin: 'JP', page: 1 })
    expect(searchAtPage(search, 2)).toMatchObject({ genre: 'Action', status: 'RELEASING', countryOfOrigin: 'JP', page: 2 })
    expect(searchWithoutFilter(searchAtPage(search, 2), 'genre')).toMatchObject({ genre: undefined, status: 'RELEASING', page: 1 })
    expect(pageWindow(4, 10)).toEqual([2, 3, 4, 5, 6])
    expect(pageWindow(10, 10)).toEqual([6, 7, 8, 9, 10])
  })
})

describe('AniList browse boundary', () => {
  it('omits unset filters and validates complete page metadata', async () => {
    const fetch = stubAniList({
      Page: {
        pageInfo: { currentPage: 2, lastPage: 8, hasNextPage: true, total: 184 },
        media: [],
      },
    })

    await expect(alBrowse({ page: 2, genre: 'Action', status: null, countryOfOrigin: 'JP' })).resolves.toMatchObject({
      pageInfo: { currentPage: 2, lastPage: 8, hasNextPage: true, total: 184 },
    })

    const { query, variables } = requestedBody(fetch)
    expect(query).toContain('genre:$genre')
    expect(query).toContain('countryOfOrigin:$countryOfOrigin')
    expect(query).not.toContain('status:$status')
    expect(query).toContain('pageInfo{ currentPage lastPage hasNextPage total }')
    expect(variables).toMatchObject({ page: 2, genre: 'Action', countryOfOrigin: 'JP' })
    expect(variables).not.toHaveProperty('status')
  })

  it('passes the canonical updated sort to AniList', async () => {
    const fetch = stubAniList({
      Page: {
        pageInfo: { currentPage: 1, lastPage: 1, hasNextPage: false, total: 0 },
        media: [],
      },
    })

    const search = makeBrowseSearch({ sort: 'UPDATED_AT_DESC' })
    await alBrowse({ page: search.page, sort: search.sort }, 'MANGA')

    const { variables } = requestedBody(fetch)
    expect(variables).toMatchObject({ sort: ['UPDATED_AT_DESC'] })
  })

  it('uses the selected catalog type for manga browse requests', async () => {
    const fetch = stubAniList({
      Page: {
        pageInfo: { currentPage: 1, lastPage: 1, hasNextPage: false, total: 1 },
        media: [],
      },
    })

    await alBrowse({ page: 1, format: 'MANGA' }, 'MANGA')

    const { query } = requestedBody(fetch)
    expect(query).toContain('type:MANGA')
    expect(query).toContain('format:$format')
  })
})

describe('AniList catalog home boundary', () => {
  it('requests manga rails with publication-aware sorts and fields', async () => {
    const fetch = stubAniList({
      trending: { media: [] },
      season: { media: [] },
      allTime: { media: [] },
      topRated: { media: [] },
      upcoming: { media: [] },
    })
    await alHome('MANGA')

    const { query, variables } = requestedBody(fetch)
    expect(query).toContain('type:MANGA')
    expect(query).toContain('sort:UPDATED_AT_DESC')
    expect(query).toContain('chapters')
    expect(query).toContain('volumes')
    expect(query).not.toContain('$season:MediaSeason')
    expect(variables).toEqual({})
  })
})
