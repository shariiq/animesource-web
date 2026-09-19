import type { Episode } from '../../../data/anisource/schema'
import type { ContinueItem } from '../../../lib/persistence/viewer'

export function episodeRouteToken(episode: Episode): string {
  return `episode-${episode.number}`
}

export interface EpisodeNavigation {
  ordered: Episode[]
  currentIndex: number
  previous: Episode | null
  next: Episode | null
  reliable: boolean
}

export interface DefaultEpisodeOptions {
  requested: string
  latest?: ContinueItem | null
  scheduleEpisode?: number | null
  fromSchedule?: boolean
}

export type DefaultEpisodeReason =
  | 'explicit'
  | 'schedule-airing'
  | 'schedule-source-lag'
  | 'continue'
  | 'continue-next'
  | 'first'

export interface DefaultEpisodeSelection {
  episode: Episode | undefined
  reason: DefaultEpisodeReason
}

/**
 * Returns navigation only when the provider gives us a trustworthy numeric
 * order. Opaque IDs remain the identity used for every API request.
 */
export function selectDefaultEpisodeWithReason(
  episodes: readonly Episode[],
  options: DefaultEpisodeOptions,
): DefaultEpisodeSelection {
  const requested = options.requested
  const explicit = episodes.find((episode) => episodeRouteToken(episode) === requested || episode.id === requested)
  if (requested !== 'next') return { episode: explicit, reason: 'explicit' }

  const ordered = [...episodes]
    .filter((episode) => Number.isFinite(episode.number))
    .sort((left, right) => left.number - right.number)
  if (!ordered.length) return { episode: undefined, reason: 'first' }

  if (options.fromSchedule && options.scheduleEpisode != null) {
    const scheduled = ordered.find((episode) => episode.number === options.scheduleEpisode)
    if (scheduled) return { episode: scheduled, reason: 'schedule-airing' }
    const scheduleEpisode = options.scheduleEpisode
    const available = ordered.filter((episode) => episode.number < scheduleEpisode).at(-1) ?? ordered[0]
    return { episode: available, reason: 'schedule-source-lag' }
  }

  const latest = options.latest
  const latestIndex = latest ? ordered.findIndex((episode) => episode.id === latest.episodeId) : -1
  if (latestIndex >= 0) {
    return latest!.completed
      ? { episode: ordered[latestIndex + 1] ?? ordered[latestIndex], reason: 'continue-next' }
      : { episode: ordered[latestIndex], reason: 'continue' }
  }
  return { episode: ordered[0], reason: 'first' }
}

export function selectDefaultEpisode(
  episodes: readonly Episode[],
  options: DefaultEpisodeOptions,
): Episode | undefined {
  return selectDefaultEpisodeWithReason(episodes, options).episode
}

export function getEpisodeNavigation(
  episodes: readonly Episode[],
  currentEpisodeId: string | null,
): EpisodeNavigation {
  const ordered = [...episodes].sort((left, right) => left.number - right.number)
  const finite = ordered.every((episode) => Number.isFinite(episode.number))
  const unique = new Set(ordered.map((episode) => episode.number)).size === ordered.length
  const reliable = finite && unique && ordered.length > 0
  const currentIndex = ordered.findIndex((episode) => episode.id === currentEpisodeId)
  if (!reliable || currentIndex < 0) {
    return { ordered, currentIndex, previous: null, next: null, reliable }
  }
  return {
    ordered,
    currentIndex,
    previous: ordered[currentIndex - 1] ?? null,
    next: ordered[currentIndex + 1] ?? null,
    reliable,
  }
}
