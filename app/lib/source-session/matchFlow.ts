import { matchFlow, type MatchResult, type TitleCandidate } from '../../data/matching'

/**
 * Shared multi-query source-match flow for the watch and reader sessions:
 * search each title variant in order, accumulate unique candidates, and stop
 * early once the matcher can auto-select. Returns `null` when the operation
 * went stale mid-flight so callers simply bail out.
 */
export interface SourceMatchFlowOptions<T extends TitleCandidate> {
  /** Title variants used both for searching and for ranking candidates. */
  queries: readonly string[]
  /** Cap on how many variants are actually searched; ranking still uses all. */
  maxQueries?: number
  /** Single source search returning the raw candidate items. */
  search(query: string): Promise<T[]>
  /** False once the owning session operation has been superseded. */
  isCurrent(): boolean
  /**
   * Called when a single query fails. Return `'continue'` to try the next
   * variant (the failure is remembered) or `'abort'` to rethrow immediately.
   */
  onQueryFailure?: (cause: unknown, query: string) => 'continue' | 'abort'
}

export interface SourceMatchFlowOutcome<T extends TitleCandidate> {
  /** Unique candidates across all attempted queries, first-seen order. */
  candidates: T[]
  result: MatchResult<T>
  /** Last per-query failure when the flow continued past it. */
  lastFailure: unknown
}

export async function runSourceMatchFlow<T extends TitleCandidate>(
  options: SourceMatchFlowOptions<T>,
): Promise<SourceMatchFlowOutcome<T> | null> {
  const found = new Map<string, T>()
  let lastFailure: unknown
  const searches = options.queries.slice(0, options.maxQueries ?? options.queries.length)

  for (const query of searches) {
    try {
      const response = await options.search(query)
      if (!options.isCurrent()) return null
      for (const item of response) found.set(item.id, item)
      if (matchFlow(options.queries, [...found.values()]).kind === 'auto') break
    } catch (cause) {
      if (options.onQueryFailure?.(cause, query) === 'continue') {
        lastFailure = cause
        continue
      }
      throw cause
    }
  }

  if (!options.isCurrent()) return null
  return { candidates: [...found.values()], result: matchFlow(options.queries, [...found.values()]), lastFailure }
}
