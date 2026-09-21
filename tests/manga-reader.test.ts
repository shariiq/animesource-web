import { describe, expect, it } from 'vitest'
import { chapterIdForNumber, chapterIdForRoute, chapterNeighbors, normalizeChapters, normalizePages, resolveStartChapterId } from '../app/components/manga/reader/createMangaReaderSession'
import type { ChapterPage, MangaChapter } from '../app/data/anisource/schema'
import type { MangaReaderRecord } from '../app/lib/persistence/mangaReader'

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
