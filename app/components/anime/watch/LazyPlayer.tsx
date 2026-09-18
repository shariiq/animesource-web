import { createEffect, createSignal, For, onCleanup, onMount, Show, untrack } from 'solid-js'
import type Hls from 'hls.js'
import type { Stream } from '../../../data/anisource/schema'
import { loadSubtitle, resolveUrl } from '../../../data/anisource/client'

type PlayerStatus = 'connecting' | 'buffering' | 'ready' | 'reconnecting' | 'error'

/**
 * A subtitle the viewer can turn on. External tracks come from the AniSource
 * stream payload as `<track>` elements; HLS tracks are declared by the manifest
 * and have to be switched through hls.js so their segments get fetched.
 */
type SubtitleOption =
  | { kind: 'external'; label: string; language: string; track: TextTrack }
  | { kind: 'hls'; label: string; language: string; id: number }

/**
 * Headers the browser refuses to let script set on a request. AniSource's proxy
 * applies the upstream ones itself, so the safe subset is usually empty —
 * forwarding the rest anyway would only produce console noise.
 */
const FORBIDDEN_HEADER =
  /^(accept-(charset|encoding)|access-control-request-|connection|content-length|cookie|date|dnt|expect|host|keep-alive|origin|permissions-policy|proxy-|referer|sec-|te|trailer|transfer-encoding|upgrade|user-agent|via)/i

type VideoWithNativeFullscreen = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void
  webkitExitFullscreen?: () => void
}

