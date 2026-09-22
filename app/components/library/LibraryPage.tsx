import { createQuery } from '@tanstack/solid-query'
import { createEffect, createMemo, createSignal, For, Match, on, onMount, Show, Switch, untrack } from 'solid-js'
import { byIdsQuery } from '../../data/options'
import { useOptionalCatalogMode } from '../layout/CatalogModeSwitch'
import { catalogCopy, type CatalogMode } from '../../lib/catalog'
import { viewerData } from '../../lib/persistence/active'
import type { ContinueItem, FavoriteItem, FavoriteStatus } from '../../lib/persistence/schema'
import { mangaReaderData, type MangaReaderRecord } from '../../lib/persistence/mangaReader'
import {
  filterAndSortLibrary,
  libraryFormats,
  LIBRARY_SORTS,
  LIBRARY_TABS,
  type LibraryEntry,
  type LibrarySort,
  type LibraryTab,
} from '../../lib/library'
import { formatEnum } from '../../lib/format'
import { PageShell } from '../ui/PageShell'
import { LibraryCard } from './LibraryCard'
import { ContinueHistory } from './ContinueHistory'
import { ContinueReading } from './ContinueReading'

type StoredViewerData = { favorites: FavoriteItem[]; history: ContinueItem[]; reading: MangaReaderRecord[] }

const TAB_LABELS: Record<LibraryTab, string> = {
  all: 'All Saved',
  watching: 'Currently Watching',
  completed: 'Completed',
  planning: 'Planning',
  paused: 'Paused',
  dropped: 'Dropped',
  history: 'Continue Watching',
}

const SORT_LABELS: Record<LibrarySort, string> = {
  'recent-added': 'Recently Added',
  'recent-watched': 'Recently Watched',
  title: 'Title',
  score: 'Score',
}

function tabLabel(tab: LibraryTab, mode: CatalogMode): string {
  if (tab === 'watching' && mode === 'MANGA') return 'Reading'
  if (tab === 'history' && mode === 'MANGA') return 'Continue Reading'
  return TAB_LABELS[tab]
}

function sortLabel(sort: LibrarySort, mode: CatalogMode): string {
  if (sort === 'recent-watched' && mode === 'MANGA') return 'Recently Updated'
  return SORT_LABELS[sort]
}

