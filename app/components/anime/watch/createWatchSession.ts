import { createSignal, type Accessor } from 'solid-js'
import type { AniListDetail } from '../../../data/anilist/types'
import { AniSourceError } from '../../../data/anisource/client'
import type {
  AniSourceAnime,
  Episode,
  HealthResponse,
  SearchResponse,
  Server,
  SourceInfo,
  SourceListResponse,
  Stream,
} from '../../../data/anisource/schema'
import { matchFlow, titleVariants, type MatchResult } from '../../../data/matching'
import { titleOf } from '../../../lib/format'
import type {
  ContinueDraft,
  ContinueItem,
  MatchItem,
  PlaybackDraft,
  PlaybackPreferenceValues,
  PlaybackProgress,
  PlaybackRecord,
} from '../../../lib/persistence/viewer'
import {
  episodeRouteToken,
  getEpisodeNavigation,
  selectDefaultEpisodeWithReason,
} from './episodeNavigation'

export { episodeRouteToken } from './episodeNavigation'

export type WatchStage =
  | 'episode'
  | 'servers-loading'
  | 'servers-empty'
  | 'server'
  | 'streams-loading'
  | 'streams-empty'
  | 'stream-error'
  | 'player'

export type WatchErrorKind =
  | 'network'
  | 'timeout'
  | 'invalid'
  | 'unavailable-server'
  | 'expired-stream'
  | 'media'
  | 'persistence'

/** Maximum manual stream retries after the initial stream resolution attempt. */
export const MAX_STREAM_RETRIES = 2

export type SourceHealthStatus =
  | 'unknown'
  | 'checking'
  | 'healthy'
  | 'degraded'
  | 'unavailable'

export interface SourceHealth {
  status: SourceHealthStatus
  checkedAt: number | null
  detail: string | null
}

export interface WatchError {
  kind: WatchErrorKind
  operation: string
  message: string
  retryable: boolean
  retryCount: number
  sourceId?: string
  sourceName?: string
  serverId?: string
  serverName?: string
}

export interface PlaybackIdentity {
  key: string
  sourceId: string
  episodeId: string
  serverId: string
}

export interface WatchSourceClient {
  health?: (onSlow?: () => void, signal?: AbortSignal) => Promise<HealthResponse>
  sources(onSlow?: () => void, signal?: AbortSignal): Promise<SourceListResponse>
  search(
    sourceId: string,
    query: string,
    page?: number,
    onSlow?: () => void,
    signal?: AbortSignal,
  ): Promise<SearchResponse>
  episodes(
    sourceId: string,
    animeId: string,
    onSlow?: () => void,
    signal?: AbortSignal,
  ): Promise<Episode[]>
  servers(
    sourceId: string,
    episodeId: string,
    onSlow?: () => void,
    signal?: AbortSignal,
  ): Promise<Server[]>
  streams(
    sourceId: string,
    episodeId: string,
    serverId: string,
    onSlow?: () => void,
    signal?: AbortSignal,
  ): Promise<Stream[]>
}

export interface WatchPersistence {
  getPreferredSource(): Promise<string | null>
  setPreferredSource(sourceId: string): Promise<void>
  getSavedMatch(anilistId: number): Promise<MatchItem | null>
  saveMatch(anilistId: number, match: MatchItem): Promise<void>
  clearSavedMatch(anilistId: number): Promise<void>
  getContinue(): Promise<ContinueItem[]>
  recordContinue(item: ContinueDraft): Promise<void>
  getPlaybackRecord?: (id: number, episodeId: string) => Promise<PlaybackRecord | null>
  recordPlayback?: (item: PlaybackDraft) => Promise<void>
  updateProgress(progress: PlaybackProgress): Promise<void>
  markEpisodeComplete(id: number, episodeId: string): Promise<void>
  getPlaybackPreferences?: () => Promise<PlaybackPreferenceValues>
  setPlaybackPreferences?: (preferences: PlaybackPreferenceValues) => Promise<void>
}

export interface WatchSessionOptions {
  anime: AniListDetail
  routeEpisodeId: Accessor<string>
  sourceSearchParam: Accessor<string | undefined>
  fromSchedule?: Accessor<boolean>
  navigateToEpisode: (routeToken: string, sourceId?: string) => Promise<void>
  api: WatchSourceClient
  persistence: WatchPersistence
}

