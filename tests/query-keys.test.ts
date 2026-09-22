import { describe, expect, it } from 'vitest'
import { canonicalIds, queryKeys } from '../app/lib/queryKeys'

describe('AniList id query keys', () => {
  it('deduplicates and sorts ids for stable cache identity', () => {
    expect(canonicalIds([42, 7, 42, 11])).toEqual([7, 11, 42])
    expect(queryKeys.byIds([42, 7, 42, 11], 'MANGA')).toEqual(['anilist', 'byIds', 'MANGA', [7, 11, 42]])
  })
})