export function LibraryPage() {
  const catalogMode = useOptionalCatalogMode()
  const mode = () => catalogMode?.mode() ?? 'ANIME'
  const copy = () => catalogCopy[mode()]
  const [stored, setStored] = createSignal<StoredViewerData | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [loadError, setLoadError] = createSignal(false)
  const [tab, setTab] = createSignal<LibraryTab>('all')
  const [format, setFormat] = createSignal('')
  const [sort, setSort] = createSignal<LibrarySort>('recent-added')
  const [busyIds, setBusyIds] = createSignal<ReadonlySet<number>>(new Set())
  const [failure, setFailure] = createSignal<string | null>(null)
  const [confirmClear, setConfirmClear] = createSignal(false)

  const loadStored = async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const [favorites, history, reading] = await Promise.all([
        viewerData.getFavorites(),
        viewerData.getContinue(),
        mangaReaderData.list(),
      ])
      setStored({ favorites, history, reading })
    } catch (cause) {
      console.error('Failed to open the local viewer library.', cause)
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  onMount(() => {
    void loadStored()
  })

  createEffect(on(mode, () => {
    setTab('all')
    setFormat('')
  }))

  const activeFavorites = createMemo(() => (stored()?.favorites ?? []).filter((item) => (item.catalogMode ?? 'ANIME') === mode()))
  const activeHistory = createMemo(() => mode() === 'ANIME' ? (stored()?.history ?? []) : [])
  const activeReading = createMemo(() => mode() === 'MANGA' ? (stored()?.reading ?? []) : [])
  const activeProgressCount = createMemo(() => mode() === 'ANIME'
    ? activeHistory().filter((item) => !item.completed).length
    : activeReading().filter((item) => !item.completed).length)
  const allIds = createMemo(() => [...new Set([
    ...activeFavorites().map((item) => item.id),
    ...activeHistory().map((item) => item.id),
    ...activeReading().map((item) => item.anilistId),
  ])])
  const metadata = createQuery(() => byIdsQuery(allIds(), mode()))
  const mediaById = createMemo(() => new Map((metadata.data ?? []).map((media) => [media.id, media])))
  const entries = createMemo<LibraryEntry[]>(() => {
    const progressById = mode() === 'ANIME'
      ? new Map(activeHistory().map((item) => [item.id, item.ts]))
      : new Map(activeReading().map((item) => [item.anilistId, item.updatedAt]))
    return activeFavorites().map((favorite) => {
      const media = mediaById().get(favorite.id)
      return {
        favorite,
        media,
        lastWatchedAt: progressById.get(favorite.id),
        unavailable: metadata.isSuccess && !media,
      }
    })
  })
  const visibleEntries = createMemo(() => filterAndSortLibrary(entries(), {
    tab: tab(),
    format: format(),
    sort: sort(),
  }))
  const formats = createMemo(() => libraryFormats(entries()))
  const counts = createMemo(() => ({
    all: entries().length,
    watching: entries().filter((entry) => entry.favorite.status === 'WATCHING').length,
    completed: entries().filter((entry) => entry.favorite.status === 'COMPLETED').length,
    planning: entries().filter((entry) => (entry.favorite.status ?? 'PLANNING') === 'PLANNING').length,
    paused: entries().filter((entry) => entry.favorite.status === 'PAUSED').length,
    dropped: entries().filter((entry) => entry.favorite.status === 'DROPPED').length,
    history: mode() === 'ANIME' ? activeHistory().length : activeReading().length,
  }))

  let mutationQueue = Promise.resolve()
  const enqueueMutation = (operation: () => Promise<void>) => {
    const next = mutationQueue.then(operation, operation)
    mutationQueue = next.catch(() => undefined)
    return next
  }

  const runItemMutation = (id: number, mutation: () => Promise<void>, update: (data: StoredViewerData) => StoredViewerData) => enqueueMutation(async () => {
    const current = untrack(stored)
    if (!current || untrack(busyIds).has(id)) return
    setFailure(null)
    setBusyIds((ids) => new Set(ids).add(id))
    setStored(update(current))
    try {
      await mutation()
    } catch (cause) {
      console.error('Failed to update the library.', cause)
      setStored(current)
      setFailure('That library change could not be saved. Your previous state has been restored.')
    } finally {
      setBusyIds((ids) => {
        const next = new Set(ids)
        next.delete(id)
        return next
      })
    }
  })

  const changeStatus = (id: number, status: FavoriteStatus) => runItemMutation(
    id,
    () => viewerData.updateFavoriteStatus(id, status, mode()),
    (data) => ({ ...data, favorites: data.favorites.map((item) => item.id === id && (item.catalogMode ?? 'ANIME') === mode() ? { ...item, status } : item) }),
  )
  const removeFavorite = (id: number) => runItemMutation(
    id,
    () => viewerData.removeFavorite(id, mode()),
    (data) => ({ ...data, favorites: data.favorites.filter((item) => !(item.id === id && (item.catalogMode ?? 'ANIME') === mode())) }),
  )
  const removeHistory = (id: number) => runItemMutation(
    id,
    () => mode() === 'ANIME' ? viewerData.removeContinue(id) : mangaReaderData.remove(id),
    (data) => mode() === 'ANIME'
      ? { ...data, history: data.history.filter((item) => item.id !== id) }
      : { ...data, reading: data.reading.filter((item) => item.anilistId !== id) },
  )
  const clearHistory = () => enqueueMutation(async () => {
    const current = untrack(stored)
    if (!current) return
    setConfirmClear(false)
    setFailure(null)
    setStored(mode() === 'ANIME' ? { ...current, history: [] } : { ...current, reading: [] })
    try {
      if (mode() === 'ANIME') await viewerData.clearContinue()
      else await Promise.all(current.reading.map((item) => mangaReaderData.remove(item.anilistId)))
    } catch (cause) {
      console.error(`Failed to clear ${mode() === 'ANIME' ? 'continue-watching history' : 'reading history'}.`, cause)
      setStored(current)
      setFailure(`${mode() === 'ANIME' ? 'Continue Watching' : 'Continue Reading'} could not be cleared. Your previous history has been restored.`)
    }
  })

  return (
    <PageShell class="library-page">
      <header class="frosted-shell grid gap-7 px-6 py-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <p class="mono-signal">Personal archive / {copy().singular} saved on this device</p>
          <h1 class="mt-3 max-w-4xl font-display text-6xl leading-[.88] tracking-[-.04em] sm:text-8xl">Your {copy().singular} library.</h1>
          <p class="mt-5 max-w-2xl text-sm leading-6 text-text-secondary">{mode() === 'ANIME' ? 'Review saved anime, track watch progress, and return to the episode you left.' : 'Review saved manga, track reading progress, and return to the chapter you left.'}</p>
        </div>
        <dl class="grid grid-cols-3 gap-2 text-center sm:gap-3 sm:text-right">
          <LibraryStat label="Saved" value={counts().all} />
          <LibraryStat label={mode() === 'MANGA' ? 'Reading' : 'Watching'} value={counts().watching} />
          <LibraryStat label={mode() === 'ANIME' ? 'In progress' : 'To read'} value={activeProgressCount()} />
        </dl>
      </header>

      <Show when={failure()}>{(message) => <p class="material-panel mt-5 border-red-800/25 bg-red-50/80 p-4 text-sm text-red-900" role="alert">{message()}</p>}</Show>

      <Show when={!loading()} fallback={<LibraryLoading />}>
        <Show when={!loadError()} fallback={<LibraryLoadError onRetry={() => { void loadStored() }} />}>
          <section class="material-panel mt-8 overflow-hidden" aria-labelledby="library-collection-title">
            <div class="border-b border-line px-4 py-4 sm:px-6">
              <div class="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p class="mono-signal">Collection / {visibleEntries().length} shown</p>
                  <h2 id="library-collection-title" class="mt-1 font-display text-3xl tracking-[-.03em]">Saved {copy().plural}</h2>
                </div>
                <Show when={tab() !== 'history'}>
                  <div class="grid w-full grid-cols-2 gap-3 sm:flex sm:w-auto sm:flex-wrap sm:gap-2">
                  <label class="editorial-label grid min-w-0 gap-1.5 sm:flex sm:items-center sm:gap-2">Format
                    <select class="editorial-field h-11 w-full min-w-0 px-3 text-xs sm:h-10 sm:w-auto" value={format()} onChange={(event) => setFormat(event.currentTarget.value)}>
                      <option value="">All formats</option>
                      <For each={formats()}>{(value) => <option value={value}>{formatEnum(value)}</option>}</For>
                    </select>
                  </label>
                  <label class="editorial-label grid min-w-0 gap-1.5 sm:flex sm:items-center sm:gap-2">Sort
                    <select class="editorial-field h-11 w-full min-w-0 px-3 text-xs sm:h-10 sm:w-auto" value={sort()} onChange={(event) => setSort(event.currentTarget.value as LibrarySort)}>
                      <For each={LIBRARY_SORTS}>{(value) => <option value={value}>{sortLabel(value, mode())}</option>}</For>
                    </select>
                  </label>
                  </div>
                </Show>
              </div>
              <div class="library-tabs mt-4 flex gap-2 overflow-x-auto" role="tablist" aria-label={`${copy().singular} library categories`}>
                <For each={LIBRARY_TABS}>{(value) => (
                  <button
                    id={`library-tab-${value}`}
                    class="paper-control shrink-0 px-3"
                    classList={{ 'border-ink bg-ink text-white': tab() === value }}
                    type="button"
                    role="tab"
                    aria-selected={tab() === value}
                    aria-controls={value === 'history' ? 'library-history-panel' : 'library-collection-panel'}
                    tabIndex={tab() === value ? 0 : -1}
                    onClick={() => setTab(value)}
                  >
                    {tabLabel(value, mode())} · {counts()[value]}
                  </button>
                )}</For>
              </div>
            </div>

            <Switch>
              <Match when={tab() === 'history' && mode() === 'ANIME'}>
                <div id="library-history-panel" class="p-4 sm:p-6" role="tabpanel" aria-labelledby="library-tab-history">
                  <div class="mb-4 flex flex-wrap items-center justify-end gap-2">
                    <Show when={!confirmClear()} fallback={<><span class="text-xs text-text-secondary">Clear all Continue Watching history?</span><button class="ink-control px-3" type="button" onClick={() => { void clearHistory() }}>Confirm clear</button><button class="paper-control px-3" type="button" onClick={() => setConfirmClear(false)}>Cancel</button></>}>
                      <button class="paper-control px-3" type="button" disabled={activeHistory().length === 0} onClick={() => setConfirmClear(true)}>Clear history</button>
                    </Show>
                  </div>
                  <ContinueHistory items={activeHistory()} mediaById={mediaById()} busyIds={busyIds()} onRemove={(id) => { void removeHistory(id) }} />
                </div>
              </Match>
              <Match when={tab() === 'history' && mode() === 'MANGA'}>
                <div id="library-history-panel" class="p-4 sm:p-6" role="tabpanel" aria-labelledby="library-tab-history">
                  <div class="mb-4 flex flex-wrap items-center justify-end gap-2">
                    <Show when={!confirmClear()} fallback={<><span class="text-xs text-text-secondary">Clear all Continue Reading history?</span><button class="ink-control px-3" type="button" onClick={() => { void clearHistory() }}>Confirm clear</button><button class="paper-control px-3" type="button" onClick={() => setConfirmClear(false)}>Cancel</button></>}>
                      <button class="paper-control px-3" type="button" disabled={activeReading().length === 0} onClick={() => setConfirmClear(true)}>Clear history</button>
                    </Show>
                  </div>
                  <ContinueReading items={activeReading()} mediaById={mediaById()} busyIds={busyIds()} onRemove={(id) => { void removeHistory(id) }} />
                </div>
              </Match>
              <Match when={true}>
                <div id="library-collection-panel" role="tabpanel" aria-labelledby={`library-tab-${tab()}`}>
                  <Show when={entries().length > 0} fallback={<LibraryEmpty mode={mode()} /> }>
                    <Show when={visibleEntries().length > 0} fallback={<FilteredEmpty mode={mode()} onReset={() => { setTab('all'); setFormat('') }} />}>
                      <div class="grid grid-cols-1 divide-y divide-line lg:grid-cols-2 lg:[&>*:nth-child(odd)]:border-r lg:[&>*:nth-child(odd)]:border-line">
                        <For each={visibleEntries()}>{(entry) => <LibraryCard entry={entry} mode={mode()} busy={busyIds().has(entry.favorite.id)} onStatus={(status) => { void changeStatus(entry.favorite.id, status) }} onRemove={() => { void removeFavorite(entry.favorite.id) }} />}</For>
                      </div>
                    </Show>
                  </Show>
                </div>
              </Match>
            </Switch>
          </section>
        </Show>
      </Show>

      <Show when={metadata.isError && allIds().length > 0}>
        <div class="mt-4 flex flex-wrap items-center gap-3 text-xs text-text-muted" role="status">
          <span>Fresh AniList metadata is unavailable. Stored titles and cover art are shown instead.</span>
          <button class="paper-control px-3 py-2" type="button" onClick={() => { void metadata.refetch() }}>Retry metadata</button>
        </div>
      </Show>
    </PageShell>
  )
}