export interface WatchSession {
  sources: Accessor<SourceInfo[]>
  selectedSource: Accessor<string>
  sourceHealth: Accessor<Record<string, SourceHealth>>
  fallbackSource: Accessor<SourceInfo | null>
  matchedAnime: Accessor<AniSourceAnime | null>
  match: Accessor<MatchResult | null>
  episodes: Accessor<Episode[]>
  selectedEpisode: Accessor<string | null>
  servers: Accessor<Server[]>
  selectedServer: Accessor<string | null>
  streams: Accessor<Stream[]>
  loading: Accessor<string>
  error: Accessor<string | null>
  watchError: Accessor<WatchError | null>
  notice: Accessor<string | null>
  slow: Accessor<boolean>
  manualQuery: Accessor<string>
  pickerLoading: Accessor<boolean>
  pickerCandidates: Accessor<ReturnType<typeof matchFlow>['ranked']>
  sourceName: Accessor<string>
  statusText: Accessor<string>
  playerStage: Accessor<WatchStage>
  selectedServerName: Accessor<string>
  resumeAt: Accessor<number>
  playbackIdentity: Accessor<PlaybackIdentity | null>
  preferences: Accessor<PlaybackPreferenceValues>
  previousEpisode: Accessor<Episode | null>
  nextEpisode: Accessor<Episode | null>
  navigationReliable: Accessor<boolean>
  continueNext: Accessor<Episode | null>
  initialize(): Promise<void>
  chooseSource(sourceId: string): Promise<void>
  chooseEpisode(episodeId: string): Promise<void>
  chooseServer(serverId: string): Promise<void>
  retryStreams(): Promise<void>
  updatePlaybackProgress(identity: PlaybackIdentity, position: number, duration: number): Promise<void>
  updatePlaybackProgress(position: number, duration: number): Promise<void>
  markPlaybackComplete(identity?: PlaybackIdentity): Promise<void>
  savePlaybackPreferences(values: PlaybackPreferenceValues): Promise<void>
  reportMediaFailure(identity: PlaybackIdentity, message: string): void
  changeMatch(candidate: AniSourceAnime): Promise<void>
  openMatchPicker(): void
  searchManualMatch(query: string): Promise<void>
  searchVariant(title: string): Promise<void>
  onManualQueryInput(value: string): void
  dispose(): void
}

export function resolveEpisodeId(
  episodes: readonly Episode[],
  requested: string,
  nextEpisode: number | null | undefined,
): string | undefined {
  if (requested === 'next') {
    return episodes.find((episode) => episode.number === nextEpisode)?.id ?? episodes[0]?.id
  }
  return (
    episodes.find((episode) => episodeRouteToken(episode) === requested)?.id ??
    episodes.find((episode) => episode.id === requested)?.id
  )
}

export function orderStreams(streams: readonly Stream[]): Stream[] {
  return [...streams].sort(
    (left, right) =>
      Number(left.is_audio) - Number(right.is_audio) ||
      (Number.parseInt(right.quality, 10) || 0) - (Number.parseInt(left.quality, 10) || 0),
  )
}

export function derivePlayerStage(state: {
  selectedEpisode: string | null
  loading: string
  servers: readonly Server[]
  selectedServer: string | null
  streams: readonly Stream[]
  error: string | null
}): WatchStage {
  if (!state.selectedEpisode) return 'episode'
  if (state.loading === 'servers') return 'servers-loading'
  if (!state.selectedServer) return state.servers.length ? 'server' : 'servers-empty'
  if (state.loading === 'streams') return 'streams-loading'
  if (state.streams.length) return 'player'
  if (state.error) return 'stream-error'
  return 'streams-empty'
}

function savedCandidate(saved: MatchItem): AniSourceAnime {
  return {
    id: saved.animeId,
    title: saved.title,
    url: '',
    thumbnail: '',
    description: '',
    genres: [],
    studios: [],
    producers: [],
    alternative_titles: [],
    status: 'unknown',
    score: null,
    tags: [],
  }
}

function publicErrorMessage(kind: WatchErrorKind, operation: string): string {
  if (kind === 'expired-stream') {
    return 'This stream link has expired. Refresh this server to request a new stream.'
  }
  if (kind === 'unavailable-server') {
    return 'This server is unavailable for the selected episode. Try another server or source.'
  }
  if (kind === 'timeout') {
    return 'The streaming backend took too long to respond. It may still be waking up.'
  }
  if (kind === 'invalid') {
    return 'The streaming backend returned an unsupported response. Try another source.'
  }
  if (kind === 'media') {
    return 'This stream could not be played. Try another server or open the stream directly.'
  }
  if (kind === 'persistence') {
    return 'Playback is available, but progress cannot be saved on this device.'
  }
  return operation === 'health'
    ? 'The streaming source health check could not be completed.'
    : 'The streaming connection could not be completed. Check your connection or try another source.'
}

