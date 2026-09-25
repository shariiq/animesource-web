import { Link } from '@tanstack/solid-router'
import { createSignal, For, onMount, Show } from 'solid-js'
import { importAniListPublicList } from '../../data/anilist/import'
import { viewerData } from '../../lib/persistence/active'
import {
  DEFAULT_MANGA_READER_SETTINGS,
  mangaReaderBackgroundSchema,
  mangaReaderData,
  mangaReaderDirectionSchema,
  mangaReaderFitSchema,
  mangaReaderGapSchema,
  mangaReaderLayoutSchema,
  type MangaReaderBackground,
  type MangaReaderDirection,
  type MangaReaderFit,
  type MangaReaderGap,
  type MangaReaderLayout,
  type MangaReaderSettings,
} from '../../lib/persistence/mangaReader'
import { favoriteStorageKey } from '../../lib/persistence/schema'
import type { ViewerPreferences } from '../../lib/persistence/viewer'
import { getViewerSyncStatus } from '../../lib/sync/viewerSync'
import type { ViewerSyncStatus } from '../../lib/persistence/schema'
import { PageShell } from '../ui/PageShell'

const LANGUAGE_OPTIONS = [
  ['en', 'English'],
  ['ja', '日本語'],
  ['zh-Hans', '简体中文'],
  ['ko', '한국어'],
  ['es', 'Español'],
  ['fr', 'Français'],
] as const

const TIMEZONE_OPTIONS = [
  'UTC',
  'Asia/Calcutta',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Australia/Sydney',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
] as const

const DEFAULT_PREFERENCES: ViewerPreferences = {
  adultContent: false,
  catalogMode: 'ANIME',
  language: 'en',
  timezone: 'UTC',
  notifications: false,
  updatedAt: 0,
}

const READER_LAYOUT_OPTIONS: readonly [MangaReaderLayout, string][] = [
  ['continuous', 'Continuous'],
  ['paged', 'Paged'],
  ['double', 'Spread'],
]
const READER_DIRECTION_OPTIONS: readonly [MangaReaderDirection, string][] = [
  ['rtl', 'Right to left'],
  ['ltr', 'Left to right'],
]
const READER_FIT_OPTIONS: readonly [MangaReaderFit, string][] = [
  ['fit-width', 'Fit width'],
  ['fit-screen', 'Fit screen'],
  ['original', 'Original'],
]
const READER_BACKGROUND_OPTIONS: readonly [MangaReaderBackground, string][] = [
  ['ink', 'Ink'],
  ['black', 'Black'],
  ['sepia', 'Sepia'],
  ['paper', 'Paper'],
]
const READER_GAP_OPTIONS: readonly [MangaReaderGap, string][] = [
  ['none', 'None'],
  ['small', 'Tight'],
  ['large', 'Roomy'],
]

