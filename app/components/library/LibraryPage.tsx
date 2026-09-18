import { createQuery } from '@tanstack/solid-query'
import { createMemo, createSignal, For, Match, onMount, Show, Switch, untrack } from 'solid-js'
import { byIdsQuery } from '../../data/options'
import { browserViewerData } from '../../lib/persistence/viewer'
import type { ContinueItem, FavoriteItem, FavoriteStatus } from '../../lib/persistence/schema'
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

type StoredViewerData = { favorites: FavoriteItem[]; history: ContinueItem[] }

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

export function LibraryPage() {
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
      const [favorites, history] = await Promise.all([
        browserViewerData.getFavorites(),
        browserViewerData.getContinue(),
      ])
      setStored({ favorites, history })
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

  const allIds = createMemo(() => [...new Set([
    ...(stored()?.favorites ?? []).map((item) => item.id),
    ...(stored()?.history ?? []).map((item) => item.id),
  ])])
  const metadata = createQuery(() => byIdsQuery(allIds()))
  const mediaById = createMemo(() => new Map((metadata.data ?? []).map((media) => [media.id, media])))
  const entries = createMemo<LibraryEntry[]>(() => {
    const historyById = new Map((stored()?.history ?? []).map((item) => [item.id, item]))
    return (stored()?.favorites ?? []).map((favorite) => {
      const media = mediaById().get(favorite.id)
      return {
        favorite,
        media,
        lastWatchedAt: historyById.get(favorite.id)?.ts,
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
    history: stored()?.history.length ?? 0,
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
    () => browserViewerData.updateFavoriteStatus(id, status),
    (data) => ({ ...data, favorites: data.favorites.map((item) => item.id === id ? { ...item, status } : item) }),
  )
  const removeFavorite = (id: number) => runItemMutation(
    id,
    () => browserViewerData.removeFavorite(id),
    (data) => ({ ...data, favorites: data.favorites.filter((item) => item.id !== id) }),
  )
  const removeHistory = (id: number) => runItemMutation(
    id,
    () => browserViewerData.removeContinue(id),
    (data) => ({ ...data, history: data.history.filter((item) => item.id !== id) }),
  )
  const clearHistory = () => enqueueMutation(async () => {
    const current = untrack(stored)
    if (!current) return
    setConfirmClear(false)
    setFailure(null)
    setStored({ ...current, history: [] })
    try {
      await browserViewerData.clearContinue()
    } catch (cause) {
      console.error('Failed to clear continue-watching history.', cause)
      setStored(current)
      setFailure('Continue Watching could not be cleared. Your previous history has been restored.')
    }
  })

  return (
    <PageShell class="library-page">
      <header class="frosted-shell grid gap-7 px-6 py-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <p class="mono-signal">Personal archive / stored on this device</p>
          <h1 class="mt-3 max-w-4xl font-display text-6xl leading-[.88] tracking-[-.04em] sm:text-8xl">Your library.</h1>
          <p class="mt-5 max-w-2xl text-sm leading-6 text-text-secondary">Organize saved anime, keep your watch position honest, and return to the exact episode you left.</p>
        </div>
        <dl class="grid grid-cols-2 gap-3 text-right sm:grid-cols-3">
          <LibraryStat label="Saved" value={counts().all} />
          <LibraryStat label="Watching" value={counts().watching} />
          <LibraryStat label="In progress" value={(stored()?.history ?? []).filter((item) => !item.completed).length} />
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
                  <h2 id="library-collection-title" class="mt-1 font-display text-3xl tracking-[-.03em]">Saved anime</h2>
                </div>
                <Show when={tab() !== 'history'}>
                  <div class="flex flex-wrap gap-2">
                  <label class="editorial-label">Format
                    <select class="editorial-field ml-2 h-10 px-3 text-xs" value={format()} onChange={(event) => setFormat(event.currentTarget.value)}>
                      <option value="">All formats</option>
                      <For each={formats()}>{(value) => <option value={value}>{formatEnum(value)}</option>}</For>
                    </select>
                  </label>
                  <label class="editorial-label">Sort
                    <select class="editorial-field ml-2 h-10 px-3 text-xs" value={sort()} onChange={(event) => setSort(event.currentTarget.value as LibrarySort)}>
                      <For each={LIBRARY_SORTS}>{(value) => <option value={value}>{SORT_LABELS[value]}</option>}</For>
                    </select>
                  </label>
                  </div>
                </Show>
              </div>
              <div class="mt-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Library categories">
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
                    {TAB_LABELS[value]} · {counts()[value]}
                  </button>
                )}</For>
              </div>
            </div>

            <Switch>
              <Match when={tab() === 'history'}>
                <div id="library-history-panel" class="p-4 sm:p-6" role="tabpanel" aria-labelledby="library-tab-history">
                  <div class="mb-4 flex flex-wrap items-center justify-end gap-2">
                    <Show when={!confirmClear()} fallback={<><span class="text-xs text-text-secondary">Clear all Continue Watching history?</span><button class="ink-control px-3" type="button" onClick={() => { void clearHistory() }}>Confirm clear</button><button class="paper-control px-3" type="button" onClick={() => setConfirmClear(false)}>Cancel</button></>}>
                      <button class="paper-control px-3" type="button" disabled={(stored()?.history.length ?? 0) === 0} onClick={() => setConfirmClear(true)}>Clear history</button>
                    </Show>
                  </div>
                  <ContinueHistory items={stored()?.history ?? []} mediaById={mediaById()} busyIds={busyIds()} onRemove={(id) => { void removeHistory(id) }} />
                </div>
              </Match>
              <Match when={true}>
                <div id="library-collection-panel" role="tabpanel" aria-labelledby={`library-tab-${tab()}`}>
                  <Show when={entries().length > 0} fallback={<LibraryEmpty /> }>
                    <Show when={visibleEntries().length > 0} fallback={<FilteredEmpty onReset={() => { setTab('all'); setFormat('') }} />}>
                      <div class="grid grid-cols-1 divide-y divide-line lg:grid-cols-2 lg:[&>*:nth-child(odd)]:border-r lg:[&>*:nth-child(odd)]:border-line">
                        <For each={visibleEntries()}>{(entry) => <LibraryCard entry={entry} busy={busyIds().has(entry.favorite.id)} onStatus={(status) => { void changeStatus(entry.favorite.id, status) }} onRemove={() => { void removeFavorite(entry.favorite.id) }} />}</For>
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
  return <div class="rounded-[12px] border border-white/80 bg-white/58 px-4 py-3 shadow-[0_12px_30px_-22px_rgb(0_0_0/.4)]"><dt class="mono-signal">{props.label}</dt><dd class="mt-1 font-display text-4xl leading-none">{props.value}</dd></div>
}

function LibraryLoading() {
  return <section class="material-panel mt-8 grid min-h-64 place-items-center" aria-busy="true"><p class="mono-signal">Opening your library…</p></section>
}

function LibraryLoadError(props: { onRetry: () => void }) {
  return <section class="material-panel mt-8 p-8 text-center" role="alert"><h2 class="font-display text-4xl">Your library could not be opened.</h2><p class="mt-3 text-sm text-text-secondary">This browser could not read the local viewer database.</p><button class="ink-control mt-5 px-5" type="button" onClick={() => props.onRetry()}>Try again</button></section>
}

function LibraryEmpty() {
  return <section class="px-6 py-14 text-center"><p class="mono-signal">No saved anime</p><h3 class="mt-2 font-display text-4xl">Start building your library.</h3><p class="mx-auto mt-3 max-w-md text-sm text-text-secondary">Save an anime from its detail page and it will appear here with fresh catalog metadata.</p></section>
}

function FilteredEmpty(props: { onReset: () => void }) {
  return <section class="px-6 py-14 text-center"><p class="mono-signal">No matches</p><h3 class="mt-2 font-display text-4xl">Nothing fits these filters.</h3><button class="paper-control mt-5 px-4" type="button" onClick={() => props.onReset()}>Show all saved</button></section>
}