function classifyError(
  cause: unknown,
  operation: string,
  sourceId?: string,
  serverId?: string,
  retryCount = 0,
): WatchError | null {
  if (cause instanceof AniSourceError && cause.kind === 'cancelled') return null

  let kind: WatchErrorKind
  let retryable = true

  if (cause instanceof AniSourceError) {
    const expired =
      operation === 'streams' &&
      (cause.status === 401 ||
        cause.status === 403 ||
        cause.status === 410 ||
        /expired|unauthori[sz]ed/i.test(cause.message))

    kind = expired
      ? 'expired-stream'
      : cause.kind === 'timeout'
        ? 'timeout'
        : cause.kind === 'invalid'
          ? 'invalid'
          : operation === 'streams' && cause.kind === 'http'
            ? 'unavailable-server'
            : 'network'
    retryable = cause.kind !== 'invalid'
  } else {
    kind = operation === 'media' ? 'media' : operation === 'persistence' ? 'persistence' : 'network'
  }

  if (operation === 'streams' && retryCount >= MAX_STREAM_RETRIES) retryable = false

  return {
    kind,
    operation,
    message:
      cause instanceof AniSourceError
        ? publicErrorMessage(kind, operation)
        : cause instanceof Error
          ? cause.message
          : publicErrorMessage(kind, operation),
    retryable,
    retryCount,
    sourceId,
    serverId,
  }
}

function healthStatusFromError(cause: unknown): SourceHealthStatus {
  if (
    cause instanceof AniSourceError &&
    cause.kind === 'http' &&
    (cause.status === 502 || cause.status === 503 || cause.status === 504)
  ) {
    return 'unavailable'
  }
  return 'degraded'
}

function observedSourceHealthFromError(cause: unknown): SourceHealthStatus {
  if (
    cause instanceof AniSourceError &&
    cause.kind === 'http' &&
    (cause.status === 502 || cause.status === 503 || cause.status === 504)
  ) {
    return 'unavailable'
  }
  return 'degraded'
}

