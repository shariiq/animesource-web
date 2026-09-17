import { createSignal, type Accessor } from 'solid-js'
import type { AniListDetail } from '../../../data/anilist/types'
import type {
  AniSourceAnime,
  Episode,
  Server,
  SourceInfo,
  Stream,
  SearchResponse,
  SourceListResponse,
} from '../../../data/anisource/schema'
import {
  matchFlow,
  titleVariants,
  type MatchResult,
} from '../../../data/matching'
import type {
  ContinueItem,
  MatchItem,
} from '../../../lib/persistence/viewer'
import { titleOf } from '../../../lib/format'

export type WatchStage =
  | 'episode'
  | 'servers-loading'
  | 'servers-empty'
  | 'server'
  | 'streams-loading'
  | 'streams-empty'
  | 'stream-error'
  | 'player'

export interface WatchSourceClient {
  sources(onSlow?: () => void): Promise<SourceListResponse>
  search(
    sourceId: string,
    query: string,
    page?: number,
    onSlow?: () => void,
  ): Promise<SearchResponse>
  episodes(
    sourceId: string,
    animeId: string,
    onSlow?: () => void,
  ): Promise<Episode[]>
  servers(
    sourceId: string,
    episodeId: string,
    onSlow?: () => void,
  ): Promise<Server[]>
  streams(
    sourceId: string,
    episodeId: string,
    serverId: string,
    onSlow?: () => void,
  ): Promise<Stream[]>
}

export interface WatchPersistence {
  getPreferredSource(): Promise<string | null>
  setPreferredSource(sourceId: string): Promise<void>
  getSavedMatch(anilistId: number): Promise<MatchItem | null>
  saveMatch(anilistId: number, match: MatchItem): Promise<void>
  clearSavedMatch(anilistId: number): Promise<void>
  recordContinue(item: ContinueItem): Promise<void>
}

export interface WatchSessionOptions {
  anime: AniListDetail
  routeEpisodeId: Accessor<string>
  sourceSearchParam: Accessor<string | undefined>
  navigateToEpisode: (
    routeToken: string,
    sourceId?: string,
  ) => Promise<void>
  api: WatchSourceClient
  persistence: WatchPersistence
}

export interface WatchSession {
  sources: Accessor<SourceInfo[]>
  selectedSource: Accessor<string>
  matchedAnime: Accessor<AniSourceAnime | null>
  match: Accessor<MatchResult | null>
  episodes: Accessor<Episode[]>
  selectedEpisode: Accessor<string | null>
  servers: Accessor<Server[]>
  selectedServer: Accessor<string | null>
  streams: Accessor<Stream[]>
  loading: Accessor<string>
  error: Accessor<string | null>
  slow: Accessor<boolean>
  manualQuery: Accessor<string>
  pickerLoading: Accessor<boolean>
  pickerCandidates: Accessor<ReturnType<typeof matchFlow>['ranked']>
  sourceName: Accessor<string>
  statusText: Accessor<string>
  playerStage: Accessor<WatchStage>
  selectedServerName: Accessor<string>
  initialize: () => Promise<void>
  chooseSource: (sourceId: string) => Promise<void>
  chooseEpisode: (episodeId: string) => Promise<void>
  chooseServer: (serverId: string) => Promise<void>
  changeMatch: (candidate: AniSourceAnime) => Promise<void>
  openMatchPicker: () => void
  searchManualMatch: (query: string) => Promise<void>
  searchVariant: (title: string) => Promise<void>
  onManualQueryInput: (value: string) => void
  dispose: () => void
}

export function episodeRouteToken(episode: Episode): string {
  return `episode-${episode.number}`
}

export function resolveEpisodeId(
  episodes: readonly Episode[],
  requested: string,
  nextEpisode: number | null | undefined,
): string | undefined {
  if (requested === 'next') {
    return (
      episodes.find((episode) => episode.number === nextEpisode)?.id ??
      episodes[0]?.id
    )
  }
  return (
    episodes.find((episode) => episodeRouteToken(episode) === requested)?.id ??
    episodes.find((episode) => episode.id === requested)?.id
  )
}

