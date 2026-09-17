export interface HealthCheckResponse {
  version: string
  uptime_seconds: number
  memory_usage_mb: number
  active_sources: number
  cache_stats: {
    memory: number
    ttl: number
    size: number
  }
}

export interface SourceInfoResponse {
  id: string
  name: string
  base_url: string
}

export interface SourceListResponse {
  sources: SourceInfoResponse[]
  count: number
}

export interface AnimeSchema {
  id: number
  title: string
  url: string
  thumbnail: string | null
  description: string | null
  genres: string[]
  studios: string[]
  producers: string[]
  alternative_titles: string[]
  status: string
  score: number | null
  tags: string[]
}

export interface EpisodeSchema {
  id: number
  number: number
  title: string
  is_filler: boolean
  has_sub: boolean
  has_dub: boolean
  scanlator: string | null
  released_at: string | null
}

export interface ServerSchema {
  id: number
  name: string
  type: string
}

export interface StreamSchema {
  url: string
  quality: string
  headers: Record<string, string> | null
  subtitles: SubtitleSchema[] | null
  is_hls: boolean
}

export interface SubtitleSchema {
  url: string
  label: string
  language: string
}

export type SearchRequest = {
  q: string
  page?: number
}

export type SearchResponse = {
  items: AnimeSchema[]
  page: number
  has_next: boolean
  total_returned: number
}
