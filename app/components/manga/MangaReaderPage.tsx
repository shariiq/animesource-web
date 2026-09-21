/* eslint-disable solid/reactivity -- the reader session intentionally captures immutable route props once. */
import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  type Accessor,
} from 'solid-js'
import { Link } from '@tanstack/solid-router'
import { anisourceClient } from '../../data/anisource/client'
import type { AniListDetail } from '../../data/anilist/types'
import { titleOf } from '../../lib/format'
import type { ChapterPage, MangaChapter } from '../../data/anisource/schema'
import {
  createMangaReaderSession,
  pageSource,
  type MangaReaderBackground,
  type MangaReaderDirection,
  type MangaReaderFit,
  type MangaReaderGap,
  type MangaReaderLayout,
  type MangaReaderSession,
} from './reader/createMangaReaderSession'
import { createImageLoadQueue, type ImageLoadHandle } from './reader/imageLoadQueue'

interface MangaReaderPageProps {
  manga: AniListDetail
  routeChapterNumber: Accessor<string>
  sourceSearchParam: Accessor<string | undefined>
  navigateToChapter: (chapterNumber: string, sourceId: string, replace?: boolean) => Promise<void>
}

const CHROME_HIDE_DELAY_MS = 2_600
const IMAGE_LOAD_CONCURRENCY = 2
const CONTINUOUS_INITIAL_PAGES = 2
const CONTINUOUS_PRELOAD_MARGIN = '1400px 0px'
const PAGED_PRELOAD_AHEAD = 3

const LAYOUT_OPTIONS: { value: MangaReaderLayout; label: string }[] = [
  { value: 'continuous', label: 'Continuous' },
  { value: 'paged', label: 'Paged' },
  { value: 'double', label: 'Spread' },
]
const DIRECTION_OPTIONS: { value: MangaReaderDirection; label: string }[] = [
  { value: 'rtl', label: 'Right to left' },
  { value: 'ltr', label: 'Left to right' },
]
const FIT_OPTIONS: { value: MangaReaderFit; label: string }[] = [
  { value: 'fit-width', label: 'Fit width' },
  { value: 'fit-screen', label: 'Fit screen' },
  { value: 'original', label: 'Original' },
]
const BACKGROUND_OPTIONS: { value: MangaReaderBackground; label: string; swatch: string }[] = [
  { value: 'ink', label: 'Ink', swatch: '#101014' },
  { value: 'black', label: 'Black', swatch: '#000000' },
  { value: 'sepia', label: 'Sepia', swatch: '#e9ddc4' },
  { value: 'paper', label: 'Paper', swatch: '#f5f3ee' },
]
const GAP_OPTIONS: { value: MangaReaderGap; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'small', label: 'Tight' },
  { value: 'large', label: 'Roomy' },
]

const ICONS = {
  back: 'M19 12H5M12 19l-7-7 7-7',
  chapters: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  settings: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  fullscreen: 'M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3',
  previous: 'M15 18l-6-6 6-6',
  next: 'M9 18l6-6-6-6',
  close: 'M18 6L6 18M6 6l12 12',
  check: 'M20 6L9 17l-5-5',
}

function ReaderIcon(props: { d: string }) {
  return (
    <svg class="manga-reader-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={props.d} />
    </svg>
  )
}

const chapterDateFormatter = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' })

function formatChapterDate(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : chapterDateFormatter.format(date)
}

