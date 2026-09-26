import { createSignal, untrack, type Accessor } from 'solid-js'
import { AniSourceError } from '../../../data/anisource/client'
import type {
  AniSourceManga,
  ChapterPage,
  MangaChapter,
  SourceInfo,
  SourceListResponse,
} from '../../../data/anisource/schema'
import { titleVariants, type RankedCandidate } from '../../../data/matching'
import type { AniListDetail } from '../../../data/anilist/types'
import { titleOf } from '../../../lib/format'
import { describeSourceFailure } from '../../../lib/source-session/errors'
import { runSourceMatchFlow } from '../../../lib/source-session/matchFlow'
import { createCancellableScope, type ScopeOperation } from '../../../lib/source-session/scope'
import {
  DEFAULT_MANGA_READER_SETTINGS,
  mangaReaderData,
  resolveMangaReaderDefaults,
  type MangaReaderBackground,
  type MangaReaderDirection,
  type MangaReaderFit,
  type MangaReaderGap,
  type MangaReaderLayout,
  type MangaReaderPersistence,
  type MangaReaderRecord,
  type MangaReaderSettings,
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

export type MangaReaderErrorKind = 'network' | 'timeout' | 'invalid' | 'unavailable' | 'empty' | 'persistence' | 'cancelled' | 'rate-limited' | 'misconfigured' | 'session-required' | 'automation'

export interface MangaReaderError {
  kind: MangaReaderErrorKind
  operation: 'sources' | 'match' | 'chapters' | 'pages' | 'page' | 'persistence'
  message: string
  retryable: boolean
}

export interface MangaSourceClient {
  mangaSources(onSlow: () => void, signal: AbortSignal): Promise<SourceListResponse>
  mangaSearch(sourceId: string, query: string, page: number, onSlow: () => void, signal: AbortSignal): Promise<{ items: AniSourceManga[]; page: number; has_next: boolean; total_returned: number }>
  mangaChapters(sourceId: string, mangaId: string, onSlow: () => void, signal: AbortSignal): Promise<MangaChapter[]>
  mangaPages(sourceId: string, chapterId: string, onSlow: () => void, signal: AbortSignal): Promise<ChapterPage[]>
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
  settingsSaveStatus: Accessor<'saving' | 'saved' | null>
  statusText: Accessor<string>
  sources: Accessor<SourceInfo[]>
  selectedSource: Accessor<string>
  selectedSourceName: Accessor<string>
  matchedManga: Accessor<AniSourceManga | null>
  pickerCandidates: Accessor<RankedCandidate<AniSourceManga>[]>
  chapters: Accessor<ReaderChapter[]>
  selectedChapter: Accessor<ReaderChapter | null>
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

/** Bounded so long reading sessions never accumulate unbounded page metadata. */
const PAGE_CACHE_LIMIT = 3
const START_CHAPTER_TOKEN = 'start'
const LATEST_CHAPTER_TOKEN = 'latest'
const CONTINUE_CHAPTER_TOKEN = 'continue'

export type ReaderChapter = MangaChapter & { numberOrigin: 'source' | 'title' | 'url' | 'position' }

const SOURCE_CHAPTER_NUMBER_PATTERN = /^(?:[[(]\s*)?(?:vol(?:ume)?\.?\s*\d+(?:\.\d+)?\s*[-:·]?\s*)?(?:chapter|chap\.?|ch\.?|episode|ep\.?|battle|act|part|round)\s*[#№.: -]*\s*(\d+(?:\.\d+)?)(?![\d.])/i

function titleChapterNumber(title: string): number | null {
  const match = title.trim().match(SOURCE_CHAPTER_NUMBER_PATTERN)
  if (!match?.[1]) return null
  const number = Number(match[1])
  return Number.isFinite(number) ? number : null
}

export function chapterDisplayNumber(chapter: Pick<MangaChapter, 'number' | 'title'>): string | null {
  return chapter.number === 0 && titleChapterNumber(chapter.title) !== 0 ? null : String(chapter.number)
}

function chapterNumberFromSource(chapter: MangaChapter, repeatedSourceNumbers: ReadonlySet<number>): { number: number; origin: ReaderChapter['numberOrigin'] } | null {
  const fromTitle = titleChapterNumber(chapter.title)
  // Some Sources repeat a nonzero placeholder across different Chapters; an explicit title can disambiguate those.
  if (Number.isFinite(chapter.number) && chapter.number !== 0 && !(repeatedSourceNumbers.has(chapter.number) && fromTitle !== null && fromTitle !== chapter.number)) {
    return { number: chapter.number, origin: 'source' }
  }
  if (fromTitle !== null) return { number: fromTitle, origin: 'title' }
  // Only the final URL segment can describe a Chapter; the manga path often contains unrelated numbers.
  const segment = chapter.url.split(/[?#]/, 1)[0]?.replace(/\/$/, '').split('/').at(-1) ?? ''
  const fromUrl = titleChapterNumber(decodeURIComponentSafe(segment.replace(/[-_]+/g, ' ')))
  return fromUrl === null ? null : { number: fromUrl, origin: 'url' }
}

function decodeURIComponentSafe(value: string): string {
  try { return decodeURIComponent(value) } catch { return value }
}

export function normalizeChapters(chapters: readonly MangaChapter[]): ReaderChapter[] {
  const sourceCounts = new Map<number, number>()
  for (const chapter of chapters) {
    if (chapter.number !== 0) sourceCounts.set(chapter.number, (sourceCounts.get(chapter.number) ?? 0) + 1)
  }
  const repeatedSourceNumbers = new Set([...sourceCounts].filter(([, count]) => count > 1).map(([number]) => number))
  const extracted = chapters.map((chapter, index) => ({ chapter, index, number: chapterNumberFromSource(chapter, repeatedSourceNumbers) }))
  const known = extracted.filter((entry) => entry.number !== null)
  const first = known[0]
  const last = known.at(-1)
  const firstNumber = first?.number?.number
  const lastNumber = last?.number?.number
  const firstDate = chapters[0]?.released_at
  const lastDate = chapters.at(-1)?.released_at
  // Source lists usually run newest-first; use trustworthy labels or distinct release dates to detect oldest-first lists.
  const descending = firstNumber !== undefined && lastNumber !== undefined && first?.index !== last?.index && firstNumber !== lastNumber
    ? firstNumber > lastNumber
    : firstNumber === 1 && first?.index === 0
      ? false
      : firstNumber === chapters.length && first?.index === 0
        ? true
        : firstDate && lastDate && firstDate !== lastDate
          ? firstDate > lastDate
          : true
  const availablePositions = new Set(Array.from({ length: chapters.length }, (_, index) => index + 1))
  // Position numbers are a last resort. Avoid claiming an installment number already supplied by the Source.
  for (const entry of known) {
    if (entry.number) availablePositions.delete(entry.number.number)
  }
  return extracted
    .map(({ chapter, index, number }) => {
      let fallback = 0
      if (!number) {
        const preferred = descending ? chapters.length - index : index + 1
        fallback = preferred
        if (!availablePositions.has(fallback)) {
          const positions = descending ? [...availablePositions].reverse() : [...availablePositions]
          fallback = positions.reduce((nearest, position) => Math.abs(position - preferred) < Math.abs(nearest - preferred) ? position : nearest, positions[0] ?? preferred)
        }
        availablePositions.delete(fallback)
      }
      return {
        chapter: { ...chapter, number: number?.number ?? fallback, numberOrigin: number?.origin ?? 'position' } satisfies ReaderChapter,
        index,
      }
    })
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
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(chapterNumber)) return null
  const requested = Number(chapterNumber)
  if (!Number.isFinite(requested)) return null
  const matches = chapters.filter((chapter) => chapter.number === requested && ('numberOrigin' in chapter ? chapter.numberOrigin !== 'position' : chapterDisplayNumber(chapter) !== null))
  return matches.length === 1 ? matches[0]?.id ?? null : null
}

export function chapterIdForRoute(chapters: readonly MangaChapter[], routeValue: string): string | null {
  if (routeValue.startsWith('id:')) return chapters.find((chapter) => chapter.id === routeValue.slice(3))?.id ?? null
  return chapterIdForNumber(chapters, routeValue) ?? chapters.find((chapter) => chapter.id === routeValue)?.id ?? null
}

export function chapterRouteValue(chapters: readonly MangaChapter[], chapter: MangaChapter): string {
  const number = chapterDisplayNumber(chapter)
  // A position or a repeated number is not a stable identity; only the Source Chapter ID is.
  return number !== null && (!('numberOrigin' in chapter) || chapter.numberOrigin !== 'position') && chapterIdForNumber(chapters, number) === chapter.id ? number : `id:${chapter.id}`
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
  return value === '0' && chapterIdForNumber(chapters, value) === null
}

function describeError(error: unknown, operation: MangaReaderError['operation']): MangaReaderError {
  const failure = describeSourceFailure(error, operation)
  // 'expired' is a playback concept; in the reader it means the source cannot
  // serve this chapter. Rate-limit and misconfiguration failures pass through
  // with their own retryable messaging.
  const kind: MangaReaderErrorKind = failure.kind === 'expired' ? 'unavailable' : failure.kind
  return {
    kind,
    operation,
    message: failure.message,
    retryable: failure.retryable,
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
  const [settingsSaveStatus, setSettingsSaveStatus] = createSignal<'saving' | 'saved' | null>(null)
  const [sources, setSources] = createSignal<SourceInfo[]>([])
  const [selectedSource, setSelectedSource] = createSignal('')
  const [matchedManga, setMatchedManga] = createSignal<AniSourceManga | null>(null)
  const [pickerCandidates, setPickerCandidates] = createSignal<RankedCandidate<AniSourceManga>[]>([])
  const [chapters, setChapters] = createSignal<ReaderChapter[]>([])
  const [selectedChapterId, setSelectedChapterId] = createSignal<string | null>(null)
  const [pages, setPages] = createSignal<ChapterPage[]>([])
  const [currentPage, setCurrentPage] = createSignal(0)
  const [layout, setLayout] = createSignal<MangaReaderLayout>(DEFAULT_MANGA_READER_SETTINGS.layout)
  const [direction, setDirection] = createSignal<MangaReaderDirection>(DEFAULT_MANGA_READER_SETTINGS.direction)
  const [fit, setFit] = createSignal<MangaReaderFit>(DEFAULT_MANGA_READER_SETTINGS.fit)
  const [background, setBackground] = createSignal<MangaReaderBackground>(DEFAULT_MANGA_READER_SETTINGS.background)
  const [gap, setGap] = createSignal<MangaReaderGap>(DEFAULT_MANGA_READER_SETTINGS.gap)
  const [savedRecord, setSavedRecord] = createSignal<MangaReaderRecord | null>(null)

  const scope = createCancellableScope()
  let prefetchController: AbortController | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let progressSaveRevision = 0
  let persistenceWrite: Promise<void> = Promise.resolve()
  let settingsSaveRevision = 0
  const userEditedSettings = new Set<keyof MangaReaderSettings>()
  let lastFailedOperation: MangaReaderError['operation'] | null = null
  /** Chapter pages already fetched (or prefetched) this session, keyed by chapter id. */
  const pageCache = new Map<string, ChapterPage[]>()

  const sourceName = () => displaySourceName(sources(), selectedSource())
  const selectedChapter = () => chapters().find((chapter) => chapter.id === selectedChapterId()) ?? null
  const neighbors = () => chapterNeighbors(chapters(), selectedChapterId() ?? '')
  const previousChapter = () => neighbors().previous
  const nextChapter = () => neighbors().next

  function cancelProgressSave(): void {
    progressSaveRevision += 1
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
  }

  function cancelActiveRequest(): void {
    scope.cancelAll()
    cancelProgressSave()
  }

  function beginRequest(): ScopeOperation {
    const operation = scope.restart()
    setSlow(false)
    setError(null)
    return operation
  }

  function isCurrent(operation: ScopeOperation): boolean {
    return scope.current(operation)
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
      case 'match-empty': return 'No matching manga was found.'
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

  function recordMatchesSelection(record: MangaReaderRecord): boolean {
    return selectedSource() === record.sourceId && matchedManga()?.id === record.mangaId && selectedChapterId() === record.chapterId
  }

  function queueRecordSave(
    record: MangaReaderRecord,
    isCurrent: () => boolean,
    onSaved: (savedRecord: MangaReaderRecord) => void,
  ): Promise<void> {
    const write = persistenceWrite.then(async () => {
      if (!isCurrent()) return
      try {
        const currentRecord = untrack(() => ({
          ...record,
          layout: layout(),
          direction: direction(),
          fit: fit(),
          background: background(),
          gap: gap(),
        }))
        await persistence.save(currentRecord)
        if (!isCurrent()) return
        onSaved(currentRecord)
        setPersistenceError(null)
      } catch {
        setPersistenceError('Reading progress could not be saved on this device.')
      }
    })
    persistenceWrite = write
    return write
  }

  async function persistRecord(record: MangaReaderRecord | null): Promise<void> {
    if (!record) return
    await queueRecordSave(record, () => untrack(() => recordMatchesSelection(record)), setSavedRecord)
  }

  function scheduleProgressSave(): void {
    const chapter = selectedChapter()
    if (!chapter) return
    if (saveTimer !== null) clearTimeout(saveTimer)
    const chapterId = chapter.id
    const revision = ++progressSaveRevision
    saveTimer = setTimeout(() => {
      saveTimer = null
      const current = selectedChapter()
      if (revision !== progressSaveRevision || current?.id !== chapterId) return
      void persistRecord(recordBase(current, currentPage(), false))
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
    if (!record) return
    const revision = ++settingsSaveRevision
    setSettingsSaveStatus('saving')
    void persistence.saveSettings(record).then((saved) => {
      if (revision !== settingsSaveRevision) return
      setSavedRecord(saved)
      setSettingsSaveStatus('saved')
      setPersistenceError(null)
    }).catch(() => {
      if (revision === settingsSaveRevision) {
        setSettingsSaveStatus(null)
        setPersistenceError('Reader settings could not be saved on this device.')
      }
    })
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
    // Drop any debounced progress write for the previous chapter: the new
    // chapter persists its own starting position below, and a late write must
    // not overwrite it (progress belongs to the last-read chapter only).
    cancelProgressSave()
    const request = beginRequest()
    setSelectedChapterId(chapterId)
    setPages([])
    setCurrentPage(0)
    setStage('pages-loading')
    try {
      const normalized = await fetchChapterPages(source, chapterId, () => setSlow(true), request.signal)
      if (!isCurrent(request)) return
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
      const current = selectedChapter()
      if (!current || current.id !== chapterId) return
      // Start the write before route replacement; a remount must not cancel the
      // chapter's starting position before it reaches the persistence adapter.
      const save = persistRecord(recordBase(current, resumeIndex, false))
       if (replaceRoute) await options.navigateToChapter(chapterRouteValue(chapters(), current), source, true)
      if (!isCurrent(request)) return
      await save
      void prefetchNextChapter()
    } catch (caught) {
      if (!isCurrent(request)) return
      const nextError = describeError(caught, 'pages')
      setFailure(nextError)
    } finally {
      scope.finish(request)
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
      if (!isCurrent(request)) return
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
      if (!isCurrent(request)) return
      setFailure(describeError(caught, 'chapters'))
    } finally {
      scope.finish(request)
    }
  }

  async function applyMatch(candidate: AniSourceManga, record: MangaReaderRecord | null): Promise<void> {
    setMatchedManga(candidate)
    setPickerCandidates([])
    await loadChapters(record)
  }

  async function searchSource(
    sourceId: string,
    queryTitles: readonly string[],
    record: MangaReaderRecord | null,
    attemptedSources?: Set<string>,
  ): Promise<void> {
    const request = beginRequest()
    attemptedSources?.add(sourceId)
    setStage('matching')
    setMatchedManga(null)
    setPickerCandidates([])
    try {
      const flow = await runSourceMatchFlow<AniSourceManga>({
        queries: queryTitles,
        maxQueries: 4,
        search: async (query) => (
          await options.api.mangaSearch(sourceId, query, 1, () => setSlow(true), request.signal)
        ).items,
        isCurrent: () => isCurrent(request),
        onQueryFailure: (cause) => {
          if (cause instanceof AniSourceError && cause.kind === 'cancelled') return 'abort'
          return 'continue'
        },
      })
      if (!flow) return
      const ranked = flow.result
      if (ranked.kind === 'empty') {
        const nextSource = attemptedSources
          ? sources().find((source) => !attemptedSources.has(source.id))
          : undefined
        if (nextSource) {
          await initializeSource(nextSource.id, true, attemptedSources)
          return
        }
        if (flow.lastFailure) {
          setFailure(describeError(flow.lastFailure, 'match'))
          return
        }
        setStage('match-empty')
        setError(null)
        return
      }
      if (ranked.kind === 'auto') {
        await applyMatch(ranked.match.candidate, record)
        return
      }
      setPickerCandidates(ranked.ranked)
      setStage('match-picker')
    } catch (caught) {
      if (!isCurrent(request)) return
      setFailure(describeError(caught, 'match'))
    } finally {
      scope.finish(request)
    }
  }

  async function initializeSource(sourceId: string, forceSearch: boolean, attemptedSources = new Set<string>()): Promise<void> {
    cancelProgressSave()
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
    await searchSource(sourceId, variants.length > 0 ? variants : [titleOf(options.manga)], record, attemptedSources)
  }

  async function initialize(): Promise<void> {
    cancelActiveRequest()
    setStage('sources-loading')
    setError(null)
    setPersistenceError(null)
    let request: ScopeOperation | null = null
    try {
      const [stored, defaults] = await Promise.all([
        persistence.get(options.manga.id),
        persistence.getDefaults(),
      ])
      if (scope.disposed) return
      setSavedRecord(stored)
      const settings = stored ?? resolveMangaReaderDefaults(options.manga.countryOfOrigin, defaults)
      if (!userEditedSettings.has('layout')) setLayout(settings.layout)
      if (!userEditedSettings.has('direction')) setDirection(settings.direction)
      if (!userEditedSettings.has('fit')) setFit(settings.fit)
      if (!userEditedSettings.has('background')) setBackground(settings.background)
      if (!userEditedSettings.has('gap')) setGap(settings.gap)
      if (stored && userEditedSettings.size > 0) persistReaderSettings()
      request = beginRequest()
      const result = await options.api.mangaSources(() => setSlow(true), request.signal)
      if (!isCurrent(request)) return
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
      if (scope.disposed) return
      setFailure(describeError(caught, 'sources'))
    } finally {
      if (request) scope.finish(request)
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
    cancelProgressSave()
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
      if (!isCurrent(request)) return false
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
      if (!isCurrent(request)) return false
      const nextError = describeError(caught, 'pages')
      lastFailedOperation = 'pages'
      setError(nextError)
      return false
    } finally {
      scope.finish(request)
    }
  }

  function setPage(pageIndex: number): void {
    setCurrentPage(validPageIndex(pageIndex, pages().length))
    scheduleProgressSave()
  }

  function setLayoutPreference(nextLayout: MangaReaderLayout): void {
    userEditedSettings.add('layout')
    setLayout(nextLayout)
    persistReaderSettings()
  }

  function setDirectionPreference(nextDirection: MangaReaderDirection): void {
    userEditedSettings.add('direction')
    setDirection(nextDirection)
    persistReaderSettings()
  }

  function setFitPreference(nextFit: MangaReaderFit): void {
    userEditedSettings.add('fit')
    setFit(nextFit)
    persistReaderSettings()
  }

  function setBackgroundPreference(nextBackground: MangaReaderBackground): void {
    userEditedSettings.add('background')
    setBackground(nextBackground)
    persistReaderSettings()
  }

  function setGapPreference(nextGap: MangaReaderGap): void {
    userEditedSettings.add('gap')
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
    scope.dispose()
    cancelActiveRequest()
    clearPageCache()
  }

  return {
    stage,
    slow,
    error,
    persistenceError,
    settingsSaveStatus,
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
  return page.url
}
