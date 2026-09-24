import { beforeEach, describe, expect, it, vi } from 'vitest'
import { chapterIdForNumber, chapterIdForRoute, chapterNeighbors, createMangaReaderSession, normalizeChapters, normalizePages, resolveStartChapterId } from '../app/components/manga/reader/createMangaReaderSession'
import { detailShape } from '../app/data/anilist/schema'
import type { AniSourceManga, ChapterPage, MangaChapter } from '../app/data/anisource/schema'
import { DEFAULT_MANGA_READER_SETTINGS, mangaReaderData, type MangaReaderRecord, type MangaReaderSettings } from '../app/lib/persistence/mangaReader'
import { closeDb } from '../app/lib/persistence/indexedDb'

const chapter = (id: string, number: number): MangaChapter => ({
  id,
  number,
  title: `Chapter ${number}`,
  url: `https://source.test/${id}`,
  volume: null,
  scanlator: '',
  language: 'en',
  released_at: null,
})

const manga = detailShape.parse({
  id: 42,
  siteUrl: null,
  title: { english: 'Signal', romaji: 'Signal', native: null },
  coverImage: { extraLarge: null, large: '', medium: null, color: null },
  bannerImage: null,
  averageScore: null,
  meanScore: null,
  popularity: null,
  favourites: null,
  trending: null,
  format: 'MANGA',
  status: 'RELEASING',
  episodes: null,
  season: null,
  seasonYear: null,
  genres: [],
  countryOfOrigin: 'JP',
  isAdult: false,
  nextAiringEpisode: null,
  description: null,
  duration: null,
  startDate: null,
  endDate: null,
  source: null,
  synonyms: [],
  studios: null,
  trailer: null,
  externalLinks: null,
  rankings: null,
  tags: null,
  staff: null,
  characters: null,
  relations: null,
  recommendations: null,
})

const mangaCandidate: AniSourceManga = {
  id: 'signal-manga',
  title: 'Signal',
  url: '',
  thumbnail: '',
  description: '',
  genres: [],
  authors: [],
  artists: [],
  alternative_titles: [],
  status: 'unknown',
}

describe('manga reader ordering', () => {
  it('sorts chapters by chapter number while preserving ties', () => {
    expect(normalizeChapters([chapter('c3', 3), chapter('c1', 1), chapter('c2a', 2), chapter('c2b', 2)]).map((entry) => entry.id)).toEqual(['c1', 'c2a', 'c2b', 'c3'])
  })

  it('derives missing chapter numbers from source titles before choosing a start chapter', () => {
    const latest = { ...chapter('c155', 0), title: 'Episode 155' }
    const first = { ...chapter('c1', 0), title: 'Episode 1' }
    expect(normalizeChapters([latest, first]).map((entry) => [entry.id, entry.number])).toEqual([
      ['c1', 1],
      ['c155', 155],
    ])
  })

  it('resolves public chapter numbers without exposing source chapter ids', () => {
    const chapters = [chapter('opaque-1', 1), chapter('opaque-2', 2)]
    expect(chapterIdForNumber(chapters, '1')).toBe('opaque-1')
    expect(chapterIdForNumber(chapters, 'opaque-1')).toBeNull()
    expect(chapterIdForRoute(chapters, 'opaque-1')).toBe('opaque-1')
  })

  it('starts at the first, unfinished, or next chapter according to local progress', () => {
    const chapters = [chapter('c1', 1), chapter('c2', 2), chapter('c3', 3)]
    const record = (chapterId: string, completed: boolean): MangaReaderRecord => ({
      anilistId: 1,
      title: 'Test Manga',
      cover: '',
      sourceId: 'source',
      sourceName: 'Source',
      mangaId: 'manga-1',
      mangaUrl: '',
      chapterId,
      chapterNumber: Number(chapterId.slice(1)),
      chapterTitle: '',
      pageIndex: 0,
      pageCount: 10,
      completed,
      layout: 'continuous',
      direction: 'rtl',
      fit: 'fit-width',
      background: 'ink',
      gap: 'small',
      updatedAt: 1,
    })

    expect(resolveStartChapterId(chapters, null, 'source', 'manga-1')).toBe('c1')
    expect(resolveStartChapterId(chapters, record('c2', false), 'source', 'manga-1')).toBe('c2')
    expect(resolveStartChapterId(chapters, record('c2', true), 'source', 'manga-1')).toBe('c3')
    expect(resolveStartChapterId(chapters, record('c3', true), 'source', 'manga-1')).toBe('c3')
  })

  it('sorts page metadata by index and keeps stable duplicates', () => {
    const pages: ChapterPage[] = [
      { index: 2, url: 'two', page_url: '' },
      { index: 1, url: 'one', page_url: '' },
      { index: 2, url: 'two-b', page_url: '' },
    ]
    expect(normalizePages(pages).map((page) => page.url)).toEqual(['one', 'two', 'two-b'])
  })

  it('returns adjacent chapters without inventing neighbors', () => {
    const chapters = [chapter('c1', 1), chapter('c2', 2), chapter('c3', 3)]
    expect(chapterNeighbors(chapters, 'c2')).toMatchObject({ previous: { id: 'c1' }, next: { id: 'c3' } })
    expect(chapterNeighbors(chapters, 'missing')).toEqual({ previous: null, next: null })
  })
})

