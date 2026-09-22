import { describe, expect, it } from 'vitest'
import { AniSourceError } from '../app/data/anisource/client'
import { describeSourceFailure } from '../app/lib/source-session/errors'
import { runSourceMatchFlow } from '../app/lib/source-session/matchFlow'
import { createCancellableScope } from '../app/lib/source-session/scope'

describe('source session primitives', () => {
  it('keeps a settled request signal intact while removing it from the scope', () => {
    const scope = createCancellableScope()
    const operation = scope.restart()

    scope.finish(operation)

    expect(operation.signal.aborted).toBe(false)
    expect(scope.current(operation)).toBe(true)
  })

  it('aborts and invalidates older requests when a new generation starts', () => {
    const scope = createCancellableScope()
    const previous = scope.restart()
    const current = scope.restart()

    expect(previous.signal.aborted).toBe(true)
    expect(scope.current(previous)).toBe(false)
    expect(scope.current(current)).toBe(true)
  })

  it('continues failed title variants and returns the accumulated match', async () => {
    const failure = new AniSourceError('offline', 'network')
    const result = await runSourceMatchFlow({
      queries: ['Primary', 'Fallback'],
      search: async (query) => {
        if (query === 'Primary') throw failure
        return [{ id: 'manga-1', title: 'Fallback', alternative_titles: [] }]
      },
      isCurrent: () => true,
      onQueryFailure: () => 'continue',
    })

    expect(result?.result.kind).toBe('auto')
    expect(result?.candidates[0]?.id).toBe('manga-1')
    expect(result?.lastFailure).toBe(failure)
  })

  it('distinguishes unavailable backends and expired stream links', () => {
    expect(describeSourceFailure(new AniSourceError('bad gateway', 'http', 502), 'streams')).toMatchObject({
      kind: 'unavailable',
      retryable: true,
    })
    expect(describeSourceFailure(new AniSourceError('expired', 'http', 410), 'streams')).toMatchObject({
      kind: 'expired',
      retryable: true,
    })
  })
})
