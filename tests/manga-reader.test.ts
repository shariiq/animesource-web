import { beforeEach, describe, expect, it, vi } from 'vitest'
import { chapterDisplayNumber, chapterIdForNumber, chapterIdForRoute, chapterNeighbors, chapterRouteValue, createMangaReaderSession, normalizeChapters, normalizePages, resolveStartChapterId } from '../app/components/manga/reader/createMangaReaderSession'
import { detailShape } from '../app/data/anilist/schema'
import type { AniSourceManga, ChapterPage, MangaChapter } from '../app/data/anisource/schema'
import { DEFAULT_MANGA_READER_SETTINGS, mangaReaderData, resolveMangaReaderDefaults, type MangaReaderRecord, type MangaReaderSettings } from '../app/lib/persistence/mangaReader'
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

  it('uses numbered Battle titles when a Source returns zero for every Chapter', () => {
    const chapters = [570, 2, 1].map((number) => ({
      ...chapter(`battle-${number}`, 0),
      title: `Battle ${number}`,
      url: 'https://source.test/shijou-saikyou-no-deshi-kenichi',
    }))

    const normalized = normalizeChapters(chapters)
    expect(normalized.map(({ id, number }) => [id, number])).toEqual([
      ['battle-1', 1],
      ['battle-2', 2],
      ['battle-570', 570],
    ])
    expect(chapterIdForRoute(normalized, '570')).toBe('battle-570')
    expect(chapterNeighbors(normalized, 'battle-2').next?.id).toBe('battle-570')
  })

  it('does not mistake a number in a Manga title for a Chapter number', () => {
    const entry = { ...chapter('special', 0), title: '100 Girlfriends special', url: 'https://source.test/100-girlfriends/special' }
    expect(normalizeChapters([entry])[0]).toMatchObject({ number: 1, numberOrigin: 'position' })
  })

  it('takes the leading Source installment label before another numbered phrase', () => {
    const entry = { ...chapter('battle-570', 0), title: 'Battle 570: Chapter 12 begins' }
    expect(normalizeChapters([entry])[0]?.number).toBe(570)
  })

  it('does not assign a made-up number from manga metadata or a numbered subtitle', () => {
    const chapters = normalizeChapters([
      { ...chapter('special', 0), title: 'Special: Battle 570', url: 'https://source.test/100-girlfriends/special' },
      { ...chapter('chapter-2', 0), title: 'Chapter 2', url: 'https://source.test/100-girlfriends/chapter-2' },
    ])
    expect(chapters.find((entry) => entry.id === 'special')).toMatchObject({ number: 1, numberOrigin: 'position' })
    expect(chapterRouteValue(chapters, chapters.find((entry) => entry.id === 'special')!)).toBe('id:special')
    expect(chapterIdForRoute(chapters, 'id:special')).toBe('special')
    expect(chapterIdForNumber(chapters, '2')).toBe('chapter-2')
  })

  it('routes duplicate numbers by Chapter ID instead of opening the first Match', () => {
    const chapters = normalizeChapters([
      { ...chapter('translation-a', 12), title: 'Chapter 12' },
      { ...chapter('translation-b', 12), title: 'Chapter 12 (alternate)' },
    ])
    expect(chapterIdForNumber(chapters, '12')).toBeNull()
    expect(chapters.map((entry) => chapterRouteValue(chapters, entry))).toEqual(['id:translation-a', 'id:translation-b'])
    expect(chapterIdForRoute(chapters, 'id:translation-b')).toBe('translation-b')
  })

  it('recovers distinct title numbers when a Source repeats the same nonzero placeholder', () => {
    const chapters = normalizeChapters([
      { ...chapter('battle-7', 1), title: 'Battle 7' },
      { ...chapter('battle-8', 1), title: 'Battle 8' },
    ])
    expect(chapters.map(({ number, numberOrigin }) => [number, numberOrigin])).toEqual([[7, 'title'], [8, 'title']])
    expect(chapterIdForRoute(chapters, '8')).toBe('battle-8')
  })

  it('keeps a real Chapter zero distinct from an unknown number', () => {
    const chapters = normalizeChapters([
      { ...chapter('unknown', 0), title: 'Prologue' },
      { ...chapter('zero', 0), title: 'Chapter 0' },
    ])
    expect(chapters.find((entry) => entry.id === 'unknown')).toMatchObject({ number: 2, numberOrigin: 'position' })
    expect(chapterDisplayNumber(chapters.find((entry) => entry.id === 'zero')!)).toBe('0')
    expect(chapterIdForRoute(chapters, '0')).toBe('zero')
    expect(chapterRouteValue(chapters, chapters.find((entry) => entry.id === 'unknown')!)).toBe('id:unknown')
  })

  it('accepts decimal chapter titles and final URL segments without reading a manga slug', () => {
    const chapters = normalizeChapters([
      { ...chapter('fraction', 0), title: 'Chapter 12.5: Interlude' },
      { ...chapter('from-url', 0), title: 'Extra', url: 'https://source.test/manga-99/chapter-13' },
    ])
    expect(chapters.map(({ number }) => number)).toEqual([12.5, 13])
    expect(chapterIdForRoute(chapters, '12.5')).toBe('fraction')
  })

  it('numbers unlabelled Chapters from list length in either Source order without making routes ambiguous', () => {
    const entries = [1, 2, 3].map((index) => ({ ...chapter(`opaque-${index}`, 0), title: 'Untitled', url: 'https://source.test/manga-99/opaque' }))
    const newestFirst = normalizeChapters(entries)
    expect(newestFirst.map(({ id, number, numberOrigin }) => [id, number, numberOrigin])).toEqual([
      ['opaque-3', 1, 'position'], ['opaque-2', 2, 'position'], ['opaque-1', 3, 'position'],
    ])
    expect(chapterRouteValue(newestFirst, newestFirst[0]!)).toBe('id:opaque-3')
    expect(chapterIdForNumber(newestFirst, '1')).toBeNull()

    const oldestFirst = normalizeChapters([
      { ...entries[0]!, title: 'Chapter 1' }, entries[1]!, entries[2]!,
    ])
    expect(oldestFirst.map(({ id, number }) => [id, number])).toEqual([
      ['opaque-1', 1], ['opaque-2', 2], ['opaque-3', 3],
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
  function sessionWithResults(results: (sourceId: string) => AniSourceManga[], defaults: MangaReaderSettings = DEFAULT_MANGA_READER_SETTINGS, mangaDetail = manga) {
    const searches: string[] = []
    const savedRecords: MangaReaderRecord[] = []
    const session = createMangaReaderSession({
      manga: mangaDetail,
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

  it.each([
    ['KR', 'continuous', 'none'],
    ['CN', 'continuous', 'none'],
    ['kr', 'continuous', 'none'],
    ['JP', 'paged', 'large'],
    ['TW', 'paged', 'large'],
    [null, 'paged', 'large'],
  ] as const)('resolves %s origin to layout %s and gap %s without touching other settings', (origin, layout, gap) => {
    const base: MangaReaderSettings = {
      layout: 'paged',
      direction: 'ltr',
      fit: 'fit-screen',
      background: 'paper',
      gap: 'large',
    }

    expect(resolveMangaReaderDefaults(origin, base)).toEqual({ ...base, layout, gap })
  })

  it('starts KR and CN titles seamless while JP keeps the global gap', async () => {
    const mangaFor = (countryOfOrigin: string | null) => ({ ...manga, countryOfOrigin })
    const globalDefaults: MangaReaderSettings = { ...DEFAULT_MANGA_READER_SETTINGS }

    const korean = sessionWithResults(() => [mangaCandidate], globalDefaults, mangaFor('KR'))
    await korean.session.initialize()
    expect(korean.session.layout()).toBe('continuous')
    expect(korean.session.gap()).toBe('none')

    const chinese = sessionWithResults(() => [mangaCandidate], globalDefaults, mangaFor('CN'))
    await chinese.session.initialize()
    expect(chinese.session.layout()).toBe('continuous')
    expect(chinese.session.gap()).toBe('none')

    const japanese = sessionWithResults(() => [mangaCandidate], globalDefaults, mangaFor('JP'))
    await japanese.session.initialize()
    expect(japanese.session.layout()).toBe('continuous')
    expect(japanese.session.gap()).toBe('small')
  })

  it('lets a saved manga record win over the KR seamless default', async () => {
    const stored: MangaReaderRecord = {
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
      pageIndex: 0,
      pageCount: 10,
      completed: false,
      layout: 'paged',
      direction: 'ltr',
      fit: 'fit-screen',
      background: 'paper',
      gap: 'large',
      updatedAt: 1,
    }
    const koreanManga = { ...manga, countryOfOrigin: 'KR' as const }
    const session = createMangaReaderSession({
      manga: koreanManga,
      routeChapterNumber: () => '1',
      sourceSearchParam: () => undefined,
      navigateToChapter: async () => undefined,
      persistence: {
        get: async () => stored,
        getDefaults: async () => DEFAULT_MANGA_READER_SETTINGS,
        list: async () => [stored],
        save: async () => undefined,
        saveSettings: async (record) => record,
        saveDefaults: async () => undefined,
        remove: async () => undefined,
      },
      api: {
        mangaSources: async () => ({ sources: [{ id: 'source-a', name: 'Source A', base_url: '' }], count: 1 }),
        mangaSearch: async () => ({ items: [mangaCandidate], page: 1, has_next: false, total_returned: 1 }),
        mangaChapters: async () => [chapter('c1', 1)],
        mangaPages: async () => [{ index: 0, url: 'page-1', page_url: '' }],
      },
    })

    await session.initialize()

    expect(session.layout()).toBe('paged')
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
