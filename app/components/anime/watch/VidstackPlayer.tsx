import 'vidstack/player/styles/default/theme.css'
import 'vidstack/player/styles/default/layouts/video.css'
import Hls from 'hls.js'
import { isHLSProvider } from 'vidstack'
import { createEffect, createSignal, For, onCleanup, onMount, Show, untrack } from 'solid-js'
import type { MediaPlayerElement } from 'vidstack/elements'
import type { Stream } from '../../../data/anisource/schema'
import type { PlaybackPreferenceValues } from '../../../lib/persistence/viewer'
import type { PlaybackIdentity } from './createWatchSession'

export interface WatchPlayerProps {
  streams: Stream[]
  identity?: PlaybackIdentity
  serverName?: string
  resumeAt?: number
  preferences?: PlaybackPreferenceValues
  onPreferencesChange?: (preferences: PlaybackPreferenceValues) => Promise<void> | void
  onProgress?: (identity: PlaybackIdentity, position: number, duration: number) => Promise<void> | void
  onEnded?: (identity: PlaybackIdentity) => Promise<void> | void
  onMediaError?: (identity: PlaybackIdentity, message: string, expired?: boolean) => boolean | void
  /** Re-resolves the current server with fresh session-bound tickets. */
  onRetry?: () => Promise<void> | void
}

interface PlayerSource {
  src: string
  type?: string
  width?: number
  height?: number
}

interface PlayerTrack {
  key: string
  src: string
  label: string
  language: string
  dataType: string
  isDefault: boolean
}

const EXPIRED_STATUS_PATTERN = /\b(401|403|404|410)\b/
const EXPIRED_MESSAGE = 'This stream link has expired. Refresh this server to request a new stream.'
const GENERIC_MESSAGE = 'This stream could not be played. Try another server, or open the stream directly.'
const HEIGHT_PATTERN = /(\d{3,4})\s*p/i

function heightOfQuality(quality: string): number | null {
  const parsed = HEIGHT_PATTERN.exec(quality)?.[1]
  const height = parsed ? Number(parsed) : NaN
  return Number.isFinite(height) && height > 0 ? height : null
}

function isHlsStream(stream: Stream): boolean {
  return stream.is_hls || stream.url.toLowerCase().includes('.m3u8')
}

/**
 * Orders video variants with the saved quality first so the player opens on
 * the viewer's choice, then by descending resolution. Standalone audio stays
 * out of the picture unless the server returned nothing else.
 */
function toPlayerSources(streams: Stream[], preferredQuality: string | null): PlayerSource[] {
  const videos = streams.filter((stream) => !stream.is_audio)
  const pool = videos.length > 0 ? videos : streams
  return [...pool]
    .sort((left, right) => {
      const rank = (stream: Stream) => (preferredQuality && stream.quality === preferredQuality ? 0 : 1)
      return rank(left) - rank(right) || (heightOfQuality(right.quality) ?? 0) - (heightOfQuality(left.quality) ?? 0)
    })
    .map((stream) => {
      const height = heightOfQuality(stream.quality)
      if (isHlsStream(stream)) return { src: stream.url, type: 'application/x-mpegurl' }
      // Width is synthesized as 16:9: only the height drives the quality menu
      // label, and the catalogue is overwhelmingly 16:9.
      return {
        src: stream.url,
        type: stream.is_audio ? undefined : 'video/mp4',
        width: height ? Math.round((height * 16) / 9) : undefined,
        height: height ?? undefined,
      }
    })
}

function trackDataType(url: string): string {
  const path = url.split('?')[0]?.toLowerCase() ?? ''
  if (path.endsWith('.srt')) return 'srt'
  if (path.endsWith('.ass') || path.endsWith('.ssa')) return 'ass'
  return 'vtt'
}

