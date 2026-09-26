export function canonicalIds(ids: readonly number[]): number[] {
  return [...new Set(ids)].sort((left, right) => left - right)
}

export const queryKeys = {
  home: (mode: string = 'ANIME') => ['anilist', 'home', mode] as const,
  detail: (id: number, mode: string = 'ANIME') => ['anilist', 'detail', mode, id] as const,
  browse: (params: Record<string, unknown>, mode: string = 'ANIME') => ['anilist', 'browse', mode, params] as const,
  suggest: (query: string, mode: string = 'ANIME') => ['anilist', 'suggest', mode, query] as const,
  genres: ['anilist', 'genres'] as const,
  byIds: (ids: readonly number[], mode: string = 'ANIME') => ['anilist', 'byIds', mode, canonicalIds(ids)] as const,
} as const