export function orderStreams(streams: readonly Stream[]): Stream[] {
  return [...streams].sort(
    (a, b) => (Number.parseInt(b.quality, 10) || 0) - (Number.parseInt(a.quality, 10) || 0),
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
  if (state.streams.length > 0) return 'player'
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

export function createWatchSession(options: WatchSessionOptions): WatchSession {
  const [sources, setSources] = createSignal<SourceInfo[]>([])
  const [selectedSource, setSelectedSource] = createSignal('')
  const [matchedAnime, setMatchedAnime] = createSignal<AniSourceAnime | null>(null)
  const [match, setMatch] = createSignal<MatchResult | null>(null)
  const [episodes, setEpisodes] = createSignal<Episode[]>([])
  const [selectedEpisode, setSelectedEpisode] = createSignal<string | null>(null)
  const [servers, setServers] = createSignal<Server[]>([])
  const [selectedServer, setSelectedServer] = createSignal<string | null>(null)
  const [streams, setStreams] = createSignal<Stream[]>([])
  const [loading, setLoading] = createSignal('')
  const [error, setError] = createSignal<string | null>(null)
  const [slow, setSlow] = createSignal(false)
  const [manualQuery, setManualQuery] = createSignal('')
  const [pickerLoading, setPickerLoading] = createSignal(false)

  const variants = () => titleVariants(options.anime)
  const sourceName = () =>
    sources().find((source) => source.id === selectedSource())?.name ??
    selectedSource()
  const pickerCandidates = () => {
    const current = match()
    return current?.kind === 'picker' ? current.ranked : []
  }
  const reportError = (message: string, cause: unknown) => {
    console.error(message, cause)
    setError(cause instanceof Error ? cause.message : message)
    setLoading('')
  }

  const loadServers = async (episodeId: string) => {
    const sourceId = selectedSource()
    if (!sourceId) return
    setLoading('servers')
    setError(null)
    try {
      const result = await options.api.servers(sourceId, episodeId, () => setSlow(true))
      setServers(result)
      setSelectedServer(null)
      setStreams([])
    } catch (cause) {
      reportError('Failed to load servers.', cause)
    } finally {
      setLoading('')
    }
  }

  const chooseEpisode = async (episodeId: string) => {
    const episode = episodes().find((item) => item.id === episodeId)
    if (!episode) return

    setSelectedEpisode(episodeId)
    setSelectedServer(null)
    setServers([])
    setStreams([])
    setError(null)
    const routeToken = episodeRouteToken(episode)
    if (options.routeEpisodeId() !== routeToken) {
      await options.navigateToEpisode(routeToken, options.sourceSearchParam())
    }
    await loadServers(episodeId)
  }

  const chooseServer = async (serverId: string) => {
    const episodeId = selectedEpisode()
    const sourceId = selectedSource()
    if (!episodeId || !sourceId) return
    setSelectedServer(serverId)
    setLoading('streams')
    setError(null)
    try {
      const result = await options.api.streams(
        sourceId,
        episodeId,
        serverId,
        () => setSlow(true),
      )
      setStreams(orderStreams(result))
      await options.persistence.recordContinue({
        id: options.anime.id,
        title: titleOf(options.anime),
        cover:
          options.anime.coverImage?.large ??
          options.anime.coverImage?.extraLarge ??
          '',
        sourceId,
        sourceName: sourceName(),
        animeId: matchedAnime()?.id ?? '',
        episodeId,
        episodeNumber:
          episodes().find((episode) => episode.id === episodeId)?.number ?? 0,
        ts: Date.now(),
      })
    } catch (cause) {
      reportError('Failed to load streams.', cause)
    } finally {
      setLoading('')
    }
  }

  const loadEpisodes = async (sourceId: string, anime: AniSourceAnime) => {
    setLoading('episodes')
    setError(null)
    try {
      const result = await options.api.episodes(sourceId, anime.id, () => setSlow(true))
      const ordered = [...result].sort((a, b) => a.number - b.number)
      setEpisodes(ordered)
      const next = resolveEpisodeId(
        ordered,
        options.routeEpisodeId(),
        options.anime.nextAiringEpisode?.episode,
      )
      if (next) await chooseEpisode(next)
    } catch (cause) {
      reportError('Failed to load episodes.', cause)
    } finally {
      setLoading('')
    }
  }

  const runMatch = async (
    sourceId: string,
    saved?: MatchItem,
  ) => {
    setSelectedSource(sourceId)
    await options.persistence.setPreferredSource(sourceId)
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
      await loadEpisodes(sourceId, candidate)
      return
    }

    setLoading('match')
    setError(null)
    try {
      const titles = variants().map((variant) => variant.title)
      const found = new Map<string, AniSourceAnime>()
      let successfulSearches = 0
      let lastFailure: unknown
      for (const query of titles) {
        try {
          const result = await options.api.search(sourceId, query, 1, () => setSlow(true))
          successfulSearches += 1
          for (const candidate of result.items) found.set(candidate.id, candidate)
        } catch (cause) {
          lastFailure = cause
          console.warn(`Search for title “${query}” failed; continuing with the remaining titles.`, cause)
        }
      }
      if (!successfulSearches && lastFailure) throw lastFailure

      const result = matchFlow(titles, [...found.values()])
      setMatch(result)
      if (result.kind === 'auto') {
        const candidate = result.match.candidate
        setMatchedAnime(candidate)
        await options.persistence.saveMatch(options.anime.id, {
          sourceId,
          animeId: candidate.id,
          title: candidate.title,
        })
        await loadEpisodes(sourceId, candidate)
      }
    } catch (cause) {
      reportError('Failed to match this title.', cause)
    } finally {
      setLoading('')
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
    await options.persistence.saveMatch(options.anime.id, {
      sourceId,
      animeId: candidate.id,
      title: candidate.title,
    })
    await loadEpisodes(sourceId, candidate)
  }

  const openMatchPicker = () => {
    setMatch({ kind: 'picker', ranked: [] })
    setManualQuery(matchedAnime()?.title || titleOf(options.anime))
    setError(null)
  }

  const searchManualMatch = async (query: string) => {
    const sourceId = selectedSource()
    const trimmed = query.trim()
    if (!sourceId || trimmed.length < 2) return
    setPickerLoading(true)
    setError(null)
    try {
      const result = await options.api.search(sourceId, trimmed, 1, () => setSlow(true))
      const ranked = matchFlow(variants().map((variant) => variant.title), result.items)
      setMatch(ranked.kind === 'auto' ? { kind: 'picker', ranked: ranked.ranked } : ranked)
    } catch (cause) {
      reportError('Failed to search the source.', cause)
    } finally {
      setPickerLoading(false)
    }
  }

  let searchTimer: ReturnType<typeof setTimeout> | undefined
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
    await options.persistence.clearSavedMatch(options.anime.id)
    setMatchedAnime(null)
    setMatch(null)
    setEpisodes([])
    setSelectedEpisode(null)
    setServers([])
    setSelectedServer(null)
    setStreams([])
    await runMatch(sourceId)
  }

  const initialize = async () => {
    setLoading('sources')
    setError(null)
    setSlow(false)
    try {
      const result = await options.api.sources(() => setSlow(true))
      setSources(result.sources)
      if (!result.sources.length) return
      const saved = await options.persistence.getSavedMatch(options.anime.id)
      const preferred =
        options.sourceSearchParam() ??
        saved?.sourceId ??
        (await options.persistence.getPreferredSource())
      const sourceId =
        preferred && result.sources.some((source) => source.id === preferred)
          ? preferred
          : result.sources[0]!.id
      await runMatch(sourceId, saved ?? undefined)
    } catch (cause) {
      reportError('Failed to load streaming sources.', cause)
    } finally {
      setLoading('')
    }
  }

  const statusText = () => {
    if (slow()) {
      return 'The streaming source is waking up. The first response can take up to a minute.'
    }
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

  const selectedServerName = () =>
    servers().find((server) => server.id === selectedServer())?.name ?? 'This server'

  const dispose = () => {
    if (searchTimer) clearTimeout(searchTimer)
  }

  return {
    sources,
    selectedSource,
    matchedAnime,
    match,
    episodes,
    selectedEpisode,
    servers,
    selectedServer,
    streams,
    loading,
    error,
    slow,
    manualQuery,
    pickerLoading,
    pickerCandidates,
    sourceName,
    statusText,
    playerStage,
    selectedServerName,
    initialize,
    chooseSource,
    chooseEpisode,
    chooseServer,
    changeMatch,
    openMatchPicker,
    searchManualMatch,
    searchVariant,
    onManualQueryInput,
    dispose,
  }
}
