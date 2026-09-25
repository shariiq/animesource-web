import { dehydrate, hydrate, QueryClient } from '@tanstack/solid-query'
import { createRouter } from '@tanstack/solid-router'
import { routeTree } from './routeTree.gen'
import { AniListError } from './data/anilist/client'

const PERSISTED_QUERY_CACHE_KEY = 'animesource:anilist-query-cache:v1'
const MAX_PERSISTED_QUERIES = 40
/** Upper bound for the serialized cache so burst navigation never throws a
 * quota error or blocks the main thread stringifying megabytes of rails. */
const MAX_PERSISTED_BYTES = 800_000

function restoreQueryCache(queryClient: QueryClient) {
  if (typeof window === 'undefined') return
  try {
    const raw = window.localStorage.getItem(PERSISTED_QUERY_CACHE_KEY)
    if (raw) hydrate(queryClient, JSON.parse(raw))
  } catch {
    window.localStorage.removeItem(PERSISTED_QUERY_CACHE_KEY)
  }
}

function persistQueryCache(queryClient: QueryClient) {
  if (typeof window === 'undefined') return
  try {
    const dehydrated = dehydrate(queryClient, {
      shouldDehydrateQuery: (query) =>
        query.state.status === 'success' &&
        query.queryKey[0] === 'anilist' &&
        query.queryKey[1] !== 'suggest',
    })
    dehydrated.queries.sort((left, right) => right.state.dataUpdatedAt - left.state.dataUpdatedAt)
    dehydrated.queries = dehydrated.queries.slice(0, MAX_PERSISTED_QUERIES)
    // Home rails are the heaviest entries: shrink the tail until the payload
    // fits the byte budget instead of failing the write (or a later read) on
    // quota-constrained browsers. At least the freshest entries survive.
    let serialized = JSON.stringify(dehydrated)
    while (serialized.length > MAX_PERSISTED_BYTES && dehydrated.queries.length > 10) {
      dehydrated.queries = dehydrated.queries.slice(0, Math.max(10, Math.floor(dehydrated.queries.length / 2)))
      serialized = JSON.stringify(dehydrated)
    }
    if (serialized.length > MAX_PERSISTED_BYTES) return
    window.localStorage.setItem(PERSISTED_QUERY_CACHE_KEY, serialized)
  } catch {
    // Storage is an optimization. Private browsing and quota failures must not
    // affect route loading or playback.
  }
}

export function createQueryClient() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 5,
        gcTime: 1000 * 60 * 60,
        retry: (failureCount, error) => {
          if (error instanceof AniListError && (error.status === 429 || error.options.cancelled)) return false
          return failureCount < 1
        },
      },
    },
  })
  restoreQueryCache(queryClient)

  if (typeof window !== 'undefined') {
    let persistTimer: number | undefined
    const schedulePersist = () => {
      if (persistTimer !== undefined) return
      const run = () => {
        persistTimer = undefined
        persistQueryCache(queryClient)
      }
      // Stringifying up to 40 queries can cost frames during burst navigation,
      // so persist when idle instead of 100ms after every cache write.
      const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback
      if (typeof idle === 'function') {
        persistTimer = idle.call(window, run, { timeout: 2000 })
        return
      }
      persistTimer = window.setTimeout(run, 800)
    }
    queryClient.getQueryCache().subscribe(schedulePersist)
  }

  return queryClient
}

export function getRouter() {
  const queryClient = createQueryClient()
  return createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: false,
  })
}