function matchesSavedSubtitle(language: string, label: string, preferences?: PlaybackPreferenceValues): boolean {
  const savedLanguage = preferences?.subtitleLanguage
  const savedLabel = preferences?.subtitleLabel
  if (!savedLanguage && !savedLabel) return false
  return (!savedLanguage || language === savedLanguage) && (!savedLabel || label === savedLabel)
}

function isExpiredHlsFailure(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const details = data as { response?: { code?: number } | null; details?: string }
  const status = details.response?.code
  // 410 is the current expired-capability status; 404 covers API versions
  // that reported dead media tokens as missing.
  return status === 401 || status === 403 || status === 404 || status === 410 || /(?:401|403|404|410)/.test(details.details ?? '')
}

function describeFailure(detail: unknown): { message: string; expired: boolean } {
  const record = (detail && typeof detail === 'object' ? detail : {}) as {
    message?: unknown
    code?: unknown
    status?: unknown
    response?: unknown
  }
  const message = typeof record.message === 'string' && record.message.length > 0 ? record.message : GENERIC_MESSAGE
  let response = ''
  try {
    response = JSON.stringify(record.response ?? null)
  } catch {
    response = ''
  }
  const haystack = [message, String(record.code ?? ''), String(record.status ?? ''), response].join(' ')
  return { message, expired: EXPIRED_STATUS_PATTERN.test(haystack) }
}

/**
 * Client-only playback console built on the Vidstack default video layout.
 *
 * Vidstack owns the media element, HLS loading (through the bundled hls.js
 * constructor, configured below), the transport chrome, quality/audio/caption
 * menus, gestures, and captions rendering. This component owns what Vidstack
 * cannot: the gateway-resolved multi-variant source list, declared external
 * subtitle tracks, the IndexedDB-backed resume checkpoint, throttled progress
 * persistence guarded by playback identity, and expired-ticket recovery
 * through the watch session.
 *
 * Built-in Vidstack storage is disabled (storage set to null): position,
 * quality, audio, and subtitle preferences live in the viewer's IndexedDB
 * records, so two persistence layers can never disagree about resume state.
 */
