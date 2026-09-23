import { createEffect, createSignal, For, onCleanup, onMount, Show, untrack } from 'solid-js'
import type Hls from 'hls.js'
import type { Stream } from '../../../data/anisource/schema'
import type { PlaybackPreferenceValues } from '../../../lib/persistence/viewer'
import type { PlaybackIdentity } from './createWatchSession'
import { loadSubtitle } from '../../../data/anisource/client'

type PlayerStatus = 'connecting' | 'buffering' | 'ready' | 'reconnecting' | 'error'

type HlsQualityOption = { id: number; label: string }
type HlsAudioOption = { id: number; label: string; language: string; name: string }

/**
 * A subtitle the viewer can turn on. External tracks come from the AniSource
 * stream payload as `<track>` elements; HLS tracks are declared by the manifest
 * and have to be switched through hls.js so their segments get fetched.
 */
type SubtitleOption =
  | { kind: 'external'; label: string; language: string; track: TextTrack }
  | { kind: 'hls'; label: string; language: string; id: number }

type VideoWithNativeFullscreen = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void
  webkitExitFullscreen?: () => void
}

type HlsErrorDetails = {
  response?: { code?: number } | null
  details?: string
}

function isExpiredStreamFailure(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const details = data as HlsErrorDetails
  const status = details.response?.code
  return status === 401 || status === 403 || status === 410 || /(?:401|403|410)/.test(details.details ?? '')
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
  identity?: PlaybackIdentity
  serverName?: string
  resumeAt?: number
  preferences?: PlaybackPreferenceValues
  onPreferencesChange?: (preferences: PlaybackPreferenceValues) => Promise<void> | void
  onProgress?: (identity: PlaybackIdentity, position: number, duration: number) => Promise<void> | void
  onEnded?: (identity: PlaybackIdentity) => Promise<void> | void
  onMediaError?: (identity: PlaybackIdentity, message: string, expired?: boolean) => void
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
  const [resumePrompt, setResumePrompt] = createSignal<number | null>(null)
  const [qualityLevels, setQualityLevels] = createSignal<HlsQualityOption[]>([])
  const [qualityLevel, setQualityLevel] = createSignal(-1)
  const [audioTracks, setAudioTracks] = createSignal<HlsAudioOption[]>([])
  const [audioTrack, setAudioTrack] = createSignal(-1)

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
  let progressWrite: Promise<void> = Promise.resolve()
  let pendingProgress: { identity: PlaybackIdentity; position: number; duration: number } | null = null
  let resumeDecisionIdentity: string | undefined

  const activeStream = () => props.streams[activeIndex()]
  const streamUrl = (stream: Stream) => stream.url
  const streamOptions = () => {
    const options = props.streams.map((stream, index) => ({ stream, index }))
    return options.some(({ stream }) => !stream.is_audio) ? options.filter(({ stream }) => !stream.is_audio) : options
  }
  const streamLabel = (stream: Stream) => stream.is_audio ? `Audio · ${stream.quality}` : stream.quality || 'Variant'
  const qualityLabel = (level: { name?: string; height?: number; bitrate?: number }, index: number) =>
    level.name?.trim() || (level.height ? `${level.height}p` : level.bitrate ? `${Math.round(level.bitrate / 1000)} kbps` : `Variant ${index + 1}`)
  const audioLabel = (track: { name?: string; lang?: string }, index: number) => {
    const name = track.name?.trim() ?? ''
    const language = track.lang?.trim() ?? ''
    if (name && language && name.toLowerCase() !== language.toLowerCase()) return `${name} · ${language}`
    return name || language || `Audio ${index + 1}`
  }
  const resetHlsOptions = () => {
    setQualityLevels([])
    setQualityLevel(-1)
    setAudioTracks([])
    setAudioTrack(-1)
  }
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

  const matchesSavedSubtitle = (option: SubtitleOption): boolean => {
    const language = props.preferences?.subtitleLanguage
    const label = props.preferences?.subtitleLabel
    if (!language && !label) return false
    return (!language || option.language === language) && (!label || option.label === label)
  }

  const restoredSubtitleIndex = (
    options: SubtitleOption[],
    previous: SubtitleOption | undefined,
  ): number => {
    if (previous) {
      const previousIndex = options.findIndex(
        (option) => option.language === previous.language && option.label === previous.label,
      )
      if (previousIndex >= 0) return previousIndex
    }
    return options.findIndex(matchesSavedSubtitle)
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
      const nextIndex = restoredSubtitleIndex(options, previous)
      setSubtitleOptions([...options])
      setSubtitleIndex(nextIndex)
      applySubtitleSelection(nextIndex, options)
    }

    for (const subtitle of stream.subtitles) {
      const trackElement = document.createElement('track')
      trackElement.kind = 'subtitles'
      const hasProviderHeaders = Object.keys(stream.headers).some((name) => /^(?:origin|referer)$/i.test(name))
      if (!hasProviderHeaders) trackElement.src = subtitle.url
      trackElement.label = subtitle.label || subtitle.language || 'Subtitle'
      if (subtitle.language) trackElement.srclang = subtitle.language
      element.appendChild(trackElement)
      trackElements.push(trackElement)
      register(trackElement, subtitle.language)
      void loadSubtitle(subtitle.url)
        .then((captionText) => {
          if (generation !== loadGeneration) return
          const objectUrl = URL.createObjectURL(new Blob([captionText], { type: 'text/vtt' }))
          subtitleObjectUrls.push(objectUrl)
          trackElement.src = objectUrl
          trackElement.track.mode = 'disabled'
          untrack(() => applySubtitleSelection(subtitleIndex(), subtitleOptions()))
        })
        .catch(() => {
          // Keep the direct URL as a fallback: some subtitle hosts allow native
          // track loading even when script fetches are blocked by CORS.
          if (generation === loadGeneration) {
            trackElement.src = subtitle.url
            setSubtitleFailure('One subtitle language could not be normalized; native captions may still be available.')
          }
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
      }
      catch (cause) { console.error('Failed to persist playback progress.', cause); pendingProgress = pending; setPlayerNotice('Playback progress could not be saved. Keep this tab open and try again.') }
    }
    if (!props.identity) { void write(); return }
    progressWrite = progressWrite.then(write)
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
    resetHlsOptions()
    element.removeAttribute('src')
    element.load()
    mountExternalSubtitles(element, stream, generation)

    const url = streamUrl(stream)
    const restore = () => {
      if (generation !== loadGeneration) return
      mediaReady = true
      const savedPosition = resumeAt > 0 && Number.isFinite(resumeAt) ? Math.min(resumeAt, element.duration - 0.25) : 0
      const identityKey = props.identity?.key ?? 'legacy-player'
      if (savedPosition > 5 && savedPosition < element.duration - 5 && identityKey !== resumeDecisionIdentity) {
        resumeDecisionIdentity = identityKey
        setResumePrompt(savedPosition)
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

      // The signed AniSource HLS proxy owns upstream headers. Passing provider
      // or extractor headers from the browser breaks the proxy boundary and
      // can make the manifest or its child URLs fail CORS checks.
      const instance = new HlsClass()
      hls = instance
      let audioPreferenceApplied = false

      const syncQualityLevels = () => {
        if (generation !== loadGeneration) return
        const options = instance.levels.map((level, levelIndex) => ({ id: levelIndex, label: qualityLabel(level, levelIndex) }))
        setQualityLevels(options)
        const preferred = props.preferences?.quality
        const preferredIndex = preferred && preferred.toLowerCase() !== 'auto'
          ? options.findIndex((option) => option.label === preferred)
          : -1
        const next = preferredIndex >= 0 ? preferredIndex : -1
        instance.currentLevel = next
        setQualityLevel(next)
      }

      const syncAudioTracks = () => {
        if (generation !== loadGeneration) return
        const options = instance.audioTracks.map((track, trackIndex) => ({
          id: trackIndex,
          label: audioLabel(track, trackIndex),
          language: track.lang?.trim() ?? '',
          name: track.name?.trim() ?? '',
        }))
        setAudioTracks(options)
        if (!options.length) {
          setAudioTrack(-1)
          return
        }

        const preferredLanguage = props.preferences?.audioLanguage
        const preferredLabel = props.preferences?.audioLabel
        const preferredIndex = !audioPreferenceApplied && (preferredLanguage || preferredLabel)
          ? options.findIndex((option) =>
              (!preferredLanguage || option.language === preferredLanguage) &&
              (!preferredLabel || option.name === preferredLabel),
            )
          : -1
        const current = instance.audioTrack >= 0 && instance.audioTrack < options.length ? instance.audioTrack : 0
        const next = preferredIndex >= 0 ? preferredIndex : current
        if (next !== instance.audioTrack) instance.audioTrack = next
        setAudioTrack(next)
        audioPreferenceApplied = true
      }

      // eslint-disable-next-line solid/reactivity -- hls.js owns this imperative media lifecycle.
      instance.on(HlsClass.Events.MANIFEST_PARSED, () => {
        syncQualityLevels()
        syncAudioTracks()
      })
      // eslint-disable-next-line solid/reactivity -- hls.js owns this imperative media lifecycle.
      instance.on(HlsClass.Events.AUDIO_TRACKS_UPDATED, () => syncAudioTracks())
      instance.on(HlsClass.Events.AUDIO_TRACK_SWITCHED, (_event, data) => {
        if (generation === loadGeneration && typeof data.id === 'number') setAudioTrack(data.id)
      })

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
          const previous = current[subtitleIndex()]
          const nextIndex = restoredSubtitleIndex(options, previous)
          setSubtitleIndex(nextIndex)
          applySubtitleSelection(nextIndex, options)
          return options
        })
      })
      // eslint-disable-next-line solid/reactivity -- hls.js invokes this handler for the active stream generation.
      instance.on(HlsClass.Events.ERROR, (_event, data) => {
        if (generation !== loadGeneration) return
        if (isExpiredStreamFailure(data)) {
          const message = 'This stream link has expired. Refresh this server to request a new stream.'
          showFailure(message)
          if (props.identity) props.onMediaError?.(props.identity, message, true)
          return
        }
        if (!data.fatal) return
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
        const message = 'This stream could not be played. Try another server, or open the stream directly.'
        showFailure(message)
        if (props.identity) props.onMediaError?.(props.identity, message, false)
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
      const preferred = props.preferences?.quality
      const preferredIndex = preferred
        ? streams.findIndex((stream) => !stream.is_audio && stream.quality === preferred)
        : -1
      const defaultIndex = streams.findIndex((stream) => !stream.is_audio)
      void loadStream(preferredIndex >= 0 ? preferredIndex : defaultIndex >= 0 ? defaultIndex : 0, resume)
    })
  })

  onMount(() => {
    const element = video()
    const nativeVideo = element as VideoWithNativeFullscreen | undefined
    setFullscreenAvailable(Boolean(element?.requestFullscreen || nativeVideo?.webkitEnterFullscreen))
    const syncFullscreen = () => {
      const active = document.fullscreenElement === element?.closest('.player')
      setFullscreen(active)
      if (!active) void unlockOrientation()
    }
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

  const persistPreferences = (next: PlaybackPreferenceValues) => {
    void Promise.resolve(props.onPreferencesChange?.(next)).catch((cause) => {
      console.error('Failed to persist playback preferences.', cause)
      setPlayerNotice('The playback preference could not be saved.')
    })
  }

  const changeQuality = (index: number) => {
    flushProgress()
    const element = video()
    const quality = props.streams[index]?.quality ?? null
    persistPreferences({ ...(props.preferences ?? { quality: null, audioLanguage: null, audioLabel: null, subtitleLanguage: null, subtitleLabel: null }), quality })
    void loadStream(index, element?.currentTime ?? 0, Boolean(element && !element.paused))
  }

  const changeHlsQuality = (value: string) => {
    const next = Number(value)
    const instance = hls
    if (!instance || !Number.isInteger(next) || next < -1 || next >= qualityLevels().length) return
    instance.currentLevel = next
    setQualityLevel(next)
    const quality = next >= 0 ? qualityLevels()[next]?.label ?? null : null
    persistPreferences({ ...(props.preferences ?? { quality: null, audioLanguage: null, audioLabel: null, subtitleLanguage: null, subtitleLabel: null }), quality })
  }

  const changeAudioTrack = (value: string) => {
    const next = Number(value)
    const instance = hls
    const selected = audioTracks()[next]
    if (!instance || !Number.isInteger(next) || !selected) return
    instance.audioTrack = next
    setAudioTrack(next)
    persistPreferences({
      ...(props.preferences ?? { quality: null, audioLanguage: null, audioLabel: null, subtitleLanguage: null, subtitleLabel: null }),
      audioLanguage: selected.language || null,
      audioLabel: selected.name || null,
    })
  }

  const changeSubtitle = (index: number) => {
    setSubtitleIndex(index)
    applySubtitleSelection(index, subtitleOptions())
    const option = subtitleOptions()[index]
    persistPreferences({ ...(props.preferences ?? { quality: null, audioLanguage: null, audioLabel: null, subtitleLanguage: null, subtitleLabel: null }), subtitleLanguage: option?.language ?? null, subtitleLabel: option?.label ?? null })
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
    const nextMuted = next === 0
    element.muted = nextMuted
    setVolume(next)
    setMuted(nextMuted)
  }

  const toggleMute = () => {
    const element = video()
    if (!element) return
    let nextVolume = element.volume
    if (element.muted && nextVolume === 0) {
      nextVolume = 1
      element.volume = nextVolume
    }
    const nextMuted = !element.muted
    element.muted = nextMuted
    setVolume(nextVolume)
    setMuted(nextMuted)
  }

  const lockOrientation = async () => {
    if (typeof screen === 'undefined' || !screen.orientation?.lock) return
    try {
      await screen.orientation.lock('landscape')
    } catch {
      // Orientation locking is an optional browser capability.
    }
  }

  const unlockOrientation = async () => {
    if (typeof screen === 'undefined' || !screen.orientation?.unlock) return
    try {
      screen.orientation.unlock()
    } catch {
      // Orientation unlocking is an optional browser capability.
    }
  }

  const toggleFullscreen = async () => {
    const element = video()
    const stage = element?.closest('.player')
    if (!element || !stage) return
    const nativeVideo = element as VideoWithNativeFullscreen
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
        await unlockOrientation()
        return
      }
      if (stage.requestFullscreen) {
        await stage.requestFullscreen()
        await lockOrientation()
        return
      }
      if (nativeVideo.webkitEnterFullscreen) {
        nativeVideo.webkitEnterFullscreen()
        await lockOrientation()
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

  const chooseResume = (position: number) => {
    const element = video()
    if (element) element.currentTime = position
    setCurrentTime(position)
    setResumePrompt(null)
  }
  const formatRemaining = (position: number) => formatTime(Math.max(0, duration() - position))
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
      <section class="player overflow-hidden rounded-shell border border-black/20 bg-[#121217] shadow-[0_24px_60px_rgb(0_0_0/.22)]" aria-labelledby="player-title" aria-keyshortcuts="Space K ArrowLeft ArrowRight M F" onKeyDown={(event) => {
        const target = event.target as HTMLElement
        if (target.matches('input, select, textarea, button, [contenteditable="true"]')) return
        if (event.key === ' ' || event.key.toLowerCase() === 'k') { event.preventDefault(); void togglePlayback() }
        else if (event.key === 'ArrowLeft') { event.preventDefault(); seekTo(String(Math.max(0, currentTime() - 5))) }
        else if (event.key === 'ArrowRight') { event.preventDefault(); seekTo(String(Math.min(duration(), currentTime() + 5))) }
        else if (event.key.toLowerCase() === 'm') { event.preventDefault(); toggleMute() }
        else if (event.key.toLowerCase() === 'f') { event.preventDefault(); void toggleFullscreen() }
      }}>
        <h2 id="player-title" class="sr-only">{props.serverName ? `${props.serverName} player` : 'Video player'}</h2>
        <div class="relative aspect-video bg-black" tabIndex={0}>
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
              const identity = props.identity
              if (!onEnded) return
              const completed = identity
                ? onEnded(identity)
                : (onEnded as unknown as () => Promise<void> | void)()
              void Promise.resolve(completed).catch((cause) => {
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
            onError={() => {
              const message = 'This stream could not be played. Try another server, or open the stream directly.'
              showFailure(message)
              if (props.identity) props.onMediaError?.(props.identity, message, false)
            }}
          />
          <Show when={resumePrompt() !== null}>
            <div class="absolute inset-0 grid place-items-center bg-black/72 p-5 text-center text-white backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="resume-heading">
              <div class="max-w-sm">
                <p class="font-mono text-[9px] uppercase tracking-[.18em] text-white/60">Playback checkpoint</p>
                <h3 id="resume-heading" class="mt-2 font-display text-4xl leading-none">Continue watching?</h3>
                <p class="mt-3 text-sm text-white/75">You have {formatRemaining(resumePrompt()!)} remaining from {formatTime(resumePrompt()!)}.</p>
                <div class="mt-5 flex flex-wrap justify-center gap-2">
                  <button type="button" class="min-h-11 border border-white bg-white px-4 py-2 font-mono text-[10px] uppercase tracking-[.1em] text-black transition hover:bg-transparent hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white" onClick={() => chooseResume(resumePrompt()!)}>Continue from {formatTime(resumePrompt()!)}</button>
                  <button type="button" class="min-h-11 border border-white/45 px-4 py-2 font-mono text-[10px] uppercase tracking-[.1em] transition hover:border-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white" onClick={() => chooseResume(0)}>Start from beginning</button>
                </div>
              </div>
            </div>
          </Show>
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

          <div class="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="grid size-11 shrink-0 place-items-center rounded-[9px] border border-white bg-white text-black transition hover:bg-transparent hover:text-white"
              aria-label={playing() ? 'Pause' : 'Play'}
              onClick={() => { void togglePlayback() }}
            >
              <Show when={playing()} fallback={<PlayIcon />}><PauseIcon /></Show>
            </button>

            <div class="flex items-center gap-2">
              <button
                type="button"
                class="grid size-11 shrink-0 place-items-center rounded-[9px] border border-white/25 transition hover:border-white"
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

            <Show when={streamOptions().length > 1}>
              <label class="flex min-w-0 items-center gap-2 font-mono text-[9px] uppercase tracking-[.08em] text-white/55">
                <span>{streamOptions().some(({ stream }) => stream.is_audio) ? 'Stream' : 'Quality'}</span>
                <select class="max-w-[8rem] border border-white/20 bg-transparent px-2 py-2 text-white" value={activeIndex()} onChange={(event) => changeQuality(Number(event.currentTarget.value))}>
                  <For each={streamOptions()}>
                    {(option, index) => <option value={option.index}>{streamLabel(option.stream) || `Variant ${index() + 1}`}</option>}
                  </For>
                </select>
              </label>
            </Show>

            <Show when={qualityLevels().length > 1}>
              <label class="flex min-w-0 items-center gap-2 font-mono text-[9px] uppercase tracking-[.08em] text-white/55">
                <span>Quality</span>
                <select class="max-w-[8rem] border border-white/20 bg-transparent px-2 py-2 text-white" value={qualityLevel()} onChange={(event) => changeHlsQuality(event.currentTarget.value)}>
                  <option value={-1}>Auto</option>
                  <For each={qualityLevels()}>
                    {(option) => <option value={option.id}>{option.label}</option>}
                  </For>
                </select>
              </label>
            </Show>

            <Show when={audioTracks().length > 1}>
              <label class="flex min-w-0 items-center gap-2 font-mono text-[9px] uppercase tracking-[.08em] text-white/55">
                <span>Audio</span>
                <select class="max-w-[10rem] border border-white/20 bg-transparent px-2 py-2 text-white" value={audioTrack()} onChange={(event) => changeAudioTrack(event.currentTarget.value)}>
                  <For each={audioTracks()}>
                    {(track) => <option value={track.id}>{track.label}</option>}
                  </For>
                </select>
              </label>
            </Show>

            <Show when={subtitleOptions().length > 0}>
              <label class="flex min-w-0 items-center gap-2 font-mono text-[9px] uppercase tracking-[.08em] text-white/55">
                <span>Subtitles</span>
                <select class="max-w-[8rem] border border-white/20 bg-transparent px-2 py-2 text-white" value={subtitleIndex()} onChange={(event) => changeSubtitle(Number(event.currentTarget.value))}>
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
                class="grid size-11 shrink-0 place-items-center rounded-[9px] border border-white/25 transition hover:border-white"
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
