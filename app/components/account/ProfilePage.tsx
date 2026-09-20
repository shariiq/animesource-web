import { Link } from '@tanstack/solid-router'
import { createSignal, onMount, Show } from 'solid-js'
import { viewerData } from '../../lib/persistence/active'
import type { ViewerPreferences, ViewerProfile } from '../../lib/persistence/viewer'
import { getViewerSyncStatus } from '../../lib/sync/viewerSync'
import type { ViewerSyncStatus } from '../../lib/persistence/schema'
import { PageShell } from '../ui/PageShell'

const DEFAULT_PROFILE: ViewerProfile = { displayName: '', updatedAt: 0 }
const DEFAULT_PREFERENCES: ViewerPreferences = {
  adultContent: false,
  language: 'en',
  timezone: 'UTC',
  notifications: false,
  updatedAt: 0,
}

export function ProfilePage() {
  const [profile, setProfile] = createSignal<ViewerProfile>(DEFAULT_PROFILE)
  const [preferences, setPreferences] = createSignal<ViewerPreferences>(DEFAULT_PREFERENCES)
  const [syncStatus, setSyncStatus] = createSignal<ViewerSyncStatus | null>(null)
  const [name, setName] = createSignal('')
  const [message, setMessage] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [loaded, setLoaded] = createSignal(false)

  const profileName = () => profile().displayName || 'Your profile.'
  const profileInitial = () => profile().displayName.trim().charAt(0).toUpperCase() || 'A'
  const languageLabel = () => ({
    en: 'English',
    ja: '日本語',
    'zh-Hans': '简体中文',
    ko: '한국어',
    es: 'Español',
    fr: 'Français',
  }[preferences().language] ?? preferences().language)
  const languageCode = () => preferences().language.split('-')[0]?.toUpperCase() || 'EN'
  const connectionLabel = () => {
    switch (syncStatus()?.state) {
      case 'idle': return 'Account connected'
      case 'syncing': return 'Sync in progress'
      case 'error': return 'Sync needs attention'
      default: return 'Local profile'
    }
  }
  const connectionCopy = () => {
    switch (syncStatus()?.state) {
      case 'idle': return 'Your viewer data is connected to an account.'
      case 'syncing': return 'Your latest changes are being prepared for sync.'
      case 'error': return 'Your data remains safely stored on this device.'
      default: return 'Your name and viewing data stay in this browser.'
    }
  }

  onMount(() => {
    void Promise.all([
      viewerData.getViewerProfile().then((value) => { setProfile(value); setName(value.displayName) }),
      viewerData.getViewerPreferences().then(setPreferences),
      getViewerSyncStatus().then(setSyncStatus),
    ]).then(() => setLoaded(true)).catch((cause) => {
      console.error('Failed to load the local viewer profile.', cause)
      setError('The local profile could not be opened.')
    })
  })

  const saveProfile = async () => {
    setBusy(true)
    setMessage(null)
    setError(null)
    try {
      const displayName = name().trim().slice(0, 80)
      await viewerData.setViewerProfile({ displayName })
      setName(displayName)
      setProfile({ displayName, updatedAt: Date.now() })
      setMessage('Profile saved on this device.')
    } catch (cause) {
      console.error('Failed to save the local viewer profile.', cause)
      setError('The profile could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageShell class="account-page">
      <header class="frosted-shell relative overflow-hidden px-6 py-7 sm:px-8 sm:py-9">
        <div class="pointer-events-none absolute inset-y-0 right-0 hidden w-[42%] bg-[radial-gradient(circle_at_80%_18%,rgb(157_228_196_/_55%),transparent_39%),radial-gradient(circle_at_38%_82%,rgb(118_101_232_/_20%),transparent_48%)] lg:block" aria-hidden="true" />
        <div class="relative grid gap-8 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-end">
          <div>
            <div class="flex items-center gap-4">
              <div class="grid size-14 shrink-0 place-items-center rounded-[18px] border border-white/85 bg-ink font-display text-3xl leading-none text-white shadow-[0_16px_32px_-22px_rgb(0_0_0_/_1)]" aria-hidden="true">{profileInitial()}</div>
              <div>
                <p class="mono-signal">Viewer profile</p>
                <p class="mt-1 inline-flex items-center gap-2 rounded-full border border-emerald-700/15 bg-emerald-50/70 px-3 py-1 font-mono text-[9px] uppercase tracking-[.1em] text-emerald-950"><span class="size-1.5 rounded-full bg-emerald-600" aria-hidden="true" />Saved on this device</p>
              </div>
            </div>
            <h1 class="mt-7 max-w-4xl font-display text-5xl leading-[.88] tracking-[-.04em] sm:text-7xl">{profileName()}</h1>
            <p class="mt-5 max-w-2xl text-sm leading-6 text-text-secondary">A personal viewing space that stays with this browser. Name it now; account sign-in can connect it across devices later.</p>
            <div class="mt-6 flex flex-wrap gap-3">
              <Link class="paper-control px-4 py-3 text-xs" to="/library">Open library</Link>
              <Link class="ink-control px-4 py-3 text-xs" to="/settings">Settings</Link>
            </div>
          </div>

          <section class="rounded-[18px] border border-white/80 bg-white/48 p-5 shadow-[0_20px_45px_-38px_rgb(0_0_0_/_55)] backdrop-blur-[22px]" aria-label="Profile storage summary">
            <p class="mono-signal">Profile home</p>
            <p class="mt-3 font-display text-3xl tracking-[-.03em]">Private, present, yours.</p>
            <dl class="mt-5 grid gap-4 border-t border-line pt-4 text-sm">
              <div class="flex items-start justify-between gap-5"><dt class="editorial-label">Storage</dt><dd class="text-right font-medium">This browser</dd></div>
              <div class="flex items-start justify-between gap-5"><dt class="editorial-label">Connection</dt><dd class="text-right font-medium">{connectionLabel()}</dd></div>
            </dl>
          </section>
        </div>
      </header>

      <div class="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(19rem,.8fr)]">
        <section class="material-panel p-6 sm:p-8" aria-labelledby="profile-details-title">
          <div class="flex items-start justify-between gap-5">
            <div>
              <p class="mono-signal">01 / Local identity</p>
              <h2 id="profile-details-title" class="mt-2 font-display text-4xl tracking-[-.03em] sm:text-5xl">Name your profile.</h2>
            </div>
            <span class="grid size-10 shrink-0 place-items-center rounded-full border border-black/10 bg-white/65 font-mono text-xs text-text-muted" aria-hidden="true">01</span>
          </div>
          <p id="profile-name-help" class="mt-4 max-w-xl text-sm leading-6 text-text-secondary">Use the name you want to see in your library and viewing history. It remains private to this browser until you choose to connect an account.</p>
          <div class="mt-7 flex max-w-2xl flex-col gap-3 sm:flex-row sm:items-end">
            <label class="editorial-field-group min-w-0 flex-1 text-sm">
              <span class="editorial-label">Display name</span>
              <input class="editorial-field px-3" value={name()} maxlength="80" placeholder="Add a display name" aria-describedby="profile-name-help" disabled={!loaded()} onInput={(event) => setName(event.currentTarget.value)} />
            </label>
            <button class="ink-control shrink-0 px-5" classList={{ 'cursor-wait opacity-65': busy() || !loaded() }} type="button" disabled={busy() || !loaded()} onClick={() => { void saveProfile() }}>{busy() ? 'Saving…' : 'Save profile'}</button>
          </div>
          <div class="mt-5 grid gap-3 border-t border-line pt-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
            <span class="inline-flex w-fit items-center gap-2 rounded-full bg-black/5 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[.1em] text-text-muted"><span class="size-1.5 rounded-full bg-emerald-600" aria-hidden="true" />Local-only</span>
            <p class="text-xs leading-5 text-text-muted">No one else can see this name. Back up or move your viewer data from Settings when you need to.</p>
          </div>
          <Show when={message()}>{(value) => <p class="mt-5 rounded-[12px] border border-emerald-800/15 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-950" role="status">{value()}</p>}</Show>
          <Show when={error()}>{(value) => <p class="mt-5 rounded-[12px] border border-red-800/25 bg-red-50/80 px-4 py-3 text-sm text-red-900" role="alert">{value()}</p>}</Show>
        </section>

        <aside class="grid gap-6" aria-labelledby="profile-state-title">
          <section class="material-panel p-6 sm:p-8">
            <p class="mono-signal">Account connection</p>
            <h2 id="profile-state-title" class="mt-2 font-display text-4xl tracking-[-.03em]">Local by design.</h2>
            <p class="mt-4 text-sm leading-6 text-text-secondary">{connectionCopy()}</p>
            <div class="mt-6 rounded-[14px] border border-black/10 bg-black px-4 py-4 text-white shadow-[0_20px_35px_-30px_rgb(0_0_0_/_1)]">
              <p class="font-mono text-[9px] uppercase tracking-[.12em] text-white/60">Current mode</p>
              <p class="mt-2 text-sm font-semibold">{connectionLabel()}</p>
            </div>
            <Show when={syncStatus()?.lastError}>{(value) => <p class="mt-4 text-xs leading-5 text-red-900" role="alert">{value()}</p>}</Show>
          </section>

          <section class="material-panel p-6 sm:p-8" aria-labelledby="profile-preferences-title">
            <div class="flex items-start justify-between gap-4">
              <div>
                <p class="mono-signal text-violet">Viewer defaults</p>
                <h2 id="profile-preferences-title" class="mt-2 font-display text-3xl tracking-[-.03em]">How this space behaves.</h2>
              </div>
              <span class="grid size-9 shrink-0 place-items-center rounded-[10px] border border-violet/20 bg-violet/12 font-mono text-[10px] font-medium text-violet" aria-hidden="true">02</span>
            </div>
            <dl class="mt-6 grid gap-3 text-sm">
              <div class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] border border-violet/20 bg-violet/10 p-3">
                <span class="grid size-8 place-items-center rounded-[9px] bg-violet/15 font-mono text-[10px] font-medium text-violet" aria-hidden="true">{languageCode()}</span>
                <div class="min-w-0"><dt class="editorial-label">Language</dt><dd class="mt-1 text-[11px] leading-4 text-text-secondary">Discovery and interface language</dd></div>
                <dd class="rounded-full border border-violet/20 bg-white/70 px-2.5 py-1 text-right text-xs font-semibold text-ink">{languageLabel()}</dd>
              </div>
              <div class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] border border-mint/55 bg-mint/25 p-3">
                <span class="grid size-8 place-items-center rounded-[9px] bg-white/75 font-mono text-[10px] font-medium text-ink" aria-hidden="true">TZ</span>
                <div class="min-w-0"><dt class="editorial-label">Timezone</dt><dd class="mt-1 text-[11px] leading-4 text-text-secondary">Airing times and release dates</dd></div>
                <dd class="rounded-full border border-black/10 bg-white/75 px-2.5 py-1 text-right text-xs font-semibold text-ink">{preferences().timezone}</dd>
              </div>
              <div class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] border border-orange/30 bg-orange/10 p-3">
                <span class="grid size-8 place-items-center rounded-[9px] bg-orange/18 font-mono text-[10px] font-medium text-orange" aria-hidden="true">↗</span>
                <div class="min-w-0"><dt class="editorial-label">Release alerts</dt><dd class="mt-1 text-[11px] leading-4 text-text-secondary">Keep up with new episodes</dd></div>
                <dd class="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-white/75 px-2.5 py-1 text-right text-xs font-semibold text-ink"><span class={`size-1.5 rounded-full ${preferences().notifications ? 'bg-emerald-600' : 'bg-text-quiet'}`} aria-hidden="true" />{preferences().notifications ? 'On' : 'Off'}</dd>
              </div>
            </dl>
            <div class="mt-5 rounded-[16px] border border-black bg-ink p-3.5 text-white shadow-[0_18px_30px_-26px_rgb(0_0_0_/_1)]">
              <div class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="size-1.5 shrink-0 rounded-full bg-violet" aria-hidden="true" />
                    <p class="font-mono text-[9px] uppercase tracking-[.1em] text-white/60">Fine-tune the signal</p>
                  </div>
                  <p class="mt-2 text-xs leading-5 text-white/80">More controls are ready in Settings.</p>
                </div>
                <Link class="group inline-flex min-h-12 w-full items-center justify-between gap-4 rounded-[12px] border border-white/20 bg-white px-4 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-[.08em] text-ink shadow-[0_8px_18px_-12px_rgb(0_0_0_/_80%)] transition-[background-color,border-color,transform,box-shadow] hover:border-violet hover:bg-violet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/70 sm:w-auto sm:min-w-[11rem]" to="/settings">
                  <span>Adjust preferences</span>
                  <span class="grid size-6 shrink-0 place-items-center rounded-full bg-ink text-sm leading-none text-white transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true">↗</span>
                </Link>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </PageShell>
  )
}
