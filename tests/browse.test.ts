import { beforeEach, describe, expect, it, vi } from 'vitest'
import { browseSearchSchema, makeBrowseSearch, pageWindow, searchAtPage, searchWithoutFilter } from '../app/lib/browse'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../app/data/anilist/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../app/data/anilist/client')>()
  return { ...original, anilistClient: { request } }
})

import { alBrowse } from '../app/data/anilist/queries'

describe('browse search state', () => {
  it('normalizes blank controls and restores page and sort defaults', () => {
    expect(browseSearchSchema.parse({ format: '', status: '', season: '', sort: '', page: '' })).toEqual({
      query: undefined,
      genre: undefined,
      format: undefined,
      status: undefined,
      season: undefined,
      year: undefined,
      sort: 'TRENDING_DESC',
      page: 1,
    })
  })

  it('preserves filters across pages and returns to page 1 when one is removed', () => {
    const search = makeBrowseSearch({ genre: 'Action', status: 'RELEASING', page: 1 })
    expect(searchAtPage(search, 2)).toMatchObject({ genre: 'Action', status: 'RELEASING', page: 2 })
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

    await expect(alBrowse({ page: 2, genre: 'Action', status: null })).resolves.toMatchObject({
      pageInfo: { currentPage: 2, lastPage: 8, hasNextPage: true, total: 184 },
    })

    const [query, variables] = request.mock.calls[0] as [string, Record<string, unknown>]
    expect(query).toContain('genre:$genre')
    expect(query).not.toContain('status:$status')
    expect(query).toContain('pageInfo{ currentPage lastPage hasNextPage total }')
    expect(variables).toMatchObject({ page: 2, genre: 'Action' })
    expect(variables).not.toHaveProperty('status')
  })
})
