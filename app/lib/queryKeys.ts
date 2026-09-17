export const queryKeys = {
  home: ['anilist', 'home'] as const,
  detail: (id: number) => ['anilist', 'detail', id] as const,
  browse: (params: Record<string, unknown>) => ['anilist', 'browse', params] as const,
  suggest: (query: string) => ['anilist', 'suggest', query] as const,
  genres: ['anilist', 'genres'] as const,
  schedule: (start: number, end: number) => ['anilist', 'schedule', start, end] as const,
  byIds: (ids: readonly number[]) => ['anilist', 'byIds', [...ids]] as const,
} as const
