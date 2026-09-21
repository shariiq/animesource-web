import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BROWSE_COUNTRIES, browseSearchSchema, makeBrowseSearch, pageWindow, searchAtPage, searchWithoutFilter } from '../app/lib/browse'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../app/data/anilist/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../app/data/anilist/client')>()
  return { ...original, anilistClient: { request } }
})

import { alBrowse, alHome } from '../app/data/anilist/queries'

describe('browse search state', () => {
  it('uses the AniList catalog origin choices', () => {
    expect(BROWSE_COUNTRIES).toEqual([
      ['JP', 'Japan'],
      ['KR', 'South Korea'],
      ['CN', 'China'],
      ['TW', 'Taiwan'],
    ])
  })

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
  beforeEach(() => request.mockReset())

  it('omits unset filters and validates complete page metadata', async () => {
    request.mockResolvedValue({
      Page: {
        pageInfo: { currentPage: 2, lastPage: 8, hasNextPage: true, total: 184 },
        media: [],
      },
    })

    await expect(alBrowse({ page: 2, genre: 'Action', status: null, countryOfOrigin: 'JP' })).resolves.toMatchObject({
      pageInfo: { currentPage: 2, lastPage: 8, hasNextPage: true, total: 184 },
    })

    const [query, variables] = request.mock.calls[0] as [string, Record<string, unknown>]
    expect(query).toContain('genre:$genre')
    expect(query).toContain('countryOfOrigin:$countryOfOrigin')
    expect(query).not.toContain('status:$status')
    expect(query).toContain('pageInfo{ currentPage lastPage hasNextPage total }')
    expect(variables).toMatchObject({ page: 2, genre: 'Action', countryOfOrigin: 'JP' })
    expect(variables).not.toHaveProperty('status')
  })

  it('passes the canonical updated sort to AniList', async () => {
    request.mockResolvedValue({
      Page: {
        pageInfo: { currentPage: 1, lastPage: 1, hasNextPage: false, total: 0 },
        media: [],
      },
    })

    const search = makeBrowseSearch({ sort: 'UPDATED_AT_DESC' })
    await alBrowse({ page: search.page, sort: search.sort }, 'MANGA')

    const [, variables] = request.mock.calls[0] as [string, Record<string, unknown>]
    expect(variables).toMatchObject({ sort: ['UPDATED_AT_DESC'] })
  })

  it('uses the selected catalog type for manga browse requests', async () => {
    request.mockResolvedValue({
      Page: {
        pageInfo: { currentPage: 1, lastPage: 1, hasNextPage: false, total: 1 },
        media: [],
      },
    })

    await alBrowse({ page: 1, format: 'MANGA' }, 'MANGA')

    const [query] = request.mock.calls[0] as [string]
    expect(query).toContain('type:MANGA')
    expect(query).toContain('format:$format')
  })
})

describe('AniList catalog home boundary', () => {
  beforeEach(() => {
    request.mockReset()
    request.mockResolvedValue({
      trending: { media: [] },
      season: { media: [] },
      allTime: { media: [] },
      topRated: { media: [] },
      upcoming: { media: [] },
    })
  })

  it('requests manga rails with publication-aware sorts and fields', async () => {
    await expect(alHome('MANGA')).resolves.toEqual({
      trending: { media: [] },
      season: { media: [] },
      allTime: { media: [] },
      topRated: { media: [] },
      upcoming: { media: [] },
    })

    const [query, variables] = request.mock.calls[0] as [string, Record<string, unknown>]
    expect(query).toContain('type:MANGA')
    expect(query).toContain('sort:UPDATED_AT_DESC')
    expect(query).toContain('chapters')
    expect(query).toContain('volumes')
    expect(query).not.toContain('$season:MediaSeason')
    expect(variables).toEqual({})
  })
})
