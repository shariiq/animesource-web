import { createSignal, type Accessor } from 'solid-js'
import { AniSourceError, resolveUrl } from '../../../data/anisource/client'
import type {
  AniSourceManga,
  ChapterPage,
  MangaChapter,
  SourceInfo,
  SourceListResponse,
} from '../../../data/anisource/schema'
import { matchFlow, titleVariants, type RankedCandidate } from '../../../data/matching'
import type { AniListDetail } from '../../../data/anilist/types'
import { titleOf } from '../../../lib/format'
import {
  mangaReaderData,
  type MangaReaderBackground,
  type MangaReaderDirection,
  type MangaReaderFit,
  type MangaReaderGap,
  type MangaReaderLayout,
  type MangaReaderPersistence,
  type MangaReaderRecord,
} from '../../../lib/persistence/mangaReader'

export type {
  MangaReaderBackground,
  MangaReaderDirection,
  MangaReaderFit,
  MangaReaderGap,
  MangaReaderLayout,
} from '../../../lib/persistence/mangaReader'

export type MangaReaderStage =
  | 'sources-loading'
  | 'matching'
  | 'match-picker'
  | 'match-empty'
  | 'chapters-loading'
  | 'ready'
  | 'pages-loading'
  | 'pages-ready'
  | 'empty'
  | 'error'

export type MangaReaderErrorKind = 'network' | 'timeout' | 'invalid' | 'unavailable' | 'empty' | 'persistence' | 'cancelled'

export interface MangaReaderError {
  kind: MangaReaderErrorKind
  operation: 'sources' | 'match' | 'chapters' | 'pages' | 'page' | 'persistence'
  message: string
  retryable: boolean
}

export interface MangaSourceClient {
  mangaSources(onSlow?: () => void, signal?: AbortSignal): Promise<SourceListResponse>
  mangaSearch(sourceId: string, query: string, page?: number, onSlow?: () => void, signal?: AbortSignal): Promise<{ items: AniSourceManga[]; page: number; has_next: boolean; total_returned: number }>
  mangaChapters(sourceId: string, mangaId: string, onSlow?: () => void, signal?: AbortSignal): Promise<MangaChapter[]>
  mangaPages(sourceId: string, chapterId: string, onSlow?: () => void, signal?: AbortSignal): Promise<ChapterPage[]>
}

export interface MangaReaderSessionOptions {
  manga: AniListDetail
  routeChapterNumber: Accessor<string>
  sourceSearchParam: Accessor<string | undefined>
  api: MangaSourceClient
  persistence?: MangaReaderPersistence
  navigateToChapter: (chapterNumber: string, sourceId: string, replace?: boolean) => Promise<void>
}

export interface MangaReaderSession {
  stage: Accessor<MangaReaderStage>
  slow: Accessor<boolean>
  error: Accessor<MangaReaderError | null>
  persistenceError: Accessor<string | null>
  statusText: Accessor<string>
  sources: Accessor<SourceInfo[]>
  selectedSource: Accessor<string>
  selectedSourceName: Accessor<string>
  matchedManga: Accessor<AniSourceManga | null>
  pickerCandidates: Accessor<RankedCandidate<AniSourceManga>[]>
  chapters: Accessor<MangaChapter[]>
  selectedChapter: Accessor<MangaChapter | null>
  pages: Accessor<ChapterPage[]>
  currentPage: Accessor<number>
  layout: Accessor<MangaReaderLayout>
  direction: Accessor<MangaReaderDirection>
  fit: Accessor<MangaReaderFit>
  background: Accessor<MangaReaderBackground>
  gap: Accessor<MangaReaderGap>
  previousChapter: Accessor<MangaChapter | null>
  nextChapter: Accessor<MangaChapter | null>
  savedRecord: Accessor<MangaReaderRecord | null>
  initialize: () => Promise<void>
  chooseSource: (sourceId: string) => Promise<void>
  chooseMatch: (candidate: AniSourceManga) => Promise<void>
  search: (query: string) => Promise<void>
  chooseChapter: (chapterId: string) => Promise<void>
  retry: () => Promise<void>
  retryPages: () => Promise<void>
  refreshPages: () => Promise<boolean>
  setPage: (pageIndex: number) => void
  setLayout: (layout: MangaReaderLayout) => void
  setDirection: (direction: MangaReaderDirection) => void
  setFit: (fit: MangaReaderFit) => void
  setBackground: (background: MangaReaderBackground) => void
  setGap: (gap: MangaReaderGap) => void
  /** Silently fetches the next chapter's pages into the cache so advancing is instant. */
  prefetchNextChapter: () => Promise<void>
  /** Returns cached pages for a chapter already fetched or prefetched, if any. */
  cachedPages: (chapterId: string) => ChapterPage[] | undefined
  markComplete: () => Promise<void>
  dispose: () => void
}

