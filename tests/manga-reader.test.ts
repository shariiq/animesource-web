import { describe, expect, it } from 'vitest'
import { chapterNeighbors, normalizeChapters, normalizePages } from '../app/components/manga/reader/createMangaReaderSession'
import type { ChapterPage, MangaChapter } from '../app/data/anisource/schema'

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