export function VidstackPlayer(props: WatchPlayerProps) {
  const [playerEl, setPlayerEl] = createSignal<MediaPlayerElement | undefined>()
  const [definesReady, setDefinesReady] = createSignal(false)
  const [sources, setSources] = createSignal<PlayerSource[]>([])
  const [tracks, setTracks] = createSignal<PlayerTrack[]>([])
  const [failure, setFailure] = createSignal<string | null>(null)
  const [recovering, setRecovering] = createSignal(false)
  const [playerNotice, setPlayerNotice] = createSignal<string | null>(null)
  const [copyState, setCopyState] = createSignal<'idle' | 'copied' | 'unavailable'>('idle')
  const [resumePrompt, setResumePrompt] = createSignal<number | null>(null)

  let hlsGeneration = 0
  let resumeDecisionIdentity: string | undefined
  let lastSubtitle: { language: string; label: string } | null = null
  let lastReportedPosition = 0
  let lastReportedDuration = 0
  let lastReportedAt = -Infinity
  let progressWrite: Promise<void> = Promise.resolve()
  let pendingProgress: { identity: PlaybackIdentity; position: number; duration: number } | null = null

  const identityKey = () => props.identity?.key ?? 'legacy-player'
  const clipboardAvailable = () => typeof navigator !== 'undefined' && Boolean(navigator.clipboard)

  const showFailure = (message: string) => {
    setRecovering(false)
    setFailure(message)
  }

  const persistPreferences = (next: PlaybackPreferenceValues) => {
    void Promise.resolve(props.onPreferencesChange?.(next)).catch((cause) => {
      console.error('Failed to persist playback preferences.', cause)
      setPlayerNotice('The playback preference could not be saved.')
    })
  }

  const reportProgress = (position: number, totalDuration: number) => {
    const identity = props.identity ?? { key: 'legacy-player', sourceId: '', episodeId: '', serverId: '' }
    const onProgress = props.onProgress
    if (!onProgress) return
    if (!Number.isFinite(position) || position < 0 || !Number.isFinite(totalDuration) || totalDuration <= 0) return
    lastReportedPosition = position
    lastReportedDuration = totalDuration
    lastReportedAt = Date.now()
    pendingProgress = { identity, position, duration: totalDuration }
    const write = async () => {
      const pending = pendingProgress
      pendingProgress = null
      if (!pending) return
      try {
        if (props.identity) await onProgress(pending.identity, pending.position, pending.duration)
        else await (onProgress as unknown as (position: number, duration: number) => Promise<void> | void)(pending.position, pending.duration)
      } catch (cause) {
        console.error('Failed to persist playback progress.', cause)
        pendingProgress = pending
        setPlayerNotice('Playback progress could not be saved. Keep this tab open and try again.')
      }
    }
    if (!props.identity) {
      void write()
      return
    }
    progressWrite = progressWrite.then(write)
  }

  const flushProgress = () => {
    const player = playerEl()
    if (!player) return
    const position = player.currentTime
    const totalDuration = player.duration
    if (!Number.isFinite(position) || position < 0 || !Number.isFinite(totalDuration) || totalDuration <= 0) return
    if (position === lastReportedPosition && totalDuration === lastReportedDuration) return
    reportProgress(position, totalDuration)
  }

  const reportThrottledProgress = () => {
    const player = playerEl()
    if (!player) return
    const position = player.currentTime
    const totalDuration = player.duration
    if (!Number.isFinite(position) || position < 0 || !Number.isFinite(totalDuration) || totalDuration <= 0) return
    if (Date.now() - lastReportedAt < 4000) return
    reportProgress(position, totalDuration)
  }

  const handleHlsError = (data: unknown) => {
    const details = (data && typeof data === 'object' ? data : {}) as {
      fatal?: unknown
      response?: { code?: number } | null
      details?: string
    }
    if (isExpiredHlsFailure(data)) {
      const identity = props.identity
      if (!identity) {
        showFailure(EXPIRED_MESSAGE)
        return
      }
      const handled = props.onMediaError?.(identity, EXPIRED_MESSAGE, true)
      if (handled) {
        // The session is re-resolving the server in the background; keep a
        // slim status visible instead of idling on a bare error.
        setFailure(null)
        setRecovering(true)
      } else {
        showFailure(EXPIRED_MESSAGE)
      }
      return
    }
    if (details.fatal !== true) return
    handleMediaFailure(data)
  }

  const handleMediaFailure = (detail: unknown) => {
    const identity = props.identity
    const { message, expired } = describeFailure(detail)
    if (!identity) {
      showFailure(message)
      return
    }
    if (expired) {
      const handled = props.onMediaError?.(identity, EXPIRED_MESSAGE, true)
      if (handled) {
        // The session is re-resolving the server in the background; keep a
        // slim status visible instead of idling on a bare error.
        setFailure(null)
        setRecovering(true)
      } else {
        showFailure(EXPIRED_MESSAGE)
      }
      return
    }
    showFailure(message)
    props.onMediaError?.(identity, message, false)
  }

  const syncDuration = () => {
    const player = playerEl()
    const media = player?.querySelector('video') as HTMLVideoElement | null
    if (!player || !media) return
    // The provider usually tracks duration from media events, but instant
    // metadata (tiny local responses, warm caches) can land before its
    // listeners attach, stranding the store at Infinity: a VOD badge turns
    // LIVE and seeking breaks. Reconciling with the true finite value is a
    // no-op once the provider has caught up.
    const mediaDuration = media.duration
    if (
      Number.isFinite(mediaDuration) &&
      mediaDuration > 0 &&
      player.duration !== mediaDuration
    ) {
      try {
        player.duration = mediaDuration
      } catch (cause) {
        console.error('Syncing the media duration failed.', cause)
      }
    }
  }

  const chooseResume = (position: number) => {
    const player = playerEl()
    if (player && definesReady()) {
      try {
        player.currentTime = position
      } catch (cause) {
        console.error('Seeking to the saved position failed.', cause)
      }
    }
    setResumePrompt(null)
  }

  const copyActiveStream = async () => {
    const url = sources()[0]?.src
    if (!url) return
    if (!clipboardAvailable()) {
      setCopyState('unavailable')
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      setCopyState('copied')
    } catch (cause) {
      console.error('Copying the stream link was blocked.', cause)
      setCopyState('unavailable')
    }
  }

  // Rebuilds the source list when the session resolves a new server. The
  // ordering snapshots the saved quality at resolve time; later preference
  // writes must not reorder the list, or the player would reload in a loop.
  createEffect(() => {
    const streams = props.streams
    const preferred = untrack(() => props.preferences?.quality ?? null)
    untrack(() => flushProgress())
    setSources(toPlayerSources(streams, preferred))
    setFailure(null)
    setRecovering(false)
    setResumePrompt(null)
  })

  // Applies the rebuilt list to the player once its custom elements exist.
  // Every Vidstack prop is assigned imperatively post-upgrade: Solid would set
  // camelCase JSX props as own properties on the un-upgraded element, where
  // they would shadow Vidstack's setters and be silently lost. Keyboard
  // shortcuts need no config: the defaults already cover Space/K/J/L/arrows/
  // M/F, and ignore keystrokes inside fields and menus.
  createEffect(() => {
    const player = playerEl()
    const list = sources()
    if (!player || !definesReady()) return
    untrack(() => {
      player.title = props.serverName ?? 'Video player'
      player.ariaLabel = props.serverName ? `${props.serverName} player` : 'Video player'
      player.playsInline = true
      player.storage = null
      player.controlsDelay = 3500
      player.fullscreenOrientation = 'landscape'
      // Buffer on mount like the session expects: the watch route only mounts
      // the player to play, so there is no reason to wait for visibility.
      player.load = 'eager'
      player.src = list as unknown as typeof player.src
    })
  })

  // Exposes external subtitles as declarative tracks. Vidstack fetches and
  // parses them itself (VTT, SRT, SSA/ASS natively), so no normalization
  // roundtrip or object URL is needed — and none would survive the document
  // connect-src policy anyway, which forbids blob: fetches. Same-origin
  // gateway tracks load directly; a cross-origin host outside the policy
  // fails closed as a track error, the same exposure any script fetch has.
  createEffect(() => {
    const streams = props.streams
    // Snapshot the saved languages once per payload (see the sources effect
    // for why): persisting a new choice must not rebuild the list, which
    // would drop the just-made selection.
    const preferences = untrack(() => props.preferences)
    const previous = untrack(() => lastSubtitle)

    const videos = streams.filter((stream) => !stream.is_audio)
    const pool = videos.length > 0 ? videos : streams
    const seen = new Set<string>()
    const resolved: PlayerTrack[] = []
    for (const stream of pool) {
      for (const subtitle of stream.subtitles) {
        if (seen.has(subtitle.url)) continue
        seen.add(subtitle.url)
        const label = subtitle.label || subtitle.language || 'Subtitle'
        resolved.push({
          key: subtitle.url,
          src: subtitle.url,
          label,
          language: subtitle.language,
          dataType: trackDataType(subtitle.url),
          isDefault: previous
            ? subtitle.language === previous.language && label === previous.label
            : matchesSavedSubtitle(subtitle.language, label, preferences),
        })
      }
    }
    // Native semantics allow a single default; the first match wins.
    let claimed = false
    setTracks(
      resolved.map((track) => {
        if (!track.isDefault || claimed) return { ...track, isDefault: false }
        claimed = true
        return track
      }),
    )
  })

  onMount(() => {
    let cancelled = false
    // Vidstack ships as custom elements: the defines ride a client-only chunk
    // so SSR and the shared bundle never execute player code. `definesReady`
    // flips on the canonical post-upgrade signal (`media-player-connect`),
    // with a frame-delayed backstop for already-upgraded elements — so the
    // imperative config always lands on Vidstack setters, never as shadowed
    // own props on the un-upgraded element.
    void Promise.all([import('vidstack/player'), import('vidstack/player/layouts/default'), import('vidstack/player/ui')])
      .then(() => {
        requestAnimationFrame(() => {
          if (!cancelled) setDefinesReady(true)
        })
      })
      .catch((cause) => {
        console.error('Failed to load the video player.', cause)
        showFailure('The video player could not be loaded. Check your connection and try again.')
      })

    const player = playerEl()
    const disposers: Array<() => void> = []
    const listen = (
      target: EventTarget | undefined,
      type: string,
      handler: (event: Event) => void,
      options?: AddEventListenerOptions,
    ) => {
      target?.addEventListener(type, handler, options)
      disposers.push(() => target?.removeEventListener(type, handler, options))
    }

    listen(player, 'media-player-connect', () => setDefinesReady(true))
    listen(player, 'can-play', () => {
      untrack(() => {
        const current = playerEl()
        if (!current) return
        setRecovering(false)
        syncDuration()
        const resumeAt = props.resumeAt ?? 0
        const duration = current.duration
        const savedPosition =
          resumeAt > 0 && Number.isFinite(resumeAt) && Number.isFinite(duration) && duration > 0
            ? Math.min(resumeAt, duration - 0.25)
            : 0
        const key = identityKey()
        // Saved progress is offered, never applied automatically.
        if (savedPosition > 5 && savedPosition < duration - 5 && key !== resumeDecisionIdentity) {
          resumeDecisionIdentity = key
          setResumePrompt(savedPosition)
        }
      })
    })
    listen(player, 'time-update', () => untrack(() => reportThrottledProgress()))
    listen(player, 'loaded-metadata', () => untrack(() => syncDuration()))
    listen(player, 'duration-change', () => untrack(() => syncDuration()))
    listen(player, 'pause', () => untrack(() => flushProgress()))
    listen(player, 'seeked', () => untrack(() => flushProgress()))
    listen(player, 'ended', () => untrack(() => {
      flushProgress()
      const onEnded = props.onEnded
      const identity = props.identity
      if (!onEnded) return
      const completed = identity
        ? onEnded(identity)
        : (onEnded as unknown as () => Promise<void> | void)()
      void Promise.resolve(completed).catch((cause) => {
        console.error('Failed to mark this episode complete.', cause)
        setPlayerNotice('This episode could not be marked complete. Keep this tab open and try again.')
      })
    }))
    listen(player, 'error', (event) => untrack(() => handleMediaFailure((event as CustomEvent).detail)))
    // Native media failures do not bubble and the provider consumes them
    // without re-dispatching, so catch them on the way down: the failing
    // video element carries its code on `.error`. Player-dispatched errors
    // target the player itself and keep the path above.
    listen(
      player,
      'error',
      (event) => {
        if ((event.target as Element | null)?.tagName !== 'VIDEO') return
        const mediaError = (event.target as HTMLVideoElement).error
        untrack(() =>
          handleMediaFailure(
            mediaError ? { message: mediaError.message || undefined, code: mediaError.code } : undefined,
          ),
        )
      },
      { capture: true },
    )
    // The raw hls.js path above reports provider failures first; no separate
    // DOM listener is needed here.
    listen(player, 'play-fail', () => {
      setPlayerNotice('This browser blocked playback. Open the stream in a new tab to watch it.')
    })
    listen(player, 'fullscreen-error', () => {
      setPlayerNotice('Fullscreen was blocked. Try using the browser’s fullscreen control.')
    })
    listen(player, 'provider-change', (event) => untrack(() => {
      const providerAdapter = (event as CustomEvent).detail as {
        library?: unknown
        config?: unknown
        onInstance?: (callback: (instance: Hls) => void) => void
      } | null
      // The bundled hls.js constructor keeps HLS loading same-origin and
      // version-pinned instead of reaching for Vidstack's CDN fallback.
      // capLevelToPlayerSize never spends the pipe on pixels the screen
      // cannot show; the deeper forward buffer rides out upstream stall
      // patches instead of rebuffering on the first slow segment.
      if (!providerAdapter || !isHLSProvider(providerAdapter)) return
      providerAdapter.library = Hls
      providerAdapter.config = { capLevelToPlayerSize: true, maxBufferLength: 60 }
      // Raw hls.js errors arrive per failed attempt, long before Vidstack
      // escalates the fatal one: expired gateway tickets (401/403/404/410)
      // route to silent session recovery from the first failure instead of
      // waiting out the library's retry backoff. Non-fatal errors stay with
      // hls.js, which recovers from them on its own.
      providerAdapter.onInstance?.((instance) => {
        const generation = ++hlsGeneration
        instance.on(Hls.Events.ERROR, (_event, data) => {
          // A superseded instance (newer server pick) must not report.
          if (generation !== hlsGeneration) return
          untrack(() => handleHlsError(data))
        })
      })
    }))
    listen(player, 'quality-change', (event) => untrack(() => {
      const quality = (event as CustomEvent).detail as { height?: unknown } | 'auto' | null
      const label = quality && typeof quality === 'object' && typeof quality.height === 'number' ? `${quality.height}p` : null
      persistPreferences({ ...(props.preferences ?? { quality: null, audioLanguage: null, audioLabel: null, subtitleLanguage: null, subtitleLabel: null }), quality: label })
    }))
    listen(player, 'audio-track-change', (event) => untrack(() => {
      const track = (event as CustomEvent).detail as { language?: unknown; label?: unknown; name?: unknown } | null
      const language = typeof track?.language === 'string' ? track.language : ''
      const name = typeof track?.label === 'string' && track.label ? track.label : typeof track?.name === 'string' ? track.name : ''
      persistPreferences({
        ...(props.preferences ?? { quality: null, audioLanguage: null, audioLabel: null, subtitleLanguage: null, subtitleLabel: null }),
        audioLanguage: language || null,
        audioLabel: name || null,
      })
    }))
    listen(player, 'text-track-change', (event) => untrack(() => {
      const track = (event as CustomEvent).detail as { language?: unknown; label?: unknown } | null
      const language = typeof track?.language === 'string' ? track.language : ''
      const label = typeof track?.label === 'string' ? track.label : ''
      lastSubtitle = track ? { language, label } : null
      persistPreferences({
        ...(props.preferences ?? { quality: null, audioLanguage: null, audioLabel: null, subtitleLanguage: null, subtitleLabel: null }),
        subtitleLanguage: language || null,
        subtitleLabel: label || null,
      })
    }))

    onCleanup(() => {
      for (const dispose of disposers) dispose()
      cancelled = true
      flushProgress()
    })
  })

  const formatRemaining = (position: number) => {
    const duration = playerEl()?.duration ?? 0
    return formatTime(Math.max(0, duration - position))
  }

  return (
    <section class="player anime-player overflow-hidden rounded-shell border border-black/20 bg-[#121217] shadow-[0_24px_60px_rgb(0_0_0/.22)]" aria-label={props.serverName ? `${props.serverName} player` : 'Video player'}>
      <media-player
        ref={(element) => setPlayerEl(element as unknown as MediaPlayerElement)}
        class="anime-stage block aspect-video w-full bg-black"
        aria-label={props.serverName ? `${props.serverName} player` : 'Video player'}
      >
        <media-provider>
          <For each={tracks()}>
            {(track) => (
              <track
                src={track.src}
                kind="subtitles"
                label={track.label}
                srclang={track.language}
                data-type={track.dataType}
                default={track.isDefault || undefined}
              />
            )}
          </For>
        </media-provider>
        <media-video-layout />
        <Show when={recovering() && !failure()}>
          <div class="anime-overlay grid place-items-center bg-black/45" role="status">
            <span class="anime-status-pill">
              <span class="player-spinner player-spinner-small" aria-hidden="true" />
              Refreshing stream…
            </span>
          </div>
        </Show>
        <Show when={resumePrompt() !== null}>
          <div class="anime-overlay grid place-items-center bg-black/72 p-5 text-center text-white backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="anime-resume-heading">
            <div class="max-w-sm">
              <p class="font-mono text-[9px] uppercase tracking-[.18em] text-white/60">Playback checkpoint</p>
              <h3 id="anime-resume-heading" class="mt-2 font-display text-4xl leading-none">Continue watching?</h3>
              <p class="mt-3 text-sm text-white/75">
                You have {formatRemaining(resumePrompt()!)} remaining from {formatTime(resumePrompt()!)}.
              </p>
              <div class="mt-5 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  class="min-h-11 border border-white bg-white px-4 py-2 font-mono text-[10px] uppercase tracking-[.1em] text-black transition hover:bg-transparent hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  onClick={() => chooseResume(resumePrompt()!)}
                >
                  Continue from {formatTime(resumePrompt()!)}
                </button>
                <button
                  type="button"
                  class="min-h-11 border border-white/45 px-4 py-2 font-mono text-[10px] uppercase tracking-[.1em] transition hover:border-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  onClick={() => setResumePrompt(null)}
                >
                  Start from beginning
                </button>
              </div>
            </div>
          </div>
        </Show>
        <Show when={failure()}>
          {(message) => (
            <div class="anime-overlay grid place-items-center overflow-y-auto bg-black/55 p-5" role="alert">
              <div class="w-full max-w-md rounded-2xl border border-red-400/30 bg-red-950/85 p-5 text-sm text-red-100 shadow-2xl backdrop-blur-md">
                <p class="font-mono text-[9px] uppercase tracking-[.16em] text-red-200/70">Stream interruption</p>
                <p class="mt-1">{message()}</p>
                <div class="mt-3 flex flex-wrap gap-2">
                  <Show when={props.onRetry}>
                    <button
                      type="button"
                      class="min-h-11 border border-red-100/50 px-3 py-2 font-mono text-[9px] uppercase tracking-[.08em] transition hover:bg-white hover:text-black disabled:opacity-50"
                      disabled={recovering()}
                      onClick={() => {
                        setFailure(null)
                        setRecovering(true)
                        void Promise.resolve(props.onRetry?.()).catch((cause) => {
                          console.error('Retrying the stream failed.', cause)
                          showFailure('Retrying the stream failed. Try another server, or open the stream directly.')
                        })
                      }}
                    >
                      Retry stream
                    </button>
                  </Show>
                  <Show when={clipboardAvailable()}>
                    <button
                      type="button"
                      class="min-h-11 border border-red-100/50 px-3 py-2 font-mono text-[9px] uppercase tracking-[.08em] transition hover:bg-white hover:text-black"
                      onClick={() => {
                        void copyActiveStream()
                      }}
                    >
                      {copyState() === 'copied' ? 'Link copied' : 'Copy stream link'}
                    </button>
                  </Show>
                </div>
                <Show when={!clipboardAvailable() || copyState() === 'unavailable'}>
                  <label class="mt-3 block">
                    <span class="font-mono text-[9px] uppercase tracking-[.08em] text-white/55">Stream link</span>
                    <input class="mt-1 h-9 w-full border border-white/20 bg-black/40 px-2 text-xs text-white" type="text" readonly value={sources()[0]?.src || ''} />
                  </label>
                </Show>
              </div>
            </div>
          )}
        </Show>
        <Show when={playerNotice()}>
          {(message) => <p class="anime-notice" role="status">{message()}</p>}
        </Show>
      </media-player>
    </section>
  )
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = (total % 60).toString().padStart(2, '0')
  if (hours > 0) return `${hours}:${minutes.toString().padStart(2, '0')}:${secs}`
  return `${minutes}:${secs}`
}