const INITIAL_LAYOUT: MangaReaderLayout = 'continuous'
const INITIAL_DIRECTION: MangaReaderDirection = 'rtl'
const INITIAL_FIT: MangaReaderFit = 'fit-width'
const INITIAL_BACKGROUND: MangaReaderBackground = 'ink'
const INITIAL_GAP: MangaReaderGap = 'small'
/** Bounded so long reading sessions never accumulate unbounded page metadata. */
const PAGE_CACHE_LIMIT = 3
const START_CHAPTER_TOKEN = 'start'
const LATEST_CHAPTER_TOKEN = 'latest'
const CONTINUE_CHAPTER_TOKEN = 'continue'

const SOURCE_CHAPTER_NUMBER_PATTERN = /\b(?:chapter|chap\.?|ch\.?|episode|ep\.?)\s*#?\s*(\d+(?:\.\d+)?)/i

function chapterNumberFromSource(chapter: MangaChapter): number {
  if (Number.isFinite(chapter.number) && chapter.number !== 0) return chapter.number
  const match = `${chapter.title} ${chapter.url}`.match(SOURCE_CHAPTER_NUMBER_PATTERN)
  const inferred = match?.[1] ? Number(match[1]) : NaN
  return Number.isFinite(inferred) ? inferred : chapter.number
}

export function normalizeChapters(chapters: readonly MangaChapter[]): MangaChapter[] {
  return chapters
    .map((chapter, index) => ({ chapter: { ...chapter, number: chapterNumberFromSource(chapter) }, index }))
    .sort((left, right) => {
      const numberOrder = left.chapter.number - right.chapter.number
      return Number.isFinite(numberOrder) && numberOrder !== 0 ? numberOrder : left.index - right.index
    })
    .map(({ chapter }) => chapter)
}

export function normalizePages(pages: readonly ChapterPage[]): ChapterPage[] {
  return pages
    .map((page, index) => ({ page, index }))
    .sort((left, right) => left.page.index - right.page.index || left.index - right.index)
    .map(({ page }) => page)
}

export function chapterNeighbors(chapters: readonly MangaChapter[], chapterId: string): { previous: MangaChapter | null; next: MangaChapter | null } {
  const index = chapters.findIndex((chapter) => chapter.id === chapterId)
  return {
    previous: index > 0 ? chapters[index - 1] ?? null : null,
    next: index >= 0 ? chapters[index + 1] ?? null : null,
  }
}

export function chapterIdForNumber(chapters: readonly MangaChapter[], chapterNumber: string): string | null {
  const requested = Number(chapterNumber)
  if (!Number.isFinite(requested)) return null
  return chapters.find((chapter) => chapter.number === requested)?.id ?? null
}

export function chapterIdForRoute(chapters: readonly MangaChapter[], routeValue: string): string | null {
  return chapterIdForNumber(chapters, routeValue) ?? chapters.find((chapter) => chapter.id === routeValue)?.id ?? null
}

export function resolveStartChapterId(
  chapters: readonly MangaChapter[],
  record: MangaReaderRecord | null,
  sourceId: string,
  mangaId: string,
): string | null {
  if (!record || record.sourceId !== sourceId || record.mangaId !== mangaId) return chapters[0]?.id ?? null
  const lastReadIndex = chapters.findIndex((chapter) => chapter.id === record.chapterId)
  if (lastReadIndex < 0) return chapters[0]?.id ?? null
  if (!record.completed) return chapters[lastReadIndex]?.id ?? null
  return chapters[lastReadIndex + 1]?.id ?? chapters[lastReadIndex]?.id ?? null
}