describe('manga reader source matching', () => {
  function sessionWithResults(results: (sourceId: string) => AniSourceManga[], defaults: MangaReaderSettings = DEFAULT_MANGA_READER_SETTINGS) {
    const searches: string[] = []
    const savedRecords: MangaReaderRecord[] = []
    const session = createMangaReaderSession({
      manga,
      routeChapterNumber: () => 'start',
      sourceSearchParam: () => undefined,
      navigateToChapter: async () => undefined,
      persistence: {
        get: async () => null,
        getDefaults: async () => defaults,
        list: async () => [],
        save: async (record) => { savedRecords.push(record) },
        saveSettings: async (record) => { savedRecords.push(record); return record },
        saveDefaults: async () => undefined,
        remove: async () => undefined,
      },
      api: {
        mangaSources: async () => ({
          sources: [
            { id: 'source-a', name: 'Source A', base_url: '' },
            { id: 'source-b', name: 'Source B', base_url: '' },
          ],
          count: 2,
        }),
        mangaSearch: async (sourceId) => {
          searches.push(sourceId)
          const items = results(sourceId)
          return { items, page: 1, has_next: false, total_returned: items.length }
        },
        mangaChapters: async () => [chapter('chapter-1', 1)],
        mangaPages: async () => [{ index: 0, url: 'page-1', page_url: '' }],
      },
    })
    return { searches, savedRecords, session }
  }

  it('tries the next source before opening the picker', async () => {
    const { searches, session } = sessionWithResults((sourceId) => sourceId === 'source-b' ? [mangaCandidate] : [])

    await session.initialize()

    expect(searches).toEqual(['source-a', 'source-b'])
    expect(session.selectedSource()).toBe('source-b')
    expect(session.matchedManga()?.id).toBe('signal-manga')
  })

  it('opens the empty picker only after every source is exhausted', async () => {
    const { searches, session } = sessionWithResults(() => [])

    await session.initialize()

    expect(searches).toEqual(['source-a', 'source-b'])
    expect(session.selectedSource()).toBe('source-b')
    expect(session.stage()).toBe('match-empty')
    expect(session.error()).toBeNull()
  })

  it('keeps a preference changed before settings hydrate and persists it with the first chapter record', async () => {
    const { savedRecords, session } = sessionWithResults(() => [mangaCandidate])
    const initialization = session.initialize()

    session.setGap('none')
    await initialization

    expect(session.gap()).toBe('none')
    expect(savedRecords.at(-1)?.gap).toBe('none')
  })

  it('applies global reader defaults when a manga has no saved settings', async () => {
    const { session } = sessionWithResults(() => [mangaCandidate], {
      layout: 'paged',
      direction: 'ltr',
      fit: 'fit-screen',
      background: 'paper',
      gap: 'large',
    })

    await session.initialize()

    expect(session.layout()).toBe('paged')
    expect(session.direction()).toBe('ltr')
    expect(session.fit()).toBe('fit-screen')
    expect(session.background()).toBe('paper')
    expect(session.gap()).toBe('large')
  })

  it('starts an unread next chapter at page zero instead of reusing the previous chapter position', async () => {
    vi.useFakeTimers()
    try {
      const chapters = [chapter('c1', 1), chapter('c2', 2)]
      const pages = (count: number): ChapterPage[] => Array.from({ length: count }, (_, index) => ({ index, url: `page-${index}`, page_url: '' }))
      let stored: MangaReaderRecord | null = {
        anilistId: 42,
        title: 'Signal',
        cover: '',
        sourceId: 'source-a',
        sourceName: 'Source A',
        mangaId: 'signal-manga',
        mangaUrl: '',
        chapterId: 'c1',
        chapterNumber: 1,
        chapterTitle: 'Chapter 1',
        pageIndex: 4,
        pageCount: 10,
        completed: false,
        ...DEFAULT_MANGA_READER_SETTINGS,
        updatedAt: 1,
      }
      const session = createMangaReaderSession({
        manga,
        routeChapterNumber: () => '1',
        sourceSearchParam: () => undefined,
        navigateToChapter: async () => undefined,
        persistence: {
          get: async () => stored,
          getDefaults: async () => DEFAULT_MANGA_READER_SETTINGS,
          list: async () => (stored ? [stored] : []),
          save: async (record) => { stored = record },
          saveSettings: async (record) => { stored = record; return record },
          saveDefaults: async () => undefined,
          remove: async () => undefined,
        },
        api: {
          mangaSources: async () => ({ sources: [{ id: 'source-a', name: 'Source A', base_url: '' }], count: 1 }),
          mangaSearch: async () => ({ items: [mangaCandidate], page: 1, has_next: false, total_returned: 1 }),
          mangaChapters: async () => chapters,
          mangaPages: async (_sourceId, chapterId) => pages(chapterId === 'c1' ? 10 : 20),
        },
      })

      await session.initialize()
      expect(session.selectedChapter()?.id).toBe('c1')
      expect(session.currentPage()).toBe(4)
      session.setPage(4)

      await session.chooseChapter('c2')
      await vi.advanceTimersByTimeAsync(500)

      expect(session.currentPage()).toBe(0)
      expect(stored?.chapterId).toBe('c2')
      expect(stored?.pageIndex).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('manga reader persistence', () => {
  beforeEach(async () => {
    await closeDb()
    // eslint-disable-next-line no-global-assign -- intentional per-test isolation of the jsdom IndexedDB global
    indexedDB = new IDBFactory()
  })

  it('stores global defaults separately and lists reading records by recency', async () => {
    const settings: MangaReaderSettings = { ...DEFAULT_MANGA_READER_SETTINGS, layout: 'paged' }
    const record: MangaReaderRecord = {
      anilistId: 42,
      title: 'Signal',
      cover: '',
      sourceId: 'source',
      sourceName: 'Source',
      mangaId: 'signal-manga',
      mangaUrl: '',
      chapterId: 'chapter-1',
      chapterNumber: 1,
      chapterTitle: 'Chapter 1',
      pageIndex: 0,
      pageCount: 10,
      completed: false,
      ...settings,
      updatedAt: 10,
    }

    await mangaReaderData.saveDefaults(settings)
    await mangaReaderData.save(record)

    await expect(mangaReaderData.getDefaults()).resolves.toEqual(settings)
    await expect(mangaReaderData.list()).resolves.toEqual([record])
  })

  it('merges a delayed preference save without rolling chapter progress back', async () => {
    const lastRead: MangaReaderRecord = {
      anilistId: 42,
      title: 'Signal',
      cover: '',
      sourceId: 'source',
      sourceName: 'Source',
      mangaId: 'signal-manga',
      mangaUrl: '',
      chapterId: 'chapter-2',
      chapterNumber: 2,
      chapterTitle: 'Chapter 2',
      pageIndex: 6,
      pageCount: 10,
      completed: false,
      ...DEFAULT_MANGA_READER_SETTINGS,
      updatedAt: 20,
    }
    const staleSettingsRecord = { ...lastRead, chapterId: 'chapter-1', chapterNumber: 1, pageIndex: 2, gap: 'none' as const, updatedAt: 30 }

    await mangaReaderData.save(lastRead)
    await mangaReaderData.saveSettings(staleSettingsRecord)

    await expect(mangaReaderData.get(42)).resolves.toMatchObject({
      chapterId: 'chapter-2',
      pageIndex: 6,
      gap: 'none',
    })
  })
})
