import { describe, expect, it } from 'vitest'
import { canonicalIds, queryKeys } from '../app/lib/queryKeys'

describe('AniList id query keys', () => {
  it('uses the same batch cache identity for reordered or repeated IDs', () => {
    expect(canonicalIds([42, 7, 42, 11])).toEqual(canonicalIds([11, 7, 42]))
    expect(queryKeys.byIds([42, 7, 42, 11], 'MANGA')).toEqual(queryKeys.byIds([11, 7, 42], 'MANGA'))
  })
})
