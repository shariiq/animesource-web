import { dehydrate, hydrate, QueryClient } from '@tanstack/solid-query'
import { createRouter } from '@tanstack/solid-router'
import { routeTree } from './routeTree.gen'
import { AniListError } from './data/anilist/client'

const PERSISTED_QUERY_CACHE_KEY = 'animesource:anilist-query-cache:v1'
const MAX_PERSISTED_QUERIES = 40

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
    window.localStorage.setItem(PERSISTED_QUERY_CACHE_KEY, JSON.stringify(dehydrated))
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
    queryClient.getQueryCache().subscribe(() => {
      if (persistTimer !== undefined) return
      persistTimer = window.setTimeout(() => {
        persistTimer = undefined
        persistQueryCache(queryClient)
      }, 100)
    })
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