export function createWatchSession(options: WatchSessionOptions): WatchSession {
  const [sources, setSources] = createSignal<SourceInfo[]>([])
  const [selectedSource, setSelectedSource] = createSignal('')
  const [sourceHealth, setSourceHealth] = createSignal<Record<string, SourceHealth>>({})
  const [matchedAnime, setMatchedAnime] = createSignal<AniSourceAnime | null>(null)
  const [match, setMatch] = createSignal<MatchResult | null>(null)
  const [episodes, setEpisodes] = createSignal<Episode[]>([])
  const [selectedEpisode, setSelectedEpisode] = createSignal<string | null>(null)
  const [servers, setServers] = createSignal<Server[]>([])
  const [selectedServer, setSelectedServer] = createSignal<string | null>(null)
  const [streams, setStreams] = createSignal<Stream[]>([])
  const [playbackIdentity, setPlaybackIdentity] = createSignal<PlaybackIdentity | null>(null)
  const [resumeAt, setResumeAt] = createSignal(0)
  const [loading, setLoading] = createSignal('')
  const [error, setError] = createSignal<string | null>(null)
  const [watchError, setWatchError] = createSignal<WatchError | null>(null)
  const [notice, setNotice] = createSignal<string | null>(null)
  const [slow, setSlow] = createSignal(false)
  const [manualQuery, setManualQuery] = createSignal('')
  const [pickerLoading, setPickerLoading] = createSignal(false)
  const [preferences, setPreferences] = createSignal<PlaybackPreferenceValues>({
    quality: null,
    subtitleLanguage: null,
    subtitleLabel: null,
  })
  const [continueNext, setContinueNext] = createSignal<Episode | null>(null)
  const [latestContinue, setLatestContinue] = createSignal<ContinueItem | null>(null)

  let disposed = false
  let generation = 0
  let searchTimer: ReturnType<typeof setTimeout> | undefined
  const controllers = new Set<AbortController>()
  const operationGenerations = new WeakMap<AbortController, number>()
  const healthRetries = new Map<string, number>()
  const streamAttempts = new Map<string, number>()

  const begin = () => {
    generation += 1
    for (const controller of controllers) controller.abort()
    controllers.clear()

    const controller = new AbortController()
    operationGenerations.set(controller, generation)
    controllers.add(controller)

    return {
      generation,
      controller,
      current: () =>
        !disposed && generation === (operationGenerations.get(controller) ?? -1),
    }
  }

  const current = (operation: ReturnType<typeof begin>) =>
    operation.current() && !operation.controller.signal.aborted
  const finish = (operation: ReturnType<typeof begin>) => controllers.delete(operation.controller)

  const variants = () => titleVariants(options.anime)
  const sourceName = () =>
    sources().find((source) => source.id === selectedSource())?.name ?? selectedSource()
  const fallbackSource = () => {
    const rank: Record<SourceHealthStatus, number> = {
      healthy: 0,
      unknown: 1,
      checking: 2,
      degraded: 3,
      unavailable: 4,
    }
    const healthSnapshot = sourceHealth()
    return (
      sources()
        .filter((source) => {
          if (source.id === selectedSource()) return false
          return healthSnapshot[source.id]?.status !== 'unavailable'
        })
        .sort((left, right) => {
          const leftRank = rank[healthSnapshot[left.id]?.status ?? 'unknown']
          const rightRank = rank[healthSnapshot[right.id]?.status ?? 'unknown']
          return leftRank - rightRank
        })[0] ?? null
    )
  }
  const selectedServerName = () =>
    servers().find((server) => server.id === selectedServer())?.name ?? 'This server'
  const pickerCandidates = () => (match()?.kind === 'picker' ? match()!.ranked : [])
  const navigation = () => getEpisodeNavigation(episodes(), selectedEpisode())
  const previousEpisode = () => navigation().previous
  const nextEpisode = () => navigation().next
  const navigationReliable = () => navigation().reliable

  const setFailure = (
    cause: unknown,
    operation: string,
    sourceId?: string,
    serverId?: string,
    retryCount = 0,
  ) => {
    const classified = classifyError(cause, operation, sourceId, serverId, retryCount)
    if (!classified) return

    const source = sources().find((item) => item.id === sourceId)
    const server = servers().find((item) => item.id === serverId)
    const diagnostic: WatchError = {
      ...classified,
      sourceName: source?.name,
      serverName: server?.name,
    }

    console.error(diagnostic.message, cause)
    setWatchError(diagnostic)
    setError(diagnostic.message)
    if (sourceId) setHealth(sourceId, observedSourceHealthFromError(cause), diagnostic.message)
  }

  const setHealth = (sourceId: string, status: SourceHealthStatus, detail: string | null) => {
    setSourceHealth((currentHealth) => ({
      ...currentHealth,
      [sourceId]: { status, checkedAt: Date.now(), detail },
    }))
  }

  const probeHealth = async (sourceId: string, operation: ReturnType<typeof begin>) => {
    if (!options.api.health || !current(operation)) return

    const retryCount = healthRetries.get(sourceId) ?? 0
    setSourceHealth((currentHealth) => ({
      ...currentHealth,
      [sourceId]: {
        status: 'checking',
        checkedAt: currentHealth[sourceId]?.checkedAt ?? null,
        detail: null,
      },
    }))

    try {
      const health = await options.api.health(
        () => {
          if (current(operation)) setSlow(true)
        },
        operation.controller.signal,
      )
      if (!current(operation)) return

      const healthy = health.status.toLowerCase() === 'ok' && health.active_sources > 0
      setHealth(
        sourceId,
        healthy ? 'healthy' : 'degraded',
        healthy ? null : 'The streaming backend reported reduced source availability.',
      )
      healthRetries.set(sourceId, 0)
    } catch (cause) {
      if (!current(operation)) return

      const diagnostic = classifyError(cause, 'health', sourceId, undefined, retryCount)
      if (!diagnostic) return

      setHealth(sourceId, healthStatusFromError(cause), diagnostic.message)
      if (diagnostic.retryable && retryCount < 1) {
        healthRetries.set(sourceId, retryCount + 1)
        await probeHealth(sourceId, operation)
      }
    }
  }

  const persistWarning = (cause: unknown, message: string) => {
    console.error(message, cause)
    setNotice(message)
  }

  const draftFor = (episodeId: string): PlaybackDraft | null => {
    const episode = episodes().find((item) => item.id === episodeId)
    const anime = matchedAnime()
    if (!episode || !anime) return null

    return {
      id: options.anime.id,
      title: titleOf(options.anime),
      cover: options.anime.coverImage?.large ?? options.anime.coverImage?.extraLarge ?? '',
      sourceId: selectedSource(),
      sourceName: sourceName(),
      animeId: anime.id,
      episodeId,
      episodeNumber: episode.number,
      position: 0,
      duration: 0,
    }
  }

  // Compatibility lets existing narrow test adapters omit AbortSignal while the
  // production client receives cancellation for every transport operation.
  const callSources = (onSlow: () => void, signal: AbortSignal) =>
    options.api.sources.length >= 2
      ? options.api.sources(onSlow, signal)
      : options.api.sources(onSlow)
  const callSearch = (
    sourceId: string,
    query: string,
    page: number,
    onSlow: () => void,
    signal: AbortSignal,
  ) =>
    options.api.search.length >= 5
      ? options.api.search(sourceId, query, page, onSlow, signal)
      : options.api.search(sourceId, query, page, onSlow)
  const callEpisodes = (
    sourceId: string,
    animeId: string,
    onSlow: () => void,
    signal: AbortSignal,
  ) =>
    options.api.episodes.length >= 4
      ? options.api.episodes(sourceId, animeId, onSlow, signal)
      : options.api.episodes(sourceId, animeId, onSlow)
  const callServers = (
    sourceId: string,
    episodeId: string,
    onSlow: () => void,
    signal: AbortSignal,
  ) =>
    options.api.servers.length >= 4
      ? options.api.servers(sourceId, episodeId, onSlow, signal)
      : options.api.servers(sourceId, episodeId, onSlow)
  const callStreams = (
    sourceId: string,
    episodeId: string,
    serverId: string,
    onSlow: () => void,
    signal: AbortSignal,
  ) =>
    options.api.streams.length >= 5
      ? options.api.streams(sourceId, episodeId, serverId, onSlow, signal)
      : options.api.streams(sourceId, episodeId, serverId, onSlow)

  const loadServers = async (episodeId: string, parent?: ReturnType<typeof begin>) => {
    const sourceId = selectedSource()
    const operation = parent ?? begin()
    if (!sourceId) return

    setLoading('servers')
    setError(null)
    setWatchError(null)

    try {
      const result = await callServers(
        sourceId,
        episodeId,
        () => {
          if (current(operation)) setSlow(true)
        },
        operation.controller.signal,
      )
      if (
        !current(operation) ||
        selectedSource() !== sourceId ||
        selectedEpisode() !== episodeId
      ) {
        return
      }

      setServers(result)
      setHealth(sourceId, 'healthy', null)
      setSelectedServer(null)
      setStreams([])
    } catch (cause) {
      if (current(operation)) setFailure(cause, 'servers', sourceId)
    } finally {
      if (current(operation)) setLoading('')
      if (!parent) finish(operation)
    }
  }

  const chooseEpisode = async (episodeId: string, parent?: ReturnType<typeof begin>) => {
    const episode = episodes().find((item) => item.id === episodeId)
    if (!episode) return

    const operation = parent ?? begin()
    setContinueNext(null)
    setPlaybackIdentity(null)
    setResumeAt(0)
    setSelectedEpisode(episodeId)
    setSelectedServer(null)
    setServers([])
    setStreams([])
    setError(null)
    setWatchError(null)

    const token = episodeRouteToken(episode)
    if (options.routeEpisodeId() !== token) {
      await options.navigateToEpisode(token, options.sourceSearchParam())
    }
    if (current(operation) && selectedEpisode() === episodeId) {
      await loadServers(episodeId, operation)
    }
    if (!parent) finish(operation)
  }

  const chooseServer = async (serverId: string) => {
    const episodeId = selectedEpisode()
    const sourceId = selectedSource()
    if (!episodeId || !sourceId) return

    const operation = begin()
    const attemptKey = `${sourceId}:${episodeId}:${serverId}`
    const attempt = (streamAttempts.get(attemptKey) ?? 0) + 1
    streamAttempts.set(attemptKey, attempt)
    setSelectedServer(serverId)
    setPlaybackIdentity(null)
    setLoading('streams')
    setError(null)
    setWatchError(null)

    try {
      const result = orderStreams(
        await callStreams(
          sourceId,
          episodeId,
          serverId,
          () => {
            if (current(operation)) setSlow(true)
          },
          operation.controller.signal,
        ),
      )
      if (
        !current(operation) ||
        selectedSource() !== sourceId ||
        selectedEpisode() !== episodeId ||
        selectedServer() !== serverId
      ) {
        return
      }

      setStreams(result)
      if (!result.length) return

      streamAttempts.delete(attemptKey)
      setHealth(sourceId, 'healthy', null)
      const identity: PlaybackIdentity = {
        key: `${sourceId}:${episodeId}:${serverId}:${operation.generation}`,
        sourceId,
        episodeId,
        serverId,
      }
      const draft = draftFor(episodeId)
      let record: PlaybackRecord | null = null

      try {
        if (draft) {
          await options.persistence.recordPlayback?.(draft)
          await options.persistence.recordContinue(draft)
          record = (await options.persistence.getPlaybackRecord?.(options.anime.id, episodeId)) ?? null

          if (!record) {
            const legacy = (await options.persistence.getContinue()).find(
              (item) => item.id === options.anime.id && item.episodeId === episodeId,
            )
            if (legacy) record = { ...legacy, completedAt: legacy.completed ? legacy.ts : null }
          }
        }
      } catch (cause) {
        persistWarning(cause, 'Playback is available, but progress storage is currently unavailable.')
      }

      if (!current(operation)) return
      setResumeAt(record && !record.completed ? record.position : 0)
      setPlaybackIdentity(identity)
    } catch (cause) {
      if (current(operation)) {
        setStreams([])
        setFailure(cause, 'streams', sourceId, serverId, attempt - 1)
      }
    } finally {
      if (current(operation)) setLoading('')
      finish(operation)
    }
  }

  const retryStreams = async () => {
    const sourceId = selectedSource()
    const serverId = selectedServer()
    const errorToRetry = watchError()
    if (!sourceId || !serverId || errorToRetry?.retryable === false) return

    if (options.api.health) {
      const operation = begin()
      await probeHealth(sourceId, operation)
      const canRetry = current(operation) && sourceHealth()[sourceId]?.status !== 'unavailable'
      finish(operation)
      if (!canRetry) return
    }

    await chooseServer(serverId)
  }

  const loadEpisodes = async (
    sourceId: string,
    anime: AniSourceAnime,
    parent?: ReturnType<typeof begin>,
  ) => {
    const operation = parent ?? begin()
    setLoading('episodes')
    setError(null)

    try {
      const result = await callEpisodes(
        sourceId,
        anime.id,
        () => {
          if (current(operation)) setSlow(true)
        },
        operation.controller.signal,
      )
      if (!current(operation) || selectedSource() !== sourceId) return

      setEpisodes(
        [...result]
          .filter((episode) => Number.isFinite(episode.number))
          .sort((left, right) => left.number - right.number),
      )
      const selection = selectDefaultEpisodeWithReason(result, {
        requested: options.routeEpisodeId(),
        latest: latestContinue(),
        scheduleEpisode: options.anime.nextAiringEpisode?.episode,
        fromSchedule: options.fromSchedule?.(),
      })
      if (selection.reason === 'schedule-source-lag') {
        setNotice(
          `The next airing episode (${options.anime.nextAiringEpisode?.episode}) is not available from ${sourceName()} yet. Showing the latest available episode instead.`,
        )
      }
      if (selection.episode) await chooseEpisode(selection.episode.id, operation)
    } catch (cause) {
      if (current(operation)) setFailure(cause, 'episodes', sourceId)
    } finally {
      if (current(operation)) setLoading('')
      if (!parent) finish(operation)
    }
  }

  const runMatch = async (sourceId: string, saved?: MatchItem) => {
    const operation = begin()
    setSelectedSource(sourceId)

    try {
      await options.persistence.setPreferredSource(sourceId)
    } catch (cause) {
      persistWarning(cause, 'The source preference could not be saved.')
    }
    if (!current(operation)) return

    if (saved) {
      const candidate = savedCandidate(saved)
      setMatchedAnime(candidate)
      setMatch({
        kind: 'auto',
        match: {
          candidate,
          score: 1,
          aniListTitle: titleOf(options.anime),
          sourceTitle: candidate.title,
        },
        ranked: [],
      })
      await loadEpisodes(sourceId, candidate, operation)
      return
    }

    setLoading('match')
    setError(null)
    setWatchError(null)

    try {
      const titles = variants().map((variant) => variant.title)
      const found = new Map<string, AniSourceAnime>()
      let lastSearchFailure: unknown

      for (const query of titles) {
        try {
          const response = await callSearch(
            sourceId,
            query,
            1,
            () => {
              if (current(operation)) setSlow(true)
            },
            operation.controller.signal,
          )
          if (!current(operation)) return

          for (const item of response.items) found.set(item.id, item)
          if (matchFlow(titles, [...found.values()]).kind === 'auto') break
        } catch (cause) {
          if (cause instanceof AniSourceError && cause.kind === 'cancelled') return
          lastSearchFailure = cause
          console.warn(`Search for “${query}” failed.`, cause)
        }
      }

      if (!current(operation)) return
      if (!found.size && lastSearchFailure) {
        setFailure(lastSearchFailure, 'match', sourceId)
        return
      }

      const result = matchFlow(titles, [...found.values()])
      setMatch(result)
      if (result.kind === 'auto') {
        const candidate = result.match.candidate
        setMatchedAnime(candidate)
        try {
          await options.persistence.saveMatch(options.anime.id, {
            sourceId,
            animeId: candidate.id,
            title: candidate.title,
          })
        } catch (cause) {
          persistWarning(cause, 'The source match could not be saved.')
        }
        if (current(operation)) await loadEpisodes(sourceId, candidate, operation)
      } else {
        setManualQuery(titleOf(options.anime))
      }
    } catch (cause) {
      if (current(operation)) setFailure(cause, 'match', sourceId)
    } finally {
      if (current(operation)) setLoading('')
      finish(operation)
    }
  }

  const changeMatch = async (candidate: AniSourceAnime) => {
    const sourceId = selectedSource()
    if (!sourceId) return

    setMatchedAnime(candidate)
    setMatch({
      kind: 'auto',
      match: {
        candidate,
        score: 1,
        aniListTitle: titleOf(options.anime),
        sourceTitle: candidate.title,
      },
      ranked: [],
    })
    setManualQuery(candidate.title)

    try {
      await options.persistence.saveMatch(options.anime.id, {
        sourceId,
        animeId: candidate.id,
        title: candidate.title,
      })
    } catch (cause) {
      persistWarning(cause, 'The source match could not be saved.')
    }

    await loadEpisodes(sourceId, candidate)
  }

  const openMatchPicker = () => {
    setMatch({ kind: 'picker', ranked: [] })
    setManualQuery(matchedAnime()?.title || titleOf(options.anime))
    setError(null)
    setWatchError(null)
  }

  const searchManualMatch = async (query: string) => {
    const sourceId = selectedSource()
    const trimmed = query.trim()
    if (!sourceId || trimmed.length < 2) return

    const operation = begin()
    setPickerLoading(true)
    setError(null)
    setWatchError(null)

    try {
      const response = await callSearch(
        sourceId,
        trimmed,
        1,
        () => {
          if (current(operation)) setSlow(true)
        },
        operation.controller.signal,
      )
      if (!current(operation)) return

      const ranked = matchFlow(
        variants().map((variant) => variant.title),
        response.items,
      )
      setMatch(ranked.kind === 'auto' ? { kind: 'picker', ranked: ranked.ranked } : ranked)
    } catch (cause) {
      if (current(operation)) setFailure(cause, 'search', sourceId)
    } finally {
      if (current(operation)) setPickerLoading(false)
      finish(operation)
    }
  }

  const onManualQueryInput = (value: string) => {
    setManualQuery(value)
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      void searchManualMatch(value)
    }, 350)
  }

  const searchVariant = async (title: string) => {
    setManualQuery(title)
    await searchManualMatch(title)
  }

  const chooseSource = async (sourceId: string) => {
    if (sourceId === selectedSource()) return

    try {
      await options.persistence.clearSavedMatch(options.anime.id)
    } catch (cause) {
      persistWarning(cause, 'The previous source match could not be cleared.')
    }

    setMatchedAnime(null)
    setMatch(null)
    setEpisodes([])
    setSelectedEpisode(null)
    setServers([])
    setSelectedServer(null)
    setStreams([])
    setPlaybackIdentity(null)
    setResumeAt(0)
    setSourceHealth((currentHealth) => ({
      ...currentHealth,
      [sourceId]: { status: 'unknown', checkedAt: null, detail: null },
    }))

    await runMatch(sourceId)
  }

  const initialize = async () => {
    const operation = begin()
    setLoading('sources')
    setError(null)
    setWatchError(null)
    setSlow(false)

    try {
      const sourceResult = await callSources(
        () => {
          if (current(operation)) setSlow(true)
        },
        operation.controller.signal,
      )
      if (!current(operation)) return

      setSources(sourceResult.sources)
      if (!sourceResult.sources.length) {
        setNotice('No streaming sources are currently available. Try again later.')
        return
      }

      let saved: MatchItem | null = null
      let preferred: string | null = null
      try {
        const [savedMatch, sourcePreference, continueItems] = await Promise.all([
          options.persistence.getSavedMatch(options.anime.id),
          options.persistence.getPreferredSource(),
          options.persistence.getContinue(),
        ])
        saved = savedMatch
        preferred = sourcePreference
        setLatestContinue(continueItems.find((item) => item.id === options.anime.id) ?? null)
        setPreferences(
          (await options.persistence.getPlaybackPreferences?.()) ?? {
            quality: null,
            subtitleLanguage: null,
            subtitleLabel: null,
          },
        )
      } catch (cause) {
        persistWarning(cause, 'Playback preferences or saved progress could not be loaded.')
      }
      if (!current(operation)) return

      if (saved && !sourceResult.sources.some((source) => source.id === saved!.sourceId)) {
        try {
          await options.persistence.clearSavedMatch(options.anime.id)
        } catch (cause) {
          persistWarning(cause, 'The outdated source match could not be cleared.')
        }
        saved = null
      }

      const requested = options.sourceSearchParam() ?? saved?.sourceId ?? preferred
      const sourceId =
        requested && sourceResult.sources.some((source) => source.id === requested)
          ? requested
          : sourceResult.sources[0]!.id

      setSelectedSource(sourceId)
      await probeHealth(sourceId, operation)
      if (!current(operation)) return
      await runMatch(sourceId, saved ?? undefined)
    } catch (cause) {
      if (current(operation)) setFailure(cause, 'sources')
    } finally {
      if (current(operation)) setLoading('')
      finish(operation)
    }
  }

  const updatePlaybackProgress = async (
    identityOrPosition: PlaybackIdentity | number,
    positionOrDuration: number,
    durationArg?: number,
  ) => {
    const identity =
      typeof identityOrPosition === 'number' ? playbackIdentity() : identityOrPosition
    const position =
      typeof identityOrPosition === 'number' ? identityOrPosition : positionOrDuration
    const duration =
      typeof identityOrPosition === 'number' ? positionOrDuration : durationArg

    if (!identity || duration === undefined || playbackIdentity()?.key !== identity.key) return
    await options.persistence.updateProgress({
      id: options.anime.id,
      episodeId: identity.episodeId,
      position,
      duration,
    })
  }

  const markPlaybackComplete = async (identityArg?: PlaybackIdentity) => {
    const identity = identityArg ?? playbackIdentity()
    if (!identity || playbackIdentity()?.key !== identity.key) return

    await options.persistence.markEpisodeComplete(options.anime.id, identity.episodeId)
    if (playbackIdentity()?.key === identity.key) setContinueNext(nextEpisode())
  }

  const savePlaybackPreferences = async (values: PlaybackPreferenceValues) => {
    setPreferences(values)
    try {
      await options.persistence.setPlaybackPreferences?.(values)
    } catch (cause) {
      persistWarning(cause, 'The playback preference could not be saved.')
    }
  }

  const reportMediaFailure = (identity: PlaybackIdentity, message: string, expired = false) => {
    if (playbackIdentity()?.key === identity.key) {
      setFailure(
        expired ? new AniSourceError(message, 'http', 410) : new Error(message),
        expired ? 'streams' : 'media',
        identity.sourceId,
        identity.serverId,
      )
    }
  }

  const statusText = () => {
    const health = sourceHealth()[selectedSource()]
    if (slow()) {
      return 'The streaming source is waking up. The first response can take up to a minute.'
    }
    if (health?.status === 'checking') return `Checking ${sourceName()} health…`
    if (health?.status === 'unavailable') return `${sourceName()} is unavailable. Choose another listed source.`
    if (health?.status === 'degraded') return `${sourceName()} may be degraded. Playback can still be attempted.`
    if (loading() === 'match') return `Matching “${titleOf(options.anime)}” to ${sourceName()}…`
    if (loading()) return `Loading ${loading()}…`
    if (matchedAnime()) return `Matched to ${matchedAnime()!.title} on ${sourceName()}.`
    return 'Preparing the viewing room…'
  }

  const playerStage = () =>
    derivePlayerStage({
      selectedEpisode: selectedEpisode(),
      loading: loading(),
      servers: servers(),
      selectedServer: selectedServer(),
      streams: streams(),
      error: error(),
    })

  const dispose = () => {
    disposed = true
    generation += 1
    if (searchTimer) clearTimeout(searchTimer)
    for (const controller of controllers) controller.abort()
    controllers.clear()
  }

  return {
    sources,
    selectedSource,
    sourceHealth,
    fallbackSource,
    matchedAnime,
    match,
    episodes,
    selectedEpisode,
    servers,
    selectedServer,
    streams,
    loading,
    error,
    watchError,
    notice,
    slow,
    manualQuery,
    pickerLoading,
    pickerCandidates,
    sourceName,
    statusText,
    playerStage,
    selectedServerName,
    resumeAt,
    playbackIdentity,
    preferences,
    previousEpisode,
    nextEpisode,
    navigationReliable,
    continueNext,
    initialize,
    chooseSource,
    chooseEpisode,
    chooseServer,
    retryStreams,
    updatePlaybackProgress,
    markPlaybackComplete,
    savePlaybackPreferences,
    reportMediaFailure,
    changeMatch,
    openMatchPicker,
    searchManualMatch,
    searchVariant,
    onManualQueryInput,
    dispose,
  }
}