export function SettingsPage() {
  const [preferences, setPreferences] = createSignal<ViewerPreferences>(DEFAULT_PREFERENCES)
  const [syncStatus, setSyncStatus] = createSignal<ViewerSyncStatus | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [message, setMessage] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [aniListUsername, setAniListUsername] = createSignal('')
  const [readerDefaults, setReaderDefaults] = createSignal<MangaReaderSettings>(DEFAULT_MANGA_READER_SETTINGS)
  const [loaded, setLoaded] = createSignal(false)

  const connectionLabel = () => {
    switch (syncStatus()?.state) {
      case 'idle': return 'Account connected'
      case 'syncing': return 'Sync in progress'
      case 'error': return 'Sync needs attention'
      default: return 'Local-only'
    }
  }
  const connectionCopy = () => {
    switch (syncStatus()?.state) {
      case 'idle': return 'Your viewer data is connected to an account.'
      case 'syncing': return 'Your latest changes are being prepared for sync.'
      case 'error': return 'Your data remains safely stored on this device.'
      default: return 'This browser remains the source of truth until you connect an account.'
    }
  }

  onMount(() => {
    void Promise.all([
      viewerData.getViewerPreferences().then(setPreferences),
      mangaReaderData.getDefaults().then(setReaderDefaults),
      getViewerSyncStatus().then(setSyncStatus),
    ]).then(() => setLoaded(true)).catch((cause) => {
      console.error('Failed to load viewer settings.', cause)
      setError('These settings could not be opened from this browser.')
    })
  })

  const savePreferences = async () => {
    setBusy(true)
    setMessage(null)
    setError(null)
    try {
      const current = preferences()
      await viewerData.setViewerPreferences({
        adultContent: current.adultContent,
        catalogMode: current.catalogMode,
        language: current.language,
        timezone: current.timezone,
        notifications: current.notifications,
      })
      await mangaReaderData.saveDefaults(readerDefaults())
      setMessage('Preferences saved on this device.')
    } catch (cause) {
      console.error('Failed to save viewer preferences.', cause)
      setError('Preferences could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const exportData = async () => {
    setBusy(true)
    setError(null)
    try {
      const snapshot = await viewerData.exportViewerData()
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `animesource-viewer-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(url)
      setMessage('Viewer data exported.')
    } catch (cause) {
      console.error('Failed to export viewer data.', cause)
      setError('Viewer data could not be exported.')
    } finally {
      setBusy(false)
    }
  }

  const importData = async (event: Event) => {
    const input = event.currentTarget
    if (!(input instanceof HTMLInputElement) || !input.files?.[0]) return
    const file = input.files[0]
    input.value = ''
    setBusy(true)
    setMessage(null)
    setError(null)
    try {
      await viewerData.importViewerData(JSON.parse(await file.text()), 'merge')
      setMessage('Viewer data imported and merged with this device.')
    } catch (cause) {
      console.error('Failed to import viewer data.', cause)
      setError(cause instanceof Error ? cause.message : 'That viewer data file could not be imported.')
    } finally {
      setBusy(false)
    }
  }

  const importAniList = async () => {
    setBusy(true)
    setMessage(null)
    setError(null)
    try {
      const imported = await importAniListPublicList(aniListUsername())
      const current = await viewerData.exportViewerData()
      const favorites = new Map(current.favorites.map((item) => [favoriteStorageKey(item.id, item.catalogMode), item]))
      const importedKeys = new Set<string>()
      const now = Date.now()
      for (const item of imported) {
        const importedFavorite = { ...item, ts: now }
        importedKeys.add(favoriteStorageKey(importedFavorite.id, importedFavorite.catalogMode))
        favorites.set(favoriteStorageKey(importedFavorite.id, importedFavorite.catalogMode), importedFavorite)
      }
      await viewerData.importViewerData({
        ...current,
        exportedAt: now,
        favorites: [...favorites.values()],
        tombstones: current.tombstones.filter((entry) => !(entry.collection === 'favorites' && importedKeys.has(entry.key))),
      }, 'replace')
      setMessage(`${imported.length} public AniList entries merged into your library.`)
    } catch (cause) {
      console.error('Failed to import the AniList list.', cause)
      setError(cause instanceof Error ? cause.message : 'The AniList list could not be imported.')
    } finally {
      setBusy(false)
    }
  }

  const deleteLocalData = async () => {
    if (!window.confirm('Delete all viewer data stored on this device? This cannot be undone.')) return
    setBusy(true)
    setMessage(null)
    setError(null)
    try {
      await viewerData.clearViewerData()
      setPreferences(DEFAULT_PREFERENCES)
      setReaderDefaults(DEFAULT_MANGA_READER_SETTINGS)
      setMessage('All local viewer data was deleted.')
    } catch (cause) {
      console.error('Failed to delete local viewer data.', cause)
      setError('Local viewer data could not be completely deleted.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageShell class="account-page">
      <header class="frosted-shell relative overflow-hidden px-6 py-7 sm:px-8 sm:py-9">
        <div class="pointer-events-none absolute inset-y-0 right-0 hidden w-[42%] bg-[radial-gradient(circle_at_80%_18%,rgb(217_245_106_/_42%),transparent_39%),radial-gradient(circle_at_38%_82%,rgb(250_119_95_/_18%),transparent_48%)] lg:block" aria-hidden="true" />
        <div class="relative grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-end">
          <div>
            <div class="flex items-center gap-4">
              <div class="grid size-14 shrink-0 place-items-center rounded-[18px] border border-white/85 bg-ink font-display text-3xl leading-none text-white shadow-[0_16px_32px_-22px_rgb(0_0_0_/_1)]" aria-hidden="true">S</div>
              <div>
                <p class="mono-signal">Viewer settings</p>
                <p class="mt-1 inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/62 px-3 py-1 font-mono text-[9px] uppercase tracking-[.1em] text-text-muted"><span class="size-1.5 rounded-full bg-violet" aria-hidden="true" />Local-first controls</p>
              </div>
            </div>
            <h1 class="mt-7 max-w-4xl font-display text-5xl leading-[.88] tracking-[-.04em] sm:text-7xl">Viewer settings.</h1>
            <p class="mt-5 max-w-2xl text-sm leading-6 text-text-secondary">Set catalog, language, timezone, notification, and manga reader defaults. Preferences are saved in this browser.</p>
            <Link class="paper-control mt-6 inline-flex px-4 py-3 text-xs" to="/profile">View profile</Link>
          </div>

          <section class="rounded-[18px] border border-white/80 bg-white/48 p-5 shadow-[0_20px_45px_-38px_rgb(0_0_0_/_55)] backdrop-blur-[22px]" aria-label="Settings storage summary">
            <p class="mono-signal">Storage</p>
            <p class="mt-3 font-display text-3xl tracking-[-.03em]">Local storage.</p>
            <dl class="mt-5 grid gap-4 border-t border-line pt-4 text-sm">
              <div class="flex items-start justify-between gap-5"><dt class="editorial-label">Storage</dt><dd class="text-right font-medium">This browser</dd></div>
              <div class="flex items-start justify-between gap-5"><dt class="editorial-label">Connection</dt><dd class="text-right font-medium">{connectionLabel()}</dd></div>
            </dl>
          </section>
        </div>
      </header>

      <Show when={message()}>{(value) => <div class="material-panel mt-5 flex items-start gap-3 border-emerald-800/20 bg-emerald-50/80 p-4 text-sm text-emerald-950" role="status"><span class="mt-1.5 size-2 shrink-0 rounded-full bg-emerald-600" aria-hidden="true" /><p>{value()}</p></div>}</Show>
      <Show when={error()}>{(value) => <div class="material-panel mt-5 flex items-start gap-3 border-red-800/25 bg-red-50/80 p-4 text-sm text-red-900" role="alert"><span class="mt-1.5 size-2 shrink-0 rounded-full bg-red-700" aria-hidden="true" /><p>{value()}</p></div>}</Show>

      <div class="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(19rem,.8fr)]">
        <section class="material-panel p-6 sm:p-8" aria-labelledby="content-settings-title">
          <div class="flex items-start justify-between gap-5">
            <div>
              <p class="mono-signal">01 / Viewer defaults</p>
              <h2 id="content-settings-title" class="mt-2 font-display text-4xl tracking-[-.03em] sm:text-5xl">Viewer defaults.</h2>
            </div>
            <span class="grid size-10 shrink-0 place-items-center rounded-full border border-black/10 bg-white/65 font-mono text-xs text-text-muted" aria-hidden="true">01</span>
          </div>
          <p class="mt-4 max-w-xl text-sm leading-6 text-text-secondary">Set the catalog, language, timezone, notification, and manga reader defaults used by this browser.</p>
          <div class="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <label class="editorial-field-group text-sm">
              <span class="editorial-label">Default catalog</span>
              <select class="editorial-field px-3" disabled={!loaded() || busy()} value={preferences().catalogMode} onChange={(event) => setPreferences((current) => ({ ...current, catalogMode: event.currentTarget.value === 'MANGA' ? 'MANGA' : 'ANIME' }))}>
                <option value="ANIME">Anime</option>
                <option value="MANGA">Manga</option>
              </select>
            </label>
            <label class="editorial-field-group text-sm">
              <span class="editorial-label">Language</span>
              <select class="editorial-field px-3" disabled={!loaded() || busy()} value={preferences().language} onChange={(event) => setPreferences((current) => ({ ...current, language: event.currentTarget.value }))}>
                <For each={LANGUAGE_OPTIONS}>{(option) => <option value={option[0]}>{option[1]}</option>}</For>
              </select>
            </label>
            <label class="editorial-field-group text-sm">
              <span class="editorial-label">Timezone</span>
              <select class="editorial-field px-3" disabled={!loaded() || busy()} value={preferences().timezone} onChange={(event) => setPreferences((current) => ({ ...current, timezone: event.currentTarget.value }))}>
                <For each={TIMEZONE_OPTIONS}>{(timezone) => <option value={timezone}>{timezone}</option>}</For>
              </select>
            </label>
          </div>
          <div class="mt-6 grid gap-3">
            <label class="flex items-start gap-3 rounded-[14px] border border-line bg-white/45 p-4 text-sm leading-6 transition-colors has-[:focus-visible]:border-ink has-[:hover]:bg-white/65">
              <input class="mt-1 size-4 shrink-0 accent-black" disabled={!loaded() || busy()} type="checkbox" checked={preferences().adultContent} onChange={(event) => setPreferences((current) => ({ ...current, adultContent: event.currentTarget.checked }))} />
              <span><strong class="font-semibold text-text-primary">Allow adult-content results</strong><br /><span class="text-text-secondary">Off by default. This preference is explicit and will be account-scoped later.</span></span>
            </label>
            <label class="flex items-start gap-3 rounded-[14px] border border-line bg-white/45 p-4 text-sm leading-6 transition-colors has-[:focus-visible]:border-ink has-[:hover]:bg-white/65">
              <input class="mt-1 size-4 shrink-0 accent-black" disabled={!loaded() || busy()} type="checkbox" checked={preferences().notifications} onChange={(event) => setPreferences((current) => ({ ...current, notifications: event.currentTarget.checked }))} />
              <span><strong class="font-semibold text-text-primary">Release notifications</strong><br /><span class="text-text-secondary">Keep the preference now; delivery remains disabled until account identity exists.</span></span>
            </label>
          </div>
          <div class="mt-7 border-t border-line pt-6">
            <div>
              <p class="mono-signal">Manga reader defaults</p>
              <p class="mt-2 max-w-xl text-sm leading-6 text-text-secondary">These settings apply when a manga has no saved reader preferences. Korean and Chinese titles start seamless (continuous, no gap) for long-strip reading. A manga-specific choice always takes precedence.</p>
            </div>
            <div class="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <label class="editorial-field-group text-sm">
                <span class="editorial-label">Layout</span>
                <select class="editorial-field px-3" disabled={!loaded() || busy()} value={readerDefaults().layout} onChange={(event) => { const value = mangaReaderLayoutSchema.safeParse(event.currentTarget.value); if (value.success) setReaderDefaults((current) => ({ ...current, layout: value.data })) }}>
                  <For each={READER_LAYOUT_OPTIONS}>{(option) => <option value={option[0]}>{option[1]}</option>}</For>
                </select>
              </label>
              <label class="editorial-field-group text-sm">
                <span class="editorial-label">Direction</span>
                <select class="editorial-field px-3" disabled={!loaded() || busy()} value={readerDefaults().direction} onChange={(event) => { const value = mangaReaderDirectionSchema.safeParse(event.currentTarget.value); if (value.success) setReaderDefaults((current) => ({ ...current, direction: value.data })) }}>
                  <For each={READER_DIRECTION_OPTIONS}>{(option) => <option value={option[0]}>{option[1]}</option>}</For>
                </select>
              </label>
              <label class="editorial-field-group text-sm">
                <span class="editorial-label">Page fit</span>
                <select class="editorial-field px-3" disabled={!loaded() || busy()} value={readerDefaults().fit} onChange={(event) => { const value = mangaReaderFitSchema.safeParse(event.currentTarget.value); if (value.success) setReaderDefaults((current) => ({ ...current, fit: value.data })) }}>
                  <For each={READER_FIT_OPTIONS}>{(option) => <option value={option[0]}>{option[1]}</option>}</For>
                </select>
              </label>
              <label class="editorial-field-group text-sm">
                <span class="editorial-label">Background</span>
                <select class="editorial-field px-3" disabled={!loaded() || busy()} value={readerDefaults().background} onChange={(event) => { const value = mangaReaderBackgroundSchema.safeParse(event.currentTarget.value); if (value.success) setReaderDefaults((current) => ({ ...current, background: value.data })) }}>
                  <For each={READER_BACKGROUND_OPTIONS}>{(option) => <option value={option[0]}>{option[1]}</option>}</For>
                </select>
              </label>
              <label class="editorial-field-group text-sm">
                <span class="editorial-label">Page gap</span>
                <select class="editorial-field px-3" disabled={!loaded() || busy()} value={readerDefaults().gap} onChange={(event) => { const value = mangaReaderGapSchema.safeParse(event.currentTarget.value); if (value.success) setReaderDefaults((current) => ({ ...current, gap: value.data })) }}>
                  <For each={READER_GAP_OPTIONS}>{(option) => <option value={option[0]}>{option[1]}</option>}</For>
                </select>
              </label>
            </div>
          </div>
          <div class="mt-6 flex flex-wrap items-center gap-4 border-t border-line pt-5">
            <button class="ink-control px-5" classList={{ 'cursor-wait opacity-65': busy() || !loaded() }} type="button" disabled={busy() || !loaded()} onClick={() => { void savePreferences() }}>{busy() ? 'Saving…' : 'Save preferences'}</button>
            <span class="font-mono text-[9px] uppercase tracking-[.1em] text-text-quiet">Stored locally first</span>
          </div>
        </section>

        <aside class="grid gap-6">
          <section class="material-panel p-6 sm:p-8" aria-labelledby="sync-settings-title">
            <p class="mono-signal">02 / Account connection</p>
            <h2 id="sync-settings-title" class="mt-2 font-display text-4xl tracking-[-.03em]">Account connection.</h2>
            <p class="mt-4 text-sm leading-6 text-text-secondary">{connectionCopy()}</p>
            <div class="mt-6 rounded-[14px] border border-black/10 bg-black px-4 py-4 text-white shadow-[0_20px_35px_-30px_rgb(0_0_0_/_1)]">
              <p class="font-mono text-[9px] uppercase tracking-[.12em] text-white/60">Current connection</p>
              <p class="mt-2 text-sm font-semibold">{connectionLabel()}</p>
            </div>
            <div class="mt-5 grid gap-3 text-sm">
              <div class="rounded-[12px] border border-line bg-white/45 p-4"><strong>Offline policy</strong><br /><span class="text-text-secondary">Local changes stay available and are never discarded because a remote write fails.</span></div>
              <div class="rounded-[12px] border border-line bg-white/45 p-4"><strong>Conflict policy</strong><br /><span class="text-text-secondary">Records use last-write-wins timestamps; equal-time conflicts prefer local data, and deletions use tombstones.</span></div>
            </div>
          </section>
        </aside>
      </div>

      <div class="mt-6 grid gap-6 lg:grid-cols-2">
        <section class="material-panel p-6 sm:p-8" aria-labelledby="transfer-title">
          <p class="mono-signal">03 / Portability</p>
          <h2 id="transfer-title" class="mt-2 font-display text-4xl tracking-[-.03em] sm:text-5xl">Export or import data.</h2>
          <p class="mt-4 max-w-xl text-sm leading-6 text-text-secondary">Keep a portable copy of your local library, progress, playback preferences, source matches, profile preferences, and search history.</p>
          <div class="mt-6 flex flex-wrap gap-3">
            <button class="ink-control px-5" type="button" disabled={busy()} onClick={() => { void exportData() }}>Export viewer data</button>
            <label class="paper-control cursor-pointer px-5 py-3 text-xs">Import and merge<input class="sr-only" type="file" accept="application/json,.json" onChange={(event) => { void importData(event) }} /></label>
          </div>
          <div class="mt-6 grid grid-cols-2 gap-3 border-t border-line pt-5 text-center font-mono text-[9px] uppercase tracking-[.1em] text-text-muted">
            <span class="rounded-[10px] bg-white/55 px-3 py-2">Versioned export</span>
            <span class="rounded-[10px] bg-white/55 px-3 py-2">Merge-safe import</span>
          </div>
        </section>

        <section class="material-panel p-6 sm:p-8" aria-labelledby="anilist-import-title">
          <p class="mono-signal">04 / Provider import</p>
          <h2 id="anilist-import-title" class="mt-2 font-display text-4xl tracking-[-.03em] sm:text-5xl">Import AniList lists.</h2>
          <p class="mt-4 max-w-xl text-sm leading-6 text-text-secondary">Import public AniList anime and manga lists by username. Existing entries are preserved and matching IDs are updated with the provider status.</p>
          <div class="mt-7 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label class="editorial-field-group text-sm">
              <span class="editorial-label">AniList username</span>
              <input class="editorial-field px-3" value={aniListUsername()} placeholder="Your public username" aria-label="AniList username" onInput={(event) => setAniListUsername(event.currentTarget.value)} />
            </label>
            <button class="paper-control px-5" type="button" disabled={busy() || !aniListUsername().trim()} onClick={() => { void importAniList() }}>Import lists</button>
          </div>
          <p class="mt-5 border-t border-line pt-4 text-xs leading-5 text-text-muted">Only public AniList lists can be imported. Your account credentials never enter this app.</p>
        </section>

        <section class="material-panel relative overflow-hidden border-red-800/20 bg-red-50/35 p-6 sm:p-8 lg:col-span-2" aria-labelledby="delete-data-title">
          <div class="pointer-events-none absolute right-0 top-0 size-48 rounded-full bg-red-200/20 blur-3xl" aria-hidden="true" />
          <div class="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p class="mono-signal text-red-900/70">05 / Device reset</p>
              <h2 id="delete-data-title" class="mt-2 font-display text-4xl tracking-[-.03em] sm:text-5xl">Clear this device.</h2>
              <p class="mt-4 max-w-2xl text-sm leading-6 text-text-secondary">This removes the local profile, preferences, favorites, progress, source matches, search history, and sync metadata from this browser. Account deletion will be added with authentication.</p>
            </div>
            <button class="shrink-0 rounded-[10px] border border-red-800/40 bg-red-50 px-5 py-3 text-xs font-semibold text-red-950 transition-colors hover:bg-red-100" type="button" disabled={busy()} onClick={() => { void deleteLocalData() }}>Delete local data</button>
          </div>
        </section>
      </div>
    </PageShell>
  )
}