export function MangaReaderPage(props: MangaReaderPageProps) {
  const [chapterSheetOpen, setChapterSheetOpen] = createSignal(false)
  const [settingsSheetOpen, setSettingsSheetOpen] = createSignal(false)
  const [chromeVisible, setChromeVisible] = createSignal(true)
  const [failedPages, setFailedPages] = createSignal<ReadonlySet<number>>(new Set())
  const [retryVersions, setRetryVersions] = createSignal<Record<number, number>>({})
  const [searchQuery, setSearchQuery] = createSignal('')
  const [chapterFilter, setChapterFilter] = createSignal('')
  const [fullscreen, setFullscreen] = createSignal(false)
  const [pastEnd, setPastEnd] = createSignal(false)
  const [pageNodes, setPageNodes] = createSignal<ReadonlyMap<number, HTMLElement>>(new Map())
  const [loadRequested, setLoadRequested] = createSignal<ReadonlySet<number>>(new Set())
  let shellEl: HTMLElement | undefined
  let scrollEl: HTMLDivElement | undefined
  let observer: IntersectionObserver | undefined
  let loadObserver: IntersectionObserver | undefined
  let chromeTimer: ReturnType<typeof setTimeout> | null = null
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let refreshPromise: Promise<boolean> | null = null
  let automaticRefreshes = 0
  let resetChapterId: string | null | undefined
  let restoredChapterId: string | null | undefined
  const imageLoadQueue = createImageLoadQueue(IMAGE_LOAD_CONCURRENCY)
  const preloadedUrls = new Set<string>()

  const session = createMangaReaderSession({
    manga: props.manga,
    routeChapterNumber: props.routeChapterNumber,
    sourceSearchParam: props.sourceSearchParam,
    api: anisourceClient,
    navigateToChapter: props.navigateToChapter,
  })

  const title = () => titleOf(props.manga)
  const cover = () => props.manga.coverImage?.large || props.manga.coverImage?.extraLarge || ''
  const accent = () => props.manga.coverImage?.color || ''
  const pageCount = () => session.pages().length
  const isPaged = () => session.layout() !== 'continuous'
  const pageStep = () => (session.layout() === 'double' ? 2 : 1)
  const reading = () => session.stage() === 'pages-ready' || session.stage() === 'empty'
  const chapterLabel = () => {
    const chapter = session.selectedChapter()
    return chapter ? `Chapter ${chapter.number || '—'}` : 'Manga reader'
  }
  const chapterTitle = () => session.selectedChapter()?.title || 'Choose a chapter to begin'
  const pageLabel = () => {
    const count = pageCount()
    if (count === 0) return 'No pages loaded'
    if (session.layout() === 'double') {
      const first = session.currentPage() + 1
      const last = Math.min(count, first + 1)
      return last > first ? `Pages ${first}–${last} / ${count}` : `Page ${first} / ${count}`
    }
    return `Page ${Math.min(session.currentPage() + 1, count)} / ${count}`
  }
  const progressPercent = () => (pageCount() > 0 ? Math.round(((session.currentPage() + 1) / pageCount()) * 100) : 0)
  const visibleIndexes = () => {
    const count = pageCount()
    if (count === 0) return [] as number[]
    const current = Math.min(session.currentPage(), count - 1)
    return session.layout() === 'double' && current + 1 < count ? [current, current + 1] : [current]
  }
  const orderedChapters = () => [...session.chapters()].reverse()
  const filteredChapters = () => {
    const query = chapterFilter().trim().toLowerCase()
    if (!query) return orderedChapters()
    return orderedChapters().filter((chapter) => `${chapter.number} ${chapter.title}`.toLowerCase().includes(query))
  }



  onMount(() => {
    void session.initialize()

    const previousHtmlOverflow = document.documentElement.style.overflow
    const previousBodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'

    observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0]
      if (!visible) return
      const index = Number((visible.target as HTMLElement).dataset.pageIndex)
      if (Number.isInteger(index)) session.setPage(index)
    }, { rootMargin: '-18% 0px -58% 0px', threshold: [0.1, 0.35, 0.7] })
    observePages()

    const handleFullscreenChange = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', handleFullscreenChange)

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.matches('input, select, textarea, [contenteditable="true"]')) return
      if (event.key === 'Escape') {
        if (settingsSheetOpen()) setSettingsSheetOpen(false)
        else if (chapterSheetOpen()) setChapterSheetOpen(false)
        else revealChrome()
        return
      }
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault()
        void toggleFullscreen()
        return
      }
      if (event.key === '[') {
        event.preventDefault()
        void choosePrevious()
        return
      }
      if (event.key === ']') {
        event.preventDefault()
        void chooseNext()
        return
      }
      if (event.key === 'Home') {
        event.preventDefault()
        if (isPaged()) session.setPage(0)
        else scrollEl?.scrollTo({ top: 0, behavior: 'smooth' })
        return
      }
      if (event.key === 'End') {
        event.preventDefault()
        if (isPaged()) session.setPage(pageCount() - 1)
        else if (scrollEl) scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: 'smooth' })
        return
      }
      // Let focused controls keep their native Space/Enter activation.
      if (target?.closest('button, a') && (event.key === ' ' || event.key === 'Enter')) return
      const forwardKey = session.direction() === 'rtl' ? 'ArrowLeft' : 'ArrowRight'
      const backwardKey = session.direction() === 'rtl' ? 'ArrowRight' : 'ArrowLeft'
      if (event.key === forwardKey || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault()
        goForward()
      } else if (event.key === backwardKey || event.key === 'PageUp') {
        event.preventDefault()
        goBackward()
      } else if (event.key === 'ArrowDown' && !isPaged()) {
        event.preventDefault()
        scrollByScreenful(1)
      } else if (event.key === 'ArrowUp' && !isPaged()) {
        event.preventDefault()
        scrollByScreenful(-1)
      }
    }
    window.addEventListener('keydown', handleKeyDown)

    onCleanup(() => {
      window.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.documentElement.style.overflow = previousHtmlOverflow
      document.body.style.overflow = previousBodyOverflow
      observer?.disconnect()
      loadObserver?.disconnect()
      if (chromeTimer !== null) clearTimeout(chromeTimer)
      if (refreshTimer !== null) clearTimeout(refreshTimer)
      imageLoadQueue.clear()
      session.dispose()
    })
  })

  createEffect(() => {
    session.pages()
    session.layout()
    queueMicrotask(() => {
      observePages()
      setupLoadObserver()
    })
  })

  createEffect(() => {
    const chapterId = session.selectedChapter()?.id ?? null
    if (chapterId === resetChapterId) return
    resetChapterId = chapterId
    for (const node of pageNodes().values()) observer?.unobserve(node)
    loadObserver?.disconnect()
    setPageNodes(new Map())
    setLoadRequested(new Set<number>())
    setFailedPages(new Set<number>())
    setRetryVersions({})
    setPastEnd(false)
    automaticRefreshes = 0
    refreshPromise = null
    preloadedUrls.clear()
    imageLoadQueue.clear()
    queueMicrotask(() => {
      observePages()
      setupLoadObserver()
    })
  })

  // Restore the saved reading position once a chapter's pages are on screen.
  createEffect(() => {
    if (session.stage() !== 'pages-ready' || session.layout() !== 'continuous') return
    const chapterId = session.selectedChapter()?.id ?? null
    const index = session.currentPage()
    if (!chapterId || restoredChapterId === chapterId || index <= 0) return
    restoredChapterId = chapterId
    requestAnimationFrame(() => {
      pageNodes().get(index)?.scrollIntoView({ block: 'start' })
    })
  })

  // Mark a chapter complete when its final page is reached.
  createEffect(() => {
    const count = pageCount()
    if (count > 0 && (session.currentPage() >= count - 1 || pastEnd()) && !session.savedRecord()?.completed) {
      void session.markComplete()
    }
  })

  // Prefetch the next chapter as the reader approaches the end of this one.
  createEffect(() => {
    const count = pageCount()
    if (session.stage() === 'pages-ready' && count > 0 && session.currentPage() >= count - 3) {
      void session.prefetchNextChapter()
    }
  })

  // Preload the images around the next page turn and the opening of a prefetched next chapter.
  createEffect(() => {
    if (session.stage() !== 'pages-ready') return
    if (isPaged()) {
      const pages = session.pages()
      const current = session.currentPage()
      for (let offset = 1; offset <= PAGED_PRELOAD_AHEAD; offset += 1) {
        const page = pages[current + offset]
        if (page) preloadImage(pageSource(page))
      }
    }
    const next = session.nextChapter()
    const upcoming = next ? session.cachedPages(next.id) : undefined
    if (upcoming) for (const page of upcoming.slice(0, 2)) preloadImage(pageSource(page))
  })

  // Keep the tab title honest about what is being read.
  createEffect(() => {
    const chapter = session.selectedChapter()
    document.title = chapter ? `Chapter ${chapter.number || '—'} · ${title()} — AniSource` : `${title()} — Manga reader — AniSource`
  })
  onCleanup(() => {
    document.title = 'AniSource — Discover & Watch Anime'
  })

  function scheduleChromeHide(): void {
    if (chromeTimer !== null) {
      clearTimeout(chromeTimer)
      chromeTimer = null
    }
    if (!reading() || chapterSheetOpen() || settingsSheetOpen()) return
    chromeTimer = setTimeout(() => setChromeVisible(false), CHROME_HIDE_DELAY_MS)
  }

  function revealChrome(): void {
    setChromeVisible(true)
    scheduleChromeHide()
  }

  function holdChrome(): void {
    setChromeVisible(true)
    if (chromeTimer !== null) {
      clearTimeout(chromeTimer)
      chromeTimer = null
    }
  }

  function toggleChrome(): void {
    if (chromeVisible()) {
      setChromeVisible(false)
      if (chromeTimer !== null) {
        clearTimeout(chromeTimer)
        chromeTimer = null
      }
    } else {
      revealChrome()
    }
  }

  function handlePointerMove(event: PointerEvent): void {
    // Mouse movement reveals the chrome; touch scrolls must not.
    if (event.pointerType === 'mouse') revealChrome()
  }

  function observePages(): void {
    if (!observer || session.layout() !== 'continuous') return
    for (const node of pageNodes().values()) observer.observe(node)
  }

  function requestPageLoad(index: number): void {
    setLoadRequested((current) => {
      if (current.has(index)) return current
      return new Set(current).add(index)
    })
  }

  function setupLoadObserver(): void {
    loadObserver?.disconnect()
    loadObserver = undefined
    if (!scrollEl || session.layout() !== 'continuous') return
    loadObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const index = Number((entry.target as HTMLElement).dataset.pageIndex)
        if (Number.isInteger(index)) requestPageLoad(index)
      }
    }, { root: scrollEl, rootMargin: CONTINUOUS_PRELOAD_MARGIN, threshold: 0 })
    for (const node of pageNodes().values()) loadObserver.observe(node)
    for (let index = 0; index < Math.min(CONTINUOUS_INITIAL_PAGES, pageCount()); index += 1) requestPageLoad(index)
  }

  function preloadImage(url: string): void {
    if (preloadedUrls.has(url)) return
    preloadedUrls.add(url)
    imageLoadQueue.enqueue((complete) => {
      const image = new Image()
      image.decoding = 'async'
      image.onload = () => {
        void image.decode().catch(() => undefined).finally(complete)
      }
      image.onerror = () => {
        preloadedUrls.delete(url)
        complete()
      }
      image.src = url
    })
  }

  function registerPage(node: HTMLElement, index: number): void {
    setPageNodes((current) => {
      const next = new Map(current)
      next.set(index, node)
      return next
    })
    if (session.layout() === 'continuous') {
      observer?.observe(node)
      loadObserver?.observe(node)
    }
  }

  function scrollByScreenful(direction: 1 | -1): void {
    scrollEl?.scrollBy({ top: direction * scrollEl.clientHeight * 0.82, behavior: 'smooth' })
  }

  function goForward(): void {
    const count = pageCount()
    if (count === 0) return
    if (!isPaged()) {
      scrollByScreenful(1)
      return
    }
    if (pastEnd()) return
    const current = session.currentPage()
    if (current >= count - 1) {
      setPastEnd(true)
      return
    }
    session.setPage(Math.min(count - 1, current + pageStep()))
  }

  function goBackward(): void {
    if (!isPaged()) {
      scrollByScreenful(-1)
      return
    }
    if (pastEnd()) {
      setPastEnd(false)
      return
    }
    session.setPage(session.currentPage() - pageStep())
  }

  async function chooseChapter(chapter: MangaChapter): Promise<void> {
    setChapterSheetOpen(false)
    setPastEnd(false)
    await session.chooseChapter(chapter.id)
  }

  async function choosePrevious(): Promise<void> {
    const previous = session.previousChapter()
    if (previous) await chooseChapter(previous)
  }

  async function chooseNext(): Promise<void> {
    const next = session.nextChapter()
    if (next) await chooseChapter(next)
  }

  async function toggleFullscreen(): Promise<void> {
    if (!shellEl) return
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await shellEl.requestFullscreen()
    } catch {
      // Browsers may reject fullscreen outside a user gesture; reading continues regardless.
    }
  }

  function markPageFailed(index: number): void {
    setFailedPages((current) => new Set(current).add(index))
    if (automaticRefreshes >= 2 || refreshTimer !== null) return
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      automaticRefreshes += 1
      void refreshFailedPages()
    }, 120)
  }

  function markPageLoaded(index: number): void {
    setFailedPages((current) => {
      if (!current.has(index)) return current
      const next = new Set(current)
      next.delete(index)
      return next
    })
  }

  function refreshPageTargets(): Promise<boolean> {
    if (!refreshPromise) {
      refreshPromise = session.refreshPages().finally(() => {
        refreshPromise = null
      })
    }
    return refreshPromise
  }

  async function refreshFailedPages(): Promise<void> {
    const refreshed = await refreshPageTargets()
    if (!refreshed) return
    const failed = failedPages()
    setFailedPages(new Set<number>())
    setRetryVersions((current) => {
      const next = { ...current }
      for (const index of failed) next[index] = (next[index] ?? 0) + 1
      return next
    })
  }

  async function retryPage(index: number): Promise<void> {
    if (refreshTimer !== null) {
      clearTimeout(refreshTimer)
      refreshTimer = null
    }
    const refreshed = await refreshPageTargets()
    if (!refreshed) return
    markPageLoaded(index)
    setRetryVersions((current) => ({ ...current, [index]: (current[index] ?? 0) + 1 }))
  }

  function openChapterSheet(): void {
    setSettingsSheetOpen(false)
    setChapterSheetOpen(true)
  }

  function openSettingsSheet(): void {
    setChapterSheetOpen(false)
    setSettingsSheetOpen(true)
  }

  function handleCanvasClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null
    if (target?.closest('button, a, input, select, textarea')) return
    toggleChrome()
  }

  function handleScrubInput(event: InputEvent & { currentTarget: HTMLInputElement }): void {
    setPastEnd(false)
    session.setPage(Number(event.currentTarget.value))
    revealChrome()
  }

  function handleScrubChange(event: Event & { currentTarget: HTMLInputElement }): void {
    if (isPaged()) return
    const index = Number(event.currentTarget.value)
    pageNodes().get(index)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  // Re-arm the chrome auto-hide whenever the reading stage or sheets change.
  createEffect(() => {
    reading()
    chapterSheetOpen()
    settingsSheetOpen()
    scheduleChromeHide()
  })


  return (
    <section
      ref={(element) => { shellEl = element }}
      class="manga-reader-shell"
      classList={{ 'is-fullscreen': fullscreen() }}
      data-chrome={chromeVisible() ? 'visible' : 'hidden'}
      data-layout={session.layout()}
      data-direction={session.direction()}
      data-fit={session.fit()}
      data-background={session.background()}
      data-gap={session.gap()}
      style={accent() ? { '--mr-accent': accent() } : undefined}
      aria-labelledby="manga-reader-title"
      onPointerMove={handlePointerMove}
    >
      <div class="manga-reader-hairline" aria-hidden="true">
        <i style={{ width: `${progressPercent()}%` }} />
      </div>

      <header class="manga-reader-bar manga-reader-bar-top" onPointerEnter={holdChrome} onPointerLeave={revealChrome} onFocusIn={holdChrome} onFocusOut={revealChrome}>
        <div class="manga-reader-identity">
          <Link
            class="manga-reader-back"
            to="/manga/$mangaId"
            params={{ mangaId: String(props.manga.id) }}
            aria-label={`Back to ${title()} details`}
          >
            <ReaderIcon d={ICONS.back} />
          </Link>
          <Show when={cover()}>
            <img class="manga-reader-cover" src={cover()} alt="" aria-hidden="true" />
          </Show>
          <div class="manga-reader-titles">
            <p class="manga-reader-kicker">{chapterLabel()}</p>
            <h1 class="manga-reader-title" id="manga-reader-title">{title()}</h1>
            <p class="manga-reader-subtitle">{chapterTitle()} · {session.selectedSourceName() || 'AniSource'}</p>
          </div>
        </div>
        <p class="manga-reader-status" role="status" aria-live="polite">
          <i class="manga-reader-status-dot" classList={{ 'is-waking': session.slow(), 'is-error': session.error() !== null }} aria-hidden="true" />
          {session.statusText()}
        </p>
        <div class="manga-reader-actions">
          <label class="manga-reader-source">
            <span>Source</span>
            <select
              aria-label="Manga source"
              value={session.selectedSource()}
              disabled={session.sources().length === 0 || session.stage() === 'sources-loading'}
              onChange={(event) => { void session.chooseSource(event.currentTarget.value) }}
            >
              <For each={session.sources()}>{(source) => <option value={source.id}>{source.name}</option>}</For>
            </select>
          </label>
          <button class="manga-reader-action" type="button" aria-expanded={chapterSheetOpen()} aria-controls="manga-reader-chapter-sheet" onClick={openChapterSheet}>
            <ReaderIcon d={ICONS.chapters} /><span>Chapters</span>
          </button>
          <button class="manga-reader-action" type="button" aria-expanded={settingsSheetOpen()} aria-controls="manga-reader-settings-sheet" onClick={openSettingsSheet}>
            <ReaderIcon d={ICONS.settings} /><span>Settings</span>
          </button>
          <button class="manga-reader-action is-icon" type="button" aria-label={fullscreen() ? 'Exit fullscreen' : 'Enter fullscreen'} onClick={() => { void toggleFullscreen() }}>
            <ReaderIcon d={ICONS.fullscreen} />
          </button>
        </div>
      </header>

      <div class="manga-reader-canvas">
        <Switch>
          <Match when={session.stage() === 'sources-loading' || session.stage() === 'matching' || session.stage() === 'chapters-loading' || session.stage() === 'pages-loading'}>
            <ReaderLoadingState stage={session.stage()} slow={session.slow()} />
          </Match>
          <Match when={session.stage() === 'match-picker' || session.stage() === 'match-empty'}>
            <section class="manga-reader-panel" aria-labelledby="manga-reader-match-title">
              <span class="manga-reader-kicker">Source matching</span>
              <h2 id="manga-reader-match-title">Choose the right edition.</h2>
              <p class="manga-reader-panel-copy">AniSource sources use their own manga identifiers. Confirm the title before chapters are loaded.</p>
              <form class="manga-reader-search" onSubmit={(event) => { event.preventDefault(); void session.search(searchQuery()) }}>
                <label for="manga-reader-search-input">Search this source</label>
                <div>
                  <input id="manga-reader-search-input" value={searchQuery()} onInput={(event) => setSearchQuery(event.currentTarget.value)} placeholder={title()} />
                  <button type="submit">Search</button>
                </div>
              </form>
              <Show when={session.pickerCandidates().length > 0} fallback={<p class="manga-reader-panel-empty">No candidates yet — try another title variant or switch source.</p>}>
                <div class="manga-reader-candidate-list" role="list">
                  <For each={session.pickerCandidates()}>
                    {(candidate) => (
                      <button class="manga-reader-candidate" type="button" role="listitem" onClick={() => { void session.chooseMatch(candidate.candidate) }}>
                        <span class="manga-reader-candidate-score">{Math.round(candidate.score * 100)}%</span>
                        <span class="manga-reader-candidate-main">
                          <strong>{candidate.candidate.title}</strong>
                          <small>{candidate.candidate.alternative_titles.slice(0, 2).join(' · ') || 'Source title'}</small>
                        </span>
                        <ReaderIcon d={ICONS.next} />
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </section>
          </Match>
          <Match when={session.stage() === 'ready'}>
            <section class="manga-reader-index" aria-labelledby="manga-reader-index-title">
              <span class="manga-reader-kicker">{session.chapters().length} chapters · {session.selectedSourceName()}</span>
              <h2 id="manga-reader-index-title">Choose where to begin.</h2>
              <div class="manga-reader-index-grid" role="list">
                <For each={session.chapters()}>
                  {(chapter) => (
                    <ChapterButton chapter={chapter} currentId={session.selectedChapter()?.id} currentNumber={session.selectedChapter()?.number} onChoose={chooseChapter} />
                  )}
                </For>
              </div>
            </section>
          </Match>
          <Match when={session.stage() === 'empty'}>
            <section class="manga-reader-panel" aria-label="Empty chapter">
              <span class="manga-reader-kicker">No pages</span>
              <h2>This chapter has no readable pages.</h2>
              <p class="manga-reader-panel-copy">Try another chapter, or refresh this source.</p>
              <div class="manga-reader-panel-actions">
                <button type="button" onClick={() => { void session.retryPages() }}>Retry chapter</button>
                <button type="button" class="is-quiet" onClick={openChapterSheet}>Browse chapters</button>
              </div>
            </section>
          </Match>
          <Match when={session.stage() === 'error'}>
            <section class="manga-reader-panel" role="alert" aria-label="Reader error">
              <span class="manga-reader-kicker">Reader interruption</span>
              <h2>Something interrupted the reader.</h2>
              <p class="manga-reader-panel-copy">{session.error()?.message}</p>
              <div class="manga-reader-panel-actions">
                <Show when={session.error()?.retryable}>
                  <button type="button" onClick={() => { void session.retry() }}>Retry</button>
                </Show>
                <button type="button" class="is-quiet" onClick={() => { void session.chooseSource(session.selectedSource()) }}>Search this source again</button>
              </div>
            </section>
          </Match>
          <Match when={session.stage() === 'pages-ready'}>
            <Show
              when={isPaged()}
              fallback={
                <div
                  ref={(element) => { scrollEl = element }}
                  class="manga-reader-scroll"
                  onClick={handleCanvasClick}
                >
                  <div class="manga-reader-stream" role="list" aria-label="Manga pages">
                    <For each={session.pages()}>
                      {(page, index) => (
                        <ReaderPageFrame
                          page={page}
                          index={index()}
                          total={pageCount()}
                          title={title()}
                          loadRequested={loadRequested().has(index())}
                          loadQueue={imageLoadQueue}
                          failed={failedPages().has(index())}
                          retryVersion={retryVersions()[index()] ?? 0}
                          register={registerPage}
                          onLoad={() => markPageLoaded(index())}
                          onError={() => markPageFailed(index())}
                          onRetry={() => retryPage(index())}
                        />
                      )}
                    </For>
                  </div>
                  <ChapterEndCard session={session} mangaId={props.manga.id} onPrevious={choosePrevious} onNext={chooseNext} />
                </div>
              }
            >
              <div class="manga-reader-stage">
                <Show when={!pastEnd()} fallback={<ChapterEndCard session={session} mangaId={props.manga.id} onPrevious={choosePrevious} onNext={chooseNext} overlay />}>
                  <div class="manga-reader-tap-zones">
                    <button type="button" class="manga-reader-tap-zone is-start" aria-label="Turn to previous page" onClick={session.direction() === 'rtl' ? goForward : goBackward} />
                    <button type="button" class="manga-reader-tap-zone is-center" aria-label="Show or hide reader controls" onClick={toggleChrome} />
                    <button type="button" class="manga-reader-tap-zone is-end" aria-label="Turn to next page" onClick={session.direction() === 'rtl' ? goBackward : goForward} />
                  </div>
                  <div class="manga-reader-spread" role="list" aria-label="Manga pages">
                    <For each={visibleIndexes()}>
                      {(index) => (
                        <ReaderPageFrame
                          page={session.pages()[index]}
                          index={index}
                          total={pageCount()}
                          title={title()}
                          loadRequested
                          loadQueue={imageLoadQueue}
                          paged
                          failed={failedPages().has(index)}
                          retryVersion={retryVersions()[index] ?? 0}
                          onLoad={() => markPageLoaded(index)}
                          onError={() => markPageFailed(index)}
                          onRetry={() => retryPage(index)}
                        />
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </Show>
          </Match>
        </Switch>
      </div>

      <footer class="manga-reader-bar manga-reader-bar-bottom" onPointerEnter={holdChrome} onPointerLeave={revealChrome} onFocusIn={holdChrome} onFocusOut={revealChrome}>
        <button class="manga-reader-chapter-turn" type="button" aria-label="Previous chapter" disabled={!session.previousChapter()} onClick={() => { void choosePrevious() }}>
          <ReaderIcon d={ICONS.previous} /><span>Prev</span>
        </button>
        <Show when={isPaged()}>
          <button class="manga-reader-page-turn" type="button" aria-label="Previous page" disabled={pageCount() === 0 || (session.currentPage() <= 0 && !pastEnd())} onClick={goBackward}>
            <ReaderIcon d={ICONS.previous} />
          </button>
        </Show>
        <div class="manga-reader-scrub">
          <div class="manga-reader-scrub-labels">
            <span class="manga-reader-page-label">{pageLabel()}</span>
            <span class="manga-reader-page-percent">{progressPercent()}%</span>
          </div>
          <input
            class="manga-reader-scrubber"
            type="range"
            min={0}
            max={Math.max(0, pageCount() - 1)}
            step={1}
            value={session.currentPage()}
            aria-label="Page scrubber"
            disabled={pageCount() === 0}
            onInput={handleScrubInput}
            onChange={handleScrubChange}
          />
          <div class="manga-reader-scrub-meta">
            <span>{chapterLabel()}{session.selectedChapter()?.title ? ` · ${session.selectedChapter()?.title}` : ''}</span>
            <span>{LAYOUT_OPTIONS.find((option) => option.value === session.layout())?.label}</span>
          </div>
        </div>
        <Show when={isPaged()}>
          <button class="manga-reader-page-turn" type="button" aria-label="Next page" disabled={pageCount() === 0 || pastEnd()} onClick={goForward}>
            <ReaderIcon d={ICONS.next} />
          </button>
        </Show>
        <button class="manga-reader-chapter-turn" type="button" aria-label="Next chapter" disabled={!session.nextChapter()} onClick={() => { void chooseNext() }}>
          <span>Next</span><ReaderIcon d={ICONS.next} />
        </button>
      </footer>

      <Show when={session.stage() !== 'error' ? session.error() : null}>
        {(readerError) => (
          <div class="manga-reader-toast" role="alert">
            <p>{readerError().message}</p>
            <div class="manga-reader-toast-actions">
              <Show when={readerError().retryable}>
                <button type="button" onClick={() => { void session.retry() }}>Retry</button>
              </Show>
              <Show when={session.stage() === 'match-empty'}>
                <button type="button" class="is-quiet" onClick={() => { void session.chooseSource(session.selectedSource()) }}>Search again</button>
              </Show>
            </div>
          </div>
        )}
      </Show>
      <Show when={session.persistenceError()}>
        {(message) => <p class="manga-reader-persistence" role="status">{message()}</p>}
      </Show>

      <Show when={chapterSheetOpen()}>
        <button class="manga-reader-scrim" type="button" aria-label="Close chapter list" onClick={() => setChapterSheetOpen(false)} />
        <aside id="manga-reader-chapter-sheet" class="manga-reader-sheet manga-reader-sheet-chapters" role="dialog" aria-label="Chapters">
          <div class="manga-reader-sheet-header">
            <div>
              <span class="manga-reader-kicker">{session.selectedSourceName() || 'Source'}</span>
              <h2>Chapters</h2>
            </div>
            <button type="button" class="manga-reader-icon-button" aria-label="Close chapter list" onClick={() => setChapterSheetOpen(false)}><ReaderIcon d={ICONS.close} /></button>
          </div>
          <div class="manga-reader-sheet-meta">
            <span>{session.chapters().length} chapters</span>
            <div class="manga-reader-jump">
              <button type="button" onClick={() => { const first = session.chapters()[0]; if (first) void chooseChapter(first) }}>First</button>
              <button type="button" onClick={() => { const last = session.chapters().at(-1); if (last) void chooseChapter(last) }}>Latest</button>
            </div>
          </div>
          <input
            class="manga-reader-filter"
            type="search"
            aria-label="Filter chapters"
            placeholder="Filter by number or title…"
            value={chapterFilter()}
            onInput={(event) => setChapterFilter(event.currentTarget.value)}
          />
          <div class="manga-reader-sheet-list" role="list">
            <For each={filteredChapters()} fallback={<p class="manga-reader-panel-empty">No chapters match that filter.</p>}>
              {(chapter) => (
                <ChapterButton chapter={chapter} currentId={session.selectedChapter()?.id} currentNumber={session.selectedChapter()?.number} onChoose={chooseChapter} />
              )}
            </For>
          </div>
        </aside>
      </Show>

      <Show when={settingsSheetOpen()}>
        <button class="manga-reader-scrim" type="button" aria-label="Close settings" onClick={() => setSettingsSheetOpen(false)} />
        <aside id="manga-reader-settings-sheet" class="manga-reader-sheet manga-reader-sheet-settings" role="dialog" aria-label="Reader settings">
          <div class="manga-reader-sheet-header">
            <div>
              <span class="manga-reader-kicker">Reading room</span>
              <h2>Reader settings</h2>
            </div>
            <button type="button" class="manga-reader-icon-button" aria-label="Close settings" onClick={() => setSettingsSheetOpen(false)}><ReaderIcon d={ICONS.close} /></button>
          </div>
          <div class="manga-reader-sheet-body">
            <SegmentGroup label="Layout" options={LAYOUT_OPTIONS} value={session.layout()} onSelect={(value) => session.setLayout(value)} />
            <SegmentGroup label="Page direction" options={DIRECTION_OPTIONS} value={session.direction()} onSelect={(value) => session.setDirection(value)} />
            <SegmentGroup label="Page fit" options={FIT_OPTIONS} value={session.fit()} onSelect={(value) => session.setFit(value)} />
            <fieldset class="manga-reader-field">
              <legend>Background</legend>
              <div class="manga-reader-swatches">
                <For each={BACKGROUND_OPTIONS}>
                  {(option) => (
                    <button type="button" class="manga-reader-swatch" classList={{ 'is-active': session.background() === option.value }} aria-pressed={session.background() === option.value} onClick={() => session.setBackground(option.value)}>
                      <i style={{ background: option.swatch }} aria-hidden="true" />
                      <span>{option.label}</span>
                    </button>
                  )}
                </For>
              </div>
            </fieldset>
            <SegmentGroup label="Page gap" options={GAP_OPTIONS} value={session.gap()} onSelect={(value) => session.setGap(value)} />
            <button class="manga-reader-wide-action" type="button" onClick={() => { void toggleFullscreen() }}>
              <ReaderIcon d={ICONS.fullscreen} />
              <span>{fullscreen() ? 'Exit fullscreen' : 'Enter fullscreen'}</span>
            </button>
            <dl class="manga-reader-shortcuts">
              <div><dt>← →</dt><dd>Turn pages, direction aware</dd></div>
              <div><dt>Space</dt><dd>Next page</dd></div>
              <div><dt>[ ]</dt><dd>Previous / next chapter</dd></div>
              <div><dt>Home End</dt><dd>First / last page</dd></div>
              <div><dt>F</dt><dd>Fullscreen</dd></div>
              <div><dt>Esc</dt><dd>Close panels, show controls</dd></div>
            </dl>
            <p class="manga-reader-sheet-note">Progress and reader preferences are saved privately on this device.</p>
          </div>
        </aside>
      </Show>
    </section>
  )
}

function SegmentGroup<T extends string>(props: { label: string; options: { value: T; label: string }[]; value: T; onSelect: (value: T) => void }) {
  return (
    <fieldset class="manga-reader-field">
      <legend>{props.label}</legend>
      <div class="manga-reader-segments">
        <For each={props.options}>
          {(option) => (
            <button
              type="button"
              class="manga-reader-segment"
              classList={{ 'is-active': option.value === props.value }}
              aria-pressed={option.value === props.value}
              onClick={() => props.onSelect(option.value)}
            >
              {option.label}
            </button>
          )}
        </For>
      </div>
    </fieldset>
  )
}

function ChapterButton(props: { chapter: MangaChapter; currentId: string | undefined; currentNumber: number | undefined; onChoose: (chapter: MangaChapter) => Promise<void> }) {
  const isCurrent = () => props.chapter.id === props.currentId
  const isEarlier = () =>
    !isCurrent() &&
    props.currentNumber !== undefined &&
    props.chapter.number > 0 &&
    props.currentNumber > 0 &&
    props.chapter.number < props.currentNumber
  const date = () => formatChapterDate(props.chapter.released_at)
  return (
    <button
      class="manga-reader-chapter"
      classList={{ 'is-current': isCurrent(), 'is-earlier': isEarlier() }}
      type="button"
      role="listitem"
      aria-current={isCurrent() || undefined}
      onClick={() => { void props.onChoose(props.chapter) }}
    >
      <span class="manga-reader-chapter-number">{props.chapter.number || '—'}</span>
      <span class="manga-reader-chapter-copy">
        <strong>{props.chapter.title || `Chapter ${props.chapter.number || '—'}`}</strong>
        <small>{[date(), props.chapter.scanlator].filter(Boolean).join(' · ') || 'Source chapter'}</small>
      </span>
      <span class="manga-reader-chapter-state" aria-hidden="true">
        {isCurrent() ? 'Reading' : isEarlier() ? <ReaderIcon d={ICONS.check} /> : ''}
      </span>
    </button>
  )
}

function ChapterEndCard(props: { session: MangaReaderSession; mangaId: number; overlay?: boolean; onPrevious: () => Promise<void>; onNext: () => Promise<void> }) {
  const chapter = () => props.session.selectedChapter()
  const next = () => props.session.nextChapter()
  return (
    <section class="manga-reader-end" classList={{ 'is-overlay': props.overlay ?? false }} aria-label="End of chapter">
      <span class="manga-reader-kicker">Chapter {chapter()?.number || '—'} complete</span>
      <h2>{chapter()?.title || 'End of chapter'}</h2>
      <Show
        when={next()}
        fallback={<p class="manga-reader-end-copy">You're caught up — this is the latest chapter this source has.</p>}
      >
        {(nextChapter) => (
          <p class="manga-reader-end-copy">Continue to Chapter {nextChapter().number || '—'}{nextChapter().title ? ` · ${nextChapter().title}` : ''}.</p>
        )}
      </Show>
      <div class="manga-reader-end-actions">
        <Show when={props.session.previousChapter()}>
          <button type="button" class="is-quiet" onClick={() => { void props.onPrevious() }}>
            <ReaderIcon d={ICONS.previous} /><span>Previous chapter</span>
          </button>
        </Show>
        <Show when={next()}>
          <button type="button" onClick={() => { void props.onNext() }}>
            <span>Next chapter</span><ReaderIcon d={ICONS.next} />
          </button>
        </Show>
        <Link class="manga-reader-end-details" to="/manga/$mangaId" params={{ mangaId: String(props.mangaId) }}>Manga details</Link>
      </div>
    </section>
  )
}

function ReaderPageFrame(props: {
  page: ChapterPage | undefined
  index: number
  total: number
  title: string
  loadRequested: boolean
  loadQueue: ReturnType<typeof createImageLoadQueue>
  paged?: boolean
  failed: boolean
  retryVersion: number
  register?: (node: HTMLElement, index: number) => void
  onLoad: () => void
  onError: () => void
  onRetry: () => void
}) {
  const [loaded, setLoaded] = createSignal(false)
  const [armed, setArmed] = createSignal(false)
  let loadHandle: ImageLoadHandle | null = null
  let loadKey = ''

  createEffect(() => {
    const source = props.page ? pageSource(props.page) : ''
    const nextKey = props.loadRequested && source ? `${props.retryVersion}:${source}` : ''
    if (nextKey === loadKey) return
    loadHandle?.cancel()
    loadHandle = null
    loadKey = nextKey
    setLoaded(false)
    setArmed(false)
    if (nextKey) loadHandle = props.loadQueue.enqueue(() => setArmed(true))
  })

  onCleanup(() => loadHandle?.cancel())

  function settleLoad(): void {
    loadHandle?.complete()
  }

  return (
    <figure
      class="manga-reader-frame"
      classList={{ 'is-paged': props.paged ?? false, 'is-loaded': loaded() }}
      data-page-index={props.index}
      ref={(node) => props.register?.(node, props.index)}
      role="listitem"
      aria-label={`Page ${props.index + 1} of ${props.total}`}
    >
      <Show when={props.page} fallback={<div class="manga-reader-frame-missing">Page unavailable.</div>}>
        {(page) => (
          <>
            <Show when={armed()}>
              <Show when={`v${props.retryVersion}`} keyed>
                {(version) => (
                  <img
                    data-retry={version}
                    src={pageSource(page())}
                    alt={`${props.title}, page ${props.index + 1}`}
                    loading="eager"
                    decoding="async"
                    onLoad={() => { settleLoad(); setLoaded(true); props.onLoad() }}
                    onError={() => { settleLoad(); setLoaded(false); props.onError() }}
                  />
                )}
              </Show>
            </Show>
            <Show when={!loaded() && !props.failed}>
              <div class="manga-reader-frame-loader" aria-hidden="true"><span>{props.index + 1}</span></div>
            </Show>
            <Show when={props.failed}>
              <div class="manga-reader-frame-error" role="alert">
                <span>Page {props.index + 1} could not be loaded.</span>
                <button type="button" onClick={props.onRetry}>Retry page</button>
              </div>
            </Show>
          </>
        )}
      </Show>
    </figure>
  )
}

function ReaderLoadingState(props: { stage: ReturnType<MangaReaderSession['stage']>; slow: boolean }) {
  const label = () =>
    props.stage === 'matching'
      ? 'Finding the source edition'
      : props.stage === 'chapters-loading'
        ? 'Indexing chapters'
        : props.stage === 'pages-loading'
          ? 'Preparing pages'
          : 'Connecting to manga sources'
  const copy = () =>
    props.stage === 'pages-loading'
      ? 'Fetching page images from the source. The next chapter is prefetched as you approach the end.'
      : props.slow
        ? 'The source is waking up from a cold start — the first request can take a few seconds.'
        : 'The reader is preparing a clean chapter handoff.'
  return (
    <section class="manga-reader-loading" role="status" aria-live="polite">
      <div class="manga-reader-loading-book" aria-hidden="true"><i /><i /><i /></div>
      <h2>{label()}<span aria-hidden="true">…</span></h2>
      <p>{copy()}</p>
    </section>
  )
}