function isSpecialChapterToken(value: string): boolean {
  return value === START_CHAPTER_TOKEN || value === LATEST_CHAPTER_TOKEN || value === CONTINUE_CHAPTER_TOKEN
}

function isLegacyZeroStartRoute(chapters: readonly MangaChapter[], value: string): boolean {
  return value === '0' && !chapters.some((chapter) => chapter.number === 0)
}

function describeError(error: unknown, operation: MangaReaderError['operation']): MangaReaderError {
  if (error instanceof AniSourceError) {
    return {
      kind: error.kind === 'cancelled' ? 'cancelled' : error.kind === 'http' ? 'unavailable' : error.kind,
      operation,
      message: error.message,
      retryable: error.kind !== 'invalid' && error.kind !== 'cancelled',
    }
  }
  return {
    kind: 'network',
    operation,
    message: error instanceof Error ? error.message : 'The manga reading service returned an unexpected error.',
    retryable: true,
  }
}

function displaySourceName(sources: readonly SourceInfo[], sourceId: string): string {
  return sources.find((source) => source.id === sourceId)?.name ?? sourceId
}

function validPageIndex(pageIndex: number, pageCount: number): number {
  if (pageCount <= 0) return 0
  return Math.max(0, Math.min(pageCount - 1, Math.trunc(pageIndex)))
}