function browserSafeHeaders(headers: Record<string, string>): [string, string][] {
  return Object.entries(headers).filter(([name]) => !FORBIDDEN_HEADER.test(name))
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

/**
 * Client-only playback console.
 *
 * hls.js is the primary implementation for every HLS stream it supports — the
 * same decision the working prototype makes. Native HLS is only used when
 * hls.js cannot run, because Chromium's `canPlayType` claims HLS support it
 * does not actually deliver for these proxied playlists.
 */
export function LazyPlayer(props: {
  streams: Stream[]
  serverName?: string
  resumeAt?: number
  onProgress?: (position: number, duration: number) => Promise<void> | void
  onEnded?: () => Promise<void> | void
}) {
  const [video, setVideo] = createSignal<HTMLVideoElement>()
  const [activeIndex, setActiveIndex] = createSignal(0)
  const [failure, setFailure] = createSignal<string | null>(null)
  const [status, setStatus] = createSignal<PlayerStatus>('connecting')
  const [playing, setPlaying] = createSignal(false)
  const [currentTime, setCurrentTime] = createSignal(0)
  const [duration, setDuration] = createSignal(0)
  const [bufferedTo, setBufferedTo] = createSignal(0)
  const [muted, setMuted] = createSignal(false)
  const [volume, setVolume] = createSignal(1)
  const [fullscreen, setFullscreen] = createSignal(false)
  const [fullscreenAvailable, setFullscreenAvailable] = createSignal(false)
  const [subtitleOptions, setSubtitleOptions] = createSignal<SubtitleOption[]>([])
  const [subtitleIndex, setSubtitleIndex] = createSignal(-1)
  const [subtitleFailure, setSubtitleFailure] = createSignal<string | null>(null)
  const [playerNotice, setPlayerNotice] = createSignal<string | null>(null)
  const [copyState, setCopyState] = createSignal<'idle' | 'copied' | 'unavailable'>('idle')

  let hls: Hls | null = null
  let trackElements: HTMLTrackElement[] = []
  let subtitleObjectUrls: string[] = []
  let loadGeneration = 0
  let initialResumeUsed = false
  let mediaReady = false
  let removeRestoreListener: (() => void) | undefined
  let lastReportedPosition = 0
  let lastReportedDuration = 0
  let lastReportedAt = -Infinity
  let networkRecoveryUsed = false
  let mediaRecoveryUsed = false

  const activeStream = () => props.streams[activeIndex()]
  const streamUrl = (stream: Stream) => resolveUrl(stream.url) ?? stream.url
  const clipboardAvailable = () => typeof navigator !== 'undefined' && Boolean(navigator.clipboard)

  const destroyHls = () => {
    hls?.destroy()
    hls = null
  }

  /**
   * Imperative: called from media/HLS event handlers, never as a reactive
   * derivation, so the signal reads here are deliberately untracked.
   */
  const applySubtitleSelection = (index = subtitleIndex(), options = subtitleOptions()) => {
    const selected = options[index]
    for (const option of options) {
      if (option.kind === 'external') option.track.mode = option === selected ? 'showing' : 'disabled'
    }
    if (hls) {
      hls.subtitleDisplay = selected?.kind === 'hls'
      hls.subtitleTrack = selected?.kind === 'hls' ? selected.id : -1
    }
  }

  /**
   * Rebuilds the external `<track>` elements for a stream and keeps the
   * viewer's chosen language selected across quality switches when the new
   * variant offers it.
   */
  const mountExternalSubtitles = (element: HTMLVideoElement, stream: Stream, generation: number) => {
    const previous = untrack(() => subtitleOptions()[subtitleIndex()])
    for (const track of trackElements) track.remove()
    trackElements = []
    for (const url of subtitleObjectUrls) URL.revokeObjectURL(url)
    subtitleObjectUrls = []
    setSubtitleOptions([])
    setSubtitleIndex(-1)
    setSubtitleFailure(null)

    const options: SubtitleOption[] = []
    const register = (trackElement: HTMLTrackElement, language: string) => {
      if (generation !== loadGeneration || !trackElement.track) return
      const option: SubtitleOption = {
        kind: 'external',
        label: trackElement.label,
        language,
        track: trackElement.track,
      }
      if (options.some((current) => current.kind === 'external' && current.track === option.track)) return
      option.track.mode = 'disabled'
      options.push(option)
      const restored = previous
        ? options.findIndex((current) => current.label === previous.label && current.language === previous.language)
        : -1
      const nextIndex = restored >= 0 ? restored : -1
      setSubtitleOptions([...options])
      setSubtitleIndex(nextIndex)
      applySubtitleSelection(nextIndex, options)
    }

    for (const subtitle of stream.subtitles) {
      const trackElement = document.createElement('track')
      trackElement.kind = 'subtitles'
      trackElement.src = resolveUrl(subtitle.url) ?? subtitle.url
      trackElement.label = subtitle.label || subtitle.language || 'Subtitle'
      if (subtitle.language) trackElement.srclang = subtitle.language
      element.appendChild(trackElement)
      trackElements.push(trackElement)
      register(trackElement, subtitle.language)
      void loadSubtitle(subtitle.url)
        // eslint-disable-next-line solid/reactivity -- subtitle fetch completion is guarded by the stream generation.
        .then((captionText) => {
          if (generation !== loadGeneration) return
          const objectUrl = URL.createObjectURL(new Blob([captionText], { type: 'text/vtt' }))
          subtitleObjectUrls.push(objectUrl)
          trackElement.src = objectUrl
          trackElement.track.mode = 'disabled'
          applySubtitleSelection(subtitleIndex(), subtitleOptions())
        })
        .catch(() => {
          // Keep the direct URL as a fallback: some subtitle hosts allow native
          // track loading even when script fetches are blocked by CORS.
          if (generation === loadGeneration) setSubtitleFailure('One subtitle language could not be normalized; native captions may still be available.')
        })
    }
  }

  const syncBuffered = (element: HTMLVideoElement) => {
    const ranges = element.buffered
    let end = 0
    for (let index = 0; index < ranges.length; index += 1) {
      if (ranges.start(index) <= element.currentTime && ranges.end(index) > end) end = ranges.end(index)
    }
    setBufferedTo(end)
  }

  const showFailure = (message: string) => {
    setStatus('error')
    setFailure(message)
  }

  const reportProgress = (position: number, totalDuration: number) => {
    const onProgress = props.onProgress
    if (!onProgress) return
    if (!Number.isFinite(position) || position < 0 || !Number.isFinite(totalDuration) || totalDuration <= 0) return
    lastReportedPosition = position
    lastReportedDuration = totalDuration
    lastReportedAt = Date.now()
    void Promise.resolve(onProgress(position, totalDuration)).catch((cause) => {
      console.error('Failed to persist playback progress.', cause)
      setPlayerNotice('Playback progress could not be saved. Keep this tab open and try again.')
    })
  }

  const flushProgress = () => {
    const element = video()
    if (!element || !mediaReady) return
    const position = element.currentTime
    const totalDuration = element.duration
    if (!Number.isFinite(position) || position < 0 || !Number.isFinite(totalDuration) || totalDuration <= 0) return
    if (position === lastReportedPosition && totalDuration === lastReportedDuration) return
    reportProgress(position, totalDuration)
  }

  const reportThrottledProgress = (element: HTMLVideoElement) => {
    const position = element.currentTime
    const totalDuration = element.duration
    if (!Number.isFinite(position) || position < 0 || !Number.isFinite(totalDuration) || totalDuration <= 0) return
    if (Date.now() - lastReportedAt < 4000) return
    reportProgress(position, totalDuration)
  }

  const loadStream = async (index: number, resumeAt = 0, resumePlayback = false) => {
    const stream = props.streams[index]
    const element = video()
    if (!stream || !element) return

    const generation = ++loadGeneration
    setActiveIndex(index)
    setFailure(null)
    setStatus('connecting')
    setCurrentTime(0)
    setDuration(0)
    setBufferedTo(0)
    mediaReady = false
    networkRecoveryUsed = false
    mediaRecoveryUsed = false
    removeRestoreListener?.()
    removeRestoreListener = undefined
    destroyHls()
    element.removeAttribute('src')
    element.load()
    mountExternalSubtitles(element, stream, generation)

    const url = streamUrl(stream)
    const restore = () => {
      if (generation !== loadGeneration) return
      mediaReady = true
      if (resumeAt > 0 && Number.isFinite(resumeAt)) {
        const total = element.duration
        element.currentTime = Number.isFinite(total) && total > 0 ? Math.min(resumeAt, total - 0.25) : resumeAt
      }
      applySubtitleSelection()
      if (resumePlayback) void element.play().catch(() => setPlaying(false))
    }

    // eslint-disable-next-line solid/reactivity -- cleanup captures this stream's native listener.
    removeRestoreListener = () => element.removeEventListener('loadedmetadata', restore)
    element.addEventListener('loadedmetadata', restore, { once: true })

    const playNatively = () => {
      element.src = url
    }

    if (!(stream.is_hls || url.toLowerCase().includes('.m3u8'))) {
      playNatively()
      return
    }

    try {
      const { default: HlsClass } = await import('hls.js')
      // A newer stream (or an unmounted player) may have superseded this load
      // while the chunk was in flight; its instance must not attach.
      if (generation !== loadGeneration || video() !== element) return

      if (!HlsClass.isSupported()) {
        if (element.canPlayType('application/vnd.apple.mpegurl')) {
          playNatively()
          return
        }
        showFailure('This browser cannot play HLS streams. Open the stream in a player like VLC or mpv instead.')
        return
      }

      const safeHeaders = browserSafeHeaders(stream.headers)
      const instance = new HlsClass({
        xhrSetup: (xhr) => {
          for (const [name, value] of safeHeaders) xhr.setRequestHeader(name, value)
        },
      })
      hls = instance

      // eslint-disable-next-line solid/reactivity -- hls.js owns this imperative media lifecycle.
      instance.on(HlsClass.Events.SUBTITLE_TRACKS_UPDATED, () => {
        if (generation !== loadGeneration) return
        const manifestTracks: SubtitleOption[] = instance.subtitleTracks.map((track) => ({
          kind: 'hls',
          label: track.name || track.lang || 'Subtitle',
          language: track.lang ?? '',
          id: track.id,
        }))
        setSubtitleOptions((current) => {
          const options = [...current.filter((option) => option.kind === 'external'), ...manifestTracks]
          applySubtitleSelection(subtitleIndex(), options)
          return options
        })
      })
      instance.on(HlsClass.Events.ERROR, (_event, data) => {
        if (generation !== loadGeneration || !data.fatal) return
        if (data.type === HlsClass.ErrorTypes.NETWORK_ERROR && !networkRecoveryUsed) {
          networkRecoveryUsed = true
          setStatus('reconnecting')
          instance.startLoad()
          return
        }
        if (data.type === HlsClass.ErrorTypes.MEDIA_ERROR && !mediaRecoveryUsed) {
          mediaRecoveryUsed = true
          setStatus('reconnecting')
          instance.recoverMediaError()
          return
        }
        showFailure('This stream could not be played. Try another server, or open the stream directly.')
      })

      instance.loadSource(url)
      instance.attachMedia(element)
    } catch (cause) {
      console.error('Failed to load the HLS player module.', cause)
      showFailure('The video player could not be loaded. Check your connection and try again.')
    }
  }

  // Progress changes must never retrigger stream loading.
  createEffect(() => {
    const streams = props.streams
    const element = video()
    if (element && streams.length > 0) untrack(() => {
      flushProgress()
      const resume = initialResumeUsed ? element.currentTime : (props.resumeAt ?? 0)
      initialResumeUsed = true
      void loadStream(0, resume)
    })
  })

  onMount(() => {
    const element = video()
    const nativeVideo = element as VideoWithNativeFullscreen | undefined
    setFullscreenAvailable(Boolean(element?.requestFullscreen || nativeVideo?.webkitEnterFullscreen))
    const syncFullscreen = () => setFullscreen(document.fullscreenElement === element?.closest('.player'))
    const syncNativeFullscreen = () => setFullscreen(true)
    const syncNativeExit = () => setFullscreen(false)
    document.addEventListener('fullscreenchange', syncFullscreen)
    element?.addEventListener('webkitbeginfullscreen', syncNativeFullscreen)
    element?.addEventListener('webkitendfullscreen', syncNativeExit)
    onCleanup(() => {
      document.removeEventListener('fullscreenchange', syncFullscreen)
      element?.removeEventListener('webkitbeginfullscreen', syncNativeFullscreen)
      element?.removeEventListener('webkitendfullscreen', syncNativeExit)
    })
  })

  onCleanup(() => {
    flushProgress()
    loadGeneration += 1
    removeRestoreListener?.()
    removeRestoreListener = undefined
    destroyHls()
    for (const url of subtitleObjectUrls) URL.revokeObjectURL(url)
    subtitleObjectUrls = []
  })

  const togglePlayback = async () => {
    const element = video()
    if (!element) return
    if (!element.paused) {
      element.pause()
      return
    }
    try {
      await element.play()
    } catch (cause) {
      console.error('Video playback was blocked.', cause)
      showFailure('This browser blocked playback. Open the stream in a new tab to watch it.')
    }
  }

  const changeQuality = (index: number) => {
    flushProgress()
    const element = video()
    void loadStream(index, element?.currentTime ?? 0, Boolean(element && !element.paused))
  }

  const changeSubtitle = (index: number) => {
    setSubtitleIndex(index)
    applySubtitleSelection(index, subtitleOptions())
  }

  const seekTo = (value: string) => {
    const element = video()
    const next = Number(value)
    if (element && Number.isFinite(next)) {
      element.currentTime = next
      setCurrentTime(next)
    }
  }

  const changeVolume = (value: string) => {
    const element = video()
    const next = Number(value)
    if (!element || !Number.isFinite(next)) return
    element.volume = next
    element.muted = next === 0
  }

  const toggleMute = () => {
    const element = video()
    if (!element) return
    if (element.muted && element.volume === 0) element.volume = 1
    element.muted = !element.muted
  }

  const toggleFullscreen = async () => {
    const element = video()
    const stage = element?.closest('.player')
    if (!element || !stage) return
    const nativeVideo = element as VideoWithNativeFullscreen
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
        return
      }
      if (stage.requestFullscreen) {
        await stage.requestFullscreen()
        return
      }
      if (nativeVideo.webkitEnterFullscreen) {
        nativeVideo.webkitEnterFullscreen()
        return
      }
      setFullscreenAvailable(false)
      setPlayerNotice('Fullscreen is unavailable in this browser.')
    } catch (cause) {
      console.error('Fullscreen was refused by the browser.', cause)
      setPlayerNotice('Fullscreen was blocked. Try using the browser’s fullscreen control.')
    }
  }

  const copyActiveStream = async () => {
    const stream = activeStream()
    if (!stream) return
    if (!clipboardAvailable()) {
      setCopyState('unavailable')
      return
    }
    try {
      await navigator.clipboard.writeText(streamUrl(stream))
      setCopyState('copied')
    } catch (cause) {
      console.error('Copying the stream link was blocked.', cause)
      setCopyState('unavailable')
    }
  }

  const playedPercent = () => (duration() > 0 ? (currentTime() / duration()) * 100 : 0)
  const bufferedPercent = () => (duration() > 0 ? (bufferedTo() / duration()) * 100 : 0)
  const busy = () => status() === 'connecting' || status() === 'buffering' || status() === 'reconnecting'
  const busyLabel = () =>
    status() === 'reconnecting'
      ? 'Reconnecting to the stream…'
      : status() === 'buffering'
        ? 'Buffering…'
        : 'Connecting to the stream…'

  return (
    <Show when={props.streams.length > 0}>
      <section class="player overflow-hidden rounded-shell border border-black/20 bg-[#121217] shadow-[0_24px_60px_rgb(0_0_0/.22)]" aria-labelledby="player-title">
        <h2 id="player-title" class="sr-only">{props.serverName ? `${props.serverName} player` : 'Video player'}</h2>
        <div class="relative aspect-video bg-black">
          <video
            class="size-full cursor-pointer bg-black object-contain"
            playsinline
            ref={setVideo}
            onClick={() => { void togglePlayback() }}
            onCanPlay={() => setStatus('ready')}
            onPlaying={() => setStatus('ready')}
            onWaiting={() => setStatus((current) => (current === 'ready' ? 'buffering' : current))}
            onPlay={() => setPlaying(true)}
            onPause={() => {
              setPlaying(false)
              flushProgress()
            }}
            onEnded={() => {
              flushProgress()
              const onEnded = props.onEnded
              if (!onEnded) return
              void Promise.resolve(onEnded()).catch((cause) => {
                console.error('Failed to mark this episode complete.', cause)
                setPlayerNotice('This episode could not be marked complete. Keep this tab open and try again.')
              })
            }}
            onTimeUpdate={(event) => {
              setCurrentTime(event.currentTarget.currentTime)
              syncBuffered(event.currentTarget)
              reportThrottledProgress(event.currentTarget)
            }}
            onProgress={(event) => syncBuffered(event.currentTarget)}
            onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
            onDurationChange={(event) => setDuration(event.currentTarget.duration)}
            onVolumeChange={(event) => {
              setMuted(event.currentTarget.muted)
              setVolume(event.currentTarget.volume)
            }}
            onError={() => showFailure('This stream could not be played. Try another server, or open the stream directly.')}
          />
          <Show when={busy() && !failure()}>
            <div class="absolute inset-0 grid place-items-center gap-2 bg-black/55 font-mono text-[10px] uppercase tracking-[.12em] text-white" role="status">
              <span class="size-5 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden="true" />
              <span>{busyLabel()}</span>
            </div>
          </Show>
        </div>

        <div class="border-t border-white/10 bg-[#0b0b0f] p-3 text-white sm:p-4">
          <div class="flex items-center gap-2">
            <span class="w-12 shrink-0 text-right font-mono text-[10px] tabular-nums text-white/60">{formatTime(currentTime())}</span>
            <label class="sr-only" for="player-seek">Playback position</label>
            <input
              id="player-seek"
              class="h-1 min-w-0 flex-1 accent-white"
              type="range"
              min="0"
              max={Number.isFinite(duration()) && duration() > 0 ? duration() : 0}
              step="0.1"
              value={currentTime()}
              style={{ '--played': `${playedPercent()}%`, '--buffered': `${bufferedPercent()}%` }}
              onInput={(event) => seekTo(event.currentTarget.value)}
            />
            <span class="w-12 shrink-0 font-mono text-[10px] tabular-nums text-white/60">{formatTime(duration())}</span>
          </div>

          <div class="mt-2 flex items-center gap-2">
            <button
              type="button"
              class="grid size-9 place-items-center rounded-[9px] border border-white bg-white text-black transition hover:bg-transparent hover:text-white"
              aria-label={playing() ? 'Pause' : 'Play'}
              onClick={() => { void togglePlayback() }}
            >
              <Show when={playing()} fallback={<PlayIcon />}><PauseIcon /></Show>
            </button>

            <div class="flex items-center gap-2">
              <button
                type="button"
                class="grid size-9 place-items-center rounded-[9px] border border-white/25 transition hover:border-white"
                aria-label={muted() || volume() === 0 ? 'Unmute' : 'Mute'}
                aria-pressed={muted() || volume() === 0}
                onClick={toggleMute}
              >
                <Show when={muted() || volume() === 0} fallback={<VolumeIcon />}><MuteIcon /></Show>
              </button>
              <label class="sr-only" for="player-volume-range">Volume</label>
              <input
                id="player-volume-range"
                class="w-16 accent-white"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={muted() ? 0 : volume()}
                style={{ '--played': `${(muted() ? 0 : volume()) * 100}%` }}
                onInput={(event) => changeVolume(event.currentTarget.value)}
              />
            </div>

            <span class="flex-1" />

            <Show when={props.streams.length > 1}>
              <label class="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.08em] text-white/55">
                <span>Quality</span>
                <select class="border border-white/20 bg-transparent px-2 py-1 text-white" value={activeIndex()} onChange={(event) => changeQuality(Number(event.currentTarget.value))}>
                  <For each={props.streams}>
                    {(stream, index) => <option value={index()}>{stream.quality || `Variant ${index() + 1}`}</option>}
                  </For>
                </select>
              </label>
            </Show>

            <Show when={subtitleOptions().length > 0}>
              <label class="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.08em] text-white/55">
                <span>Subtitles</span>
                <select class="border border-white/20 bg-transparent px-2 py-1 text-white" value={subtitleIndex()} onChange={(event) => changeSubtitle(Number(event.currentTarget.value))}>
                  <option value="-1">Off</option>
                  <For each={subtitleOptions()}>
                    {(option, index) => <option value={index()}>{option.label}</option>}
                  </For>
                </select>
              </label>
            </Show>

            <Show when={fullscreenAvailable()}>
              <button
                type="button"
                class="grid size-9 place-items-center rounded-[9px] border border-white/25 transition hover:border-white"
                aria-label={fullscreen() ? 'Exit fullscreen' : 'Enter fullscreen'}
                aria-pressed={fullscreen()}
                onClick={() => { void toggleFullscreen() }}
              >
                <Show when={fullscreen()} fallback={<ExpandIcon />}><CollapseIcon /></Show>
              </button>
            </Show>
          </div>
        </div>

        <Show when={subtitleFailure()}>
          {(message) => <p class="border-t border-white/10 px-4 py-2 font-mono text-[9px] uppercase tracking-[.08em] text-white/60" role="status">{message()}</p>}
        </Show>
        <Show when={playerNotice()}>
          {(message) => <p class="border-t border-white/10 px-4 py-2 font-mono text-[9px] uppercase tracking-[.08em] text-white/60" role="status">{message()}</p>}
        </Show>
        <Show when={failure()}>
          {(message) => (
            <div class="border-t border-red-400/30 bg-red-950/40 p-4 text-sm text-red-100" role="alert">
              <p>{message()}</p>
              <div class="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  class="border border-red-100/50 px-3 py-2 font-mono text-[9px] uppercase tracking-[.08em] transition hover:bg-white hover:text-black"
                  onClick={() => {
                    const stream = activeStream()
                    if (stream) window.open(streamUrl(stream), '_blank', 'noopener')
                  }}
                >
                  Open stream in a new tab
                </button>
                <Show when={clipboardAvailable()}>
                  <button type="button" class="border border-red-100/50 px-3 py-2 font-mono text-[9px] uppercase tracking-[.08em] transition hover:bg-white hover:text-black" onClick={() => { void copyActiveStream() }}>
                    {copyState() === 'copied' ? 'Link copied' : 'Copy link for VLC / mpv'}
                  </button>
                </Show>
              </div>
              <Show when={!clipboardAvailable() || copyState() === 'unavailable'}>
                <label class="mt-3 block">
                  <span class="font-mono text-[9px] uppercase tracking-[.08em] text-white/55">Stream link</span>
                  <input class="mt-1 h-9 w-full border border-white/20 bg-black/40 px-2 text-xs text-white" type="text" readonly value={activeStream() ? streamUrl(activeStream()!) : ''} />
                </label>
              </Show>
            </div>
          )}
        </Show>
      </section>
    </Show>
  )
}

const icon = { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' } as const

function PlayIcon() {
  return <svg {...icon}><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>
}
function PauseIcon() {
  return <svg {...icon}><path d="M7 5h3.5v14H7zm6.5 0H17v14h-3.5z" fill="currentColor" /></svg>
}
function VolumeIcon() {
  return (
    <svg {...icon}>
      <path d="M4 9.5h3L11.5 6v12L7 14.5H4z" fill="currentColor" />
      <path d="M15 9a4 4 0 0 1 0 6M17.5 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
    </svg>
  )
}
function MuteIcon() {
  return (
    <svg {...icon}>
      <path d="M4 9.5h3L11.5 6v12L7 14.5H4z" fill="currentColor" />
      <path d="M15 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
    </svg>
  )
}
function ExpandIcon() {
  return (
    <svg {...icon}>
      <path d="M4 9V4h5M20 15v5h-5M15 4h5v5M9 20H4v-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    </svg>
  )
}
function CollapseIcon() {
  return (
    <svg {...icon}>
      <path d="M9 4v5H4m11 11v-5h5M20 9h-5V4M4 15h5v5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    </svg>
  )
}