function LibraryStat(props: { label: string; value: number }) {
  return <div class="min-w-0 rounded-[12px] border border-white/80 bg-white/58 px-2.5 py-3 shadow-[0_12px_30px_-22px_rgb(0_0_0/.4)] sm:px-4"><dt class="mono-signal">{props.label}</dt><dd class="mt-1 font-display text-3xl leading-none sm:text-4xl">{props.value}</dd></div>
}

function LibraryLoading() {
  return <section class="material-panel mt-8 grid min-h-64 place-items-center" aria-busy="true"><p class="mono-signal">Loading saved titles…</p></section>
}

function LibraryLoadError(props: { onRetry: () => void }) {
  return <section class="material-panel mt-8 p-8 text-center" role="alert"><h2 class="font-display text-4xl">Your library could not be opened.</h2><p class="mt-3 text-sm text-text-secondary">This browser could not read the local viewer database.</p><button class="ink-control mt-5 px-5" type="button" onClick={() => props.onRetry()}>Try again</button></section>
}

function LibraryEmpty(props: { mode: CatalogMode }) {
  const noun = () => props.mode === 'MANGA' ? 'manga' : 'anime'
  return <section class="px-6 py-14 text-center"><p class="mono-signal">No saved {noun()}</p><h3 class="mt-2 font-display text-4xl">Your library is empty.</h3><p class="mx-auto mt-3 max-w-md text-sm text-text-secondary">{props.mode === 'MANGA' ? 'Save a manga title from its detail page to add it here.' : 'Save an anime from its detail page to add it here.'}</p></section>
}

function FilteredEmpty(props: { mode: CatalogMode; onReset: () => void }) {
  const noun = () => props.mode === 'MANGA' ? 'manga' : 'anime'
  return <section class="px-6 py-14 text-center"><p class="mono-signal">No {noun()} matches</p><h3 class="mt-2 font-display text-4xl">No saved titles match these filters.</h3><button class="paper-control mt-5 px-4" type="button" onClick={() => props.onReset()}>Show all saved</button></section>
}