export function createMangaReaderSession(options: MangaReaderSessionOptions): MangaReaderSession {
  const persistence = options.persistence ?? mangaReaderData
  const [stage, setStage] = createSignal<MangaReaderStage>('sources-loading')
  const [slow, setSlow] = createSignal(false)
  const [error, setError] = createSignal<MangaReaderError | null>(null)
  const [persistenceError, setPersistenceError] = createSignal<string | null>(null)
  const [sources, setSources] = createSignal<SourceInfo[]>([])
  const [selectedSource, setSelectedSource] = createSignal('')
  const [matchedManga, setMatchedManga] = createSignal<AniSourceManga | null>(null)
  const [pickerCandidates, setPickerCandidates] = createSignal<RankedCandidate<AniSourceManga>[]>([])
  const [chapters, setChapters] = createSignal<MangaChapter[]>([])
  const [selectedChapterId, setSelectedChapterId] = createSignal<string | null>(null)
  const [pages, setPages] = createSignal<ChapterPage[]>([])
  const [currentPage, setCurrentPage] = createSignal(0)
  const [layout, setLayout] = createSignal<MangaReaderLayout>(INITIAL_LAYOUT)
  const [direction, setDirection] = createSignal<MangaReaderDirection>(INITIAL_DIRECTION)
  const [fit, setFit] = createSignal<MangaReaderFit>(INITIAL_FIT)
  const [background, setBackground] = createSignal<MangaReaderBackground>(INITIAL_BACKGROUND)
  const [gap, setGap] = createSignal<MangaReaderGap>(INITIAL_GAP)
  const [savedRecord, setSavedRecord] = createSignal<MangaReaderRecord | null>(null)

  let disposed = false
  let operationId = 0
  let controller: AbortController | null = null
  let prefetchController: AbortController | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let lastFailedOperation: MangaReaderError['operation'] | null = null
  /** Chapter pages already fetched (or prefetched) this session, keyed by chapter id. */
  const pageCache = new Map<string, ChapterPage[]>()

  const sourceName = () => displaySourceName(sources(), selectedSource())
  const selectedChapter = () => chapters().find((chapter) => chapter.id === selectedChapterId()) ?? null
  const neighbors = () => chapterNeighbors(chapters(), selectedChapterId() ?? '')
  const previousChapter = () => neighbors().previous
  const nextChapter = () => neighbors().next

  function cancelActiveRequest(): void {
    operationId += 1
    controller?.abort()
    controller = null
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
  }

  function beginRequest(): { signal: AbortSignal; id: number } {
    controller?.abort()
    const nextController = new AbortController()
    controller = nextController
    const id = ++operationId
    setSlow(false)
    setError(null)
    return { signal: nextController.signal, id }
  }

  function isCurrent(id: number, signal: AbortSignal): boolean {
    return !disposed && operationId === id && !signal.aborted
  }

  function cachePages(chapterId: string, chapterPages: ChapterPage[]): void {
    if (chapterPages.length === 0) return
    // Refresh insertion order so the oldest entry is always evicted first.
    pageCache.delete(chapterId)
    pageCache.set(chapterId, chapterPages)
    while (pageCache.size > PAGE_CACHE_LIMIT) {
      const oldest = pageCache.keys().next().value
      if (oldest === undefined) break
      pageCache.delete(oldest)
    }
  }

  function clearPageCache(): void {
    pageCache.clear()
    prefetchController?.abort()
    prefetchController = null
  }

  function cachedPages(chapterId: string): ChapterPage[] | undefined {
    return pageCache.get(chapterId)
  }

  async function fetchChapterPages(source: string, chapterId: string, onSlow: () => void, signal: AbortSignal): Promise<ChapterPage[]> {
    const cached = pageCache.get(chapterId)
    if (cached) return cached
    const result = normalizePages(await options.api.mangaPages(source, chapterId, onSlow, signal))
    if (!signal.aborted) cachePages(chapterId, result)
    return result
  }

  function statusText(): string {
    switch (stage()) {
      case 'sources-loading': return slow() ? 'Waking manga sources…' : 'Loading manga sources…'
      case 'matching': return slow() ? 'Waking source · finding this manga…' : 'Finding this manga on the selected source…'
      case 'match-picker': return 'Choose the source record that matches this manga.'
      case 'match-empty': return 'This manga could not be matched on the selected source.'
      case 'chapters-loading': return slow() ? 'Waking source · loading chapters…' : 'Loading the complete chapter list…'
      case 'ready': return `${chapters().length} chapters ready · choose a chapter to begin.`
      case 'pages-loading': return slow() ? 'Waking source · loading pages…' : 'Loading chapter pages…'
      case 'pages-ready': return `${pages().length} pages · ${sourceName()}`
      case 'empty': return 'This chapter has no readable pages.'
      case 'error': return error()?.message ?? 'The manga reader could not continue.'
    }
  }

  function setFailure(nextError: MangaReaderError): void {
    if (nextError.kind === 'cancelled') return
    lastFailedOperation = nextError.operation
    setError(nextError)
    if (nextError.operation === 'match') setStage(pickerCandidates().length > 0 ? 'match-picker' : 'match-empty')
    else if (nextError.operation === 'pages' && nextError.kind === 'empty') setStage('empty')
    else setStage('error')
  }

  function recordBase(chapter: MangaChapter, pageIndex: number, completed: boolean): MangaReaderRecord | null {
    const source = selectedSource()
    const manga = matchedManga()
    if (!source || !manga) return null
    return {
      anilistId: options.manga.id,
      title: titleOf(options.manga),
      cover: options.manga.coverImage?.large ?? options.manga.coverImage?.extraLarge ?? '',
      sourceId: source,
      sourceName: sourceName(),
      mangaId: manga.id,
      mangaUrl: manga.url,
      chapterId: chapter.id,
      chapterNumber: chapter.number,
      chapterTitle: chapter.title,
      pageIndex: validPageIndex(pageIndex, pages().length),
      pageCount: pages().length,
      completed,
      layout: layout(),
      direction: direction(),
      fit: fit(),
      background: background(),
      gap: gap(),
      updatedAt: Date.now(),
    }
  }

  async function persistRecord(record: MangaReaderRecord | null): Promise<void> {
    if (!record) return
    try {
      await persistence.save(record)
      setSavedRecord(record)
      setPersistenceError(null)
    } catch {
      setPersistenceError('Reading progress could not be saved on this device.')
    }
  }

  function scheduleProgressSave(): void {
    const chapter = selectedChapter()
    if (!chapter) return
    if (saveTimer !== null) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void persistRecord(recordBase(chapter, currentPage(), false))
    }, 450)
  }

  function persistReaderSettings(): void {
    const chapter = selectedChapter()
    const stored = savedRecord()
    const record = chapter
      ? recordBase(chapter, currentPage(), stored?.chapterId === chapter.id ? stored.completed : false)
      : stored
        ? {
            ...stored,
            layout: layout(),
            direction: direction(),
            fit: fit(),
            background: background(),
            gap: gap(),
            updatedAt: Date.now(),
          }
        : null
    void persistRecord(record)
  }

  function resolveRouteChapterId(record: MangaReaderRecord | null): string | null {
    const routeNumber = options.routeChapterNumber()
    if (routeNumber === CONTINUE_CHAPTER_TOKEN && record) return record.chapterId
    if (routeNumber === LATEST_CHAPTER_TOKEN) return chapters().at(-1)?.id ?? null
    if (routeNumber === START_CHAPTER_TOKEN || isLegacyZeroStartRoute(chapters(), routeNumber)) {
      return resolveStartChapterId(chapters(), record, selectedSource(), matchedManga()?.id ?? '')
    }
    return chapterIdForRoute(chapters(), routeNumber)
  }

  async function loadPages(chapterId: string, replaceRoute: boolean): Promise<void> {
    const source = selectedSource()
    if (!source) return
    const request = beginRequest()
    setSelectedChapterId(chapterId)
    setPages([])
    setCurrentPage(0)
    setStage('pages-loading')
    try {
      const normalized = await fetchChapterPages(source, chapterId, () => setSlow(true), request.signal)
      if (!isCurrent(request.id, request.signal)) return
      if (normalized.length === 0) {
        setStage('empty')
        setFailure({ kind: 'empty', operation: 'pages', message: 'This chapter has no readable pages.', retryable: true })
        return
      }
      setPages(normalized)
      const record = savedRecord()
      const resumeIndex = record?.sourceId === source && record.mangaId === matchedManga()?.id && record.chapterId === chapterId
        ? validPageIndex(record.pageIndex, normalized.length)
        : 0
      setCurrentPage(resumeIndex)
      setStage('pages-ready')
      if (replaceRoute) await options.navigateToChapter(String(selectedChapter()!.number), source, true)
      await persistRecord(recordBase(selectedChapter()!, resumeIndex, false))
      void prefetchNextChapter()
    } catch (caught) {
      if (!isCurrent(request.id, request.signal)) return
      const nextError = describeError(caught, 'pages')
      setFailure(nextError)
    }
  }

  async function loadChapters(record: MangaReaderRecord | null): Promise<void> {
    const source = selectedSource()
    const manga = matchedManga()
    if (!source || !manga) return
    const request = beginRequest()
    setStage('chapters-loading')
    try {
      const result = await options.api.mangaChapters(source, manga.id, () => setSlow(true), request.signal)
      if (!isCurrent(request.id, request.signal)) return
      const normalized = normalizeChapters(result)
      setChapters(normalized)
      if (normalized.length === 0) {
        setFailure({ kind: 'empty', operation: 'chapters', message: 'This source has no indexed chapters for the matched manga.', retryable: true })
        return
      }
      setStage('ready')
      const chapterId = resolveRouteChapterId(record)
      if (chapterId && normalized.some((chapter) => chapter.id === chapterId)) {
        const routeNumber = options.routeChapterNumber()
        const legacyOpaqueRoute = chapterIdForNumber(normalized, routeNumber) === null
        await loadPages(chapterId, isSpecialChapterToken(routeNumber) || isLegacyZeroStartRoute(normalized, routeNumber) || legacyOpaqueRoute)
      } else if (!isSpecialChapterToken(options.routeChapterNumber())) {
        setFailure({ kind: 'unavailable', operation: 'chapters', message: 'That chapter is no longer available from this source.', retryable: false })
      }
    } catch (caught) {
      if (!isCurrent(request.id, request.signal)) return
      setFailure(describeError(caught, 'chapters'))
    }
  }

  async function applyMatch(candidate: AniSourceManga, record: MangaReaderRecord | null): Promise<void> {
    setMatchedManga(candidate)
    setPickerCandidates([])
    await loadChapters(record)
  }

  async function searchSource(sourceId: string, queryTitles: readonly string[], record: MangaReaderRecord | null): Promise<void> {
    const request = beginRequest()
    setStage('matching')
    setMatchedManga(null)
    setPickerCandidates([])
    try {
      const found = new Map<string, AniSourceManga>()
      for (const query of queryTitles.slice(0, 4)) {
        const result = await options.api.mangaSearch(sourceId, query, 1, () => setSlow(true), request.signal)
        if (!isCurrent(request.id, request.signal)) return
        for (const candidate of result.items) found.set(candidate.id, candidate)
        const ranked = matchFlow(queryTitles, [...found.values()])
        if (ranked.kind === 'auto') {
          await applyMatch(ranked.match.candidate, record)
          return
        }
      }
      if (!isCurrent(request.id, request.signal)) return
      const ranked = matchFlow(queryTitles, [...found.values()])
      if (ranked.kind === 'empty') {
        setStage('match-empty')
        setFailure({ kind: 'unavailable', operation: 'match', message: 'No source manga matched this AniList title.', retryable: true })
        return
      }
      setPickerCandidates(ranked.ranked)
      setStage('match-picker')
    } catch (caught) {
      if (!isCurrent(request.id, request.signal)) return
      setFailure(describeError(caught, 'match'))
    }
  }

  async function initializeSource(sourceId: string, forceSearch: boolean): Promise<void> {
    const record = savedRecord()
    clearPageCache()
    setSelectedSource(sourceId)
    setError(null)
    setPersistenceError(null)
    const savedMatchAvailable = !forceSearch && record?.sourceId === sourceId && record.mangaId
    if (savedMatchAvailable) {
      const savedManga: AniSourceManga = {
        id: record.mangaId,
        title: record.title,
        url: record.mangaUrl,
        thumbnail: record.cover,
        description: '',
        genres: [],
        authors: [],
        artists: [],
        alternative_titles: [],
        status: 'unknown',
      }
      await applyMatch(savedManga, record)
      return
    }
    const variants = titleVariants(options.manga).map((variant) => variant.title)
    await searchSource(sourceId, variants.length > 0 ? variants : [titleOf(options.manga)], record)
  }

  async function initialize(): Promise<void> {
    cancelActiveRequest()
    setStage('sources-loading')
    setError(null)
    setPersistenceError(null)
    try {
      const stored = await persistence.get(options.manga.id)
      if (disposed) return
      setSavedRecord(stored)
      if (stored) {
        setLayout(stored.layout)
        setDirection(stored.direction)
        setFit(stored.fit)
        setBackground(stored.background)
        setGap(stored.gap)
      }
      const request = beginRequest()
      const result = await options.api.mangaSources(() => setSlow(true), request.signal)
      if (!isCurrent(request.id, request.signal)) return
      setSources(result.sources)
      if (result.sources.length === 0) {
        setFailure({ kind: 'empty', operation: 'sources', message: 'No manga sources are currently available.', retryable: true })
        return
      }
      const requested = options.sourceSearchParam()
      const preferred = requested && result.sources.some((source) => source.id === requested)
        ? requested
        : stored?.sourceId && result.sources.some((source) => source.id === stored.sourceId)
          ? stored.sourceId
          : result.sources[0]!.id
      await initializeSource(preferred, false)
    } catch (caught) {
      if (disposed) return
      setFailure(describeError(caught, 'sources'))
    }
  }

  async function chooseSource(sourceId: string): Promise<void> {
    if (!sources().some((source) => source.id === sourceId)) return
    await initializeSource(sourceId, true)
  }

  async function chooseMatch(candidate: AniSourceManga): Promise<void> {
    cancelActiveRequest()
    clearPageCache()
    setMatchedManga(candidate)
    setPickerCandidates([])
    setError(null)
    await loadChapters(savedRecord())
  }

  async function search(query: string): Promise<void> {
    const trimmed = query.trim()
    if (!trimmed || !selectedSource()) return
    await searchSource(selectedSource(), [trimmed, ...titleVariants(options.manga).map((variant) => variant.title)], savedRecord())
  }

  async function chooseChapter(chapterId: string): Promise<void> {
    if (!chapters().some((chapter) => chapter.id === chapterId)) return
    await loadPages(chapterId, true)
  }

  async function prefetchNextChapter(): Promise<void> {
    const source = selectedSource()
    const next = nextChapter()
    if (!source || !next || pageCache.has(next.id) || prefetchController) return
    const request = new AbortController()
    prefetchController = request
    try {
      await fetchChapterPages(source, next.id, () => undefined, request.signal)
    } catch {
      // Prefetching is opportunistic; a failure simply means the chapter loads on demand.
    } finally {
      if (prefetchController === request) prefetchController = null
    }
  }

  async function retry(): Promise<void> {
    if (lastFailedOperation === 'pages') {
      await retryPages()
      return
    }
    await initialize()
  }

  async function retryPages(): Promise<void> {
    const chapter = selectedChapter()
    if (!chapter) {
      await initialize()
      return
    }
    await loadPages(chapter.id, false)
  }

  async function refreshPages(): Promise<boolean> {
    const source = selectedSource()
    const chapter = selectedChapter()
    if (!source || !chapter) return false
    const request = beginRequest()
    try {
      const refreshed = normalizePages(await options.api.mangaPages(source, chapter.id, () => setSlow(true), request.signal))
      if (!isCurrent(request.id, request.signal)) return false
      if (refreshed.length === 0) {
        setError({ kind: 'empty', operation: 'pages', message: 'This chapter has no readable pages.', retryable: true })
        return false
      }
      cachePages(chapter.id, refreshed)
      setPages(refreshed)
      setError(null)
      setStage('pages-ready')
      return true
    } catch (caught) {
      if (!isCurrent(request.id, request.signal)) return false
      const nextError = describeError(caught, 'pages')
      lastFailedOperation = 'pages'
      setError(nextError)
      return false
    }
  }

  function setPage(pageIndex: number): void {
    setCurrentPage(validPageIndex(pageIndex, pages().length))
    scheduleProgressSave()
  }

  function setLayoutPreference(nextLayout: MangaReaderLayout): void {
    setLayout(nextLayout)
    persistReaderSettings()
  }

  function setDirectionPreference(nextDirection: MangaReaderDirection): void {
    setDirection(nextDirection)
    persistReaderSettings()
  }

  function setFitPreference(nextFit: MangaReaderFit): void {
    setFit(nextFit)
    persistReaderSettings()
  }

  function setBackgroundPreference(nextBackground: MangaReaderBackground): void {
    setBackground(nextBackground)
    persistReaderSettings()
  }

  function setGapPreference(nextGap: MangaReaderGap): void {
    setGap(nextGap)
    persistReaderSettings()
  }

  async function markComplete(): Promise<void> {
    const chapter = selectedChapter()
    if (!chapter) return
    const record = recordBase(chapter, Math.max(0, pages().length - 1), true)
    await persistRecord(record)
  }

  function dispose(): void {
    disposed = true
    cancelActiveRequest()
    clearPageCache()
  }

  return {
    stage,
    slow,
    error,
    persistenceError,
    statusText,
    sources,
    selectedSource,
    selectedSourceName: sourceName,
    matchedManga,
    pickerCandidates,
    chapters,
    selectedChapter,
    pages,
    currentPage,
    layout,
    direction,
    fit,
    background,
    gap,
    previousChapter,
    nextChapter,
    savedRecord,
    initialize,
    chooseSource,
    chooseMatch,
    search,
    chooseChapter,
    retry,
    retryPages,
    refreshPages,
    setPage,
    setLayout: setLayoutPreference,
    setDirection: setDirectionPreference,
    setFit: setFitPreference,
    setBackground: setBackgroundPreference,
    setGap: setGapPreference,
    prefetchNextChapter,
    cachedPages,
    markComplete,
    dispose,
  }
}

export function pageSource(page: ChapterPage): string {
  return resolveUrl(page.url) ?? page.url
}
