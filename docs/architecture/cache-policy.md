# Query and cache policy

The QueryClient is created per router instance in `app/router.tsx`; no query cache is shared between SSR requests. Unless an option overrides it, queries use a five-minute `staleTime`, a one-hour `gcTime`, and one retry.

| Query | Key | Freshness | Owner / SSR | Refetch and failure |
| --- | --- | --- | --- | --- |
| Home | `['anilist', 'home']` | 10 minutes | Home route loader; SSR allowed | Refetch when stale or invalidated; Home renders its query error state |
| Detail | `['anilist', 'detail', id]` | 10 minutes | Detail and Watch route loaders; SSR allowed | Refetch when stale or invalidated; route error state offers retry |
| By IDs | `['anilist', 'byIds', ids]` | 10 minutes | Discovery/library consumers; SSR allowed when a route owns it | Refetch when stale; consumer handles unavailable metadata |
| Browse | `['anilist', 'browse', params]` | 5 minutes | Explore loader and page; SSR allowed | Key changes with typed filters/search; Explore presents loading, empty, and error states |
| Suggestions | `['anilist', 'suggest', query]` | 10 minutes | Header SearchSurface only; client query, never a route loader | Enabled for queries longer than one character; SearchSurface presents pending, empty, or temporary-unavailable state |
| Genres | `['anilist', 'genres']` | 24 hours | Explore loader and page; SSR allowed | Refetch when stale or invalidated; Explore keeps the filter control usable with its error state |
| Schedule | `['anilist', 'schedule', start, end]` | 10 minutes | Reserved for the future schedule route | Refetch when stale or invalidated; schedule consumer must present unavailable data distinctly |

## Invalidation and transport rules

There are currently no mutation paths that invalidate AniList query data. Route navigation changes the key or reuses the fresh cache. External AniList responses are schema-validated and GraphQL `errors[]` are treated as failures rather than successful empty data.

AniSource has no Solid Query entries by design. Source, search, episode, server, and stream requests are interaction-driven methods on the Watch session. They must not run in SSR, discovery loaders, route prefetch, or initial shared-layout execution. The unused AniSource key family has been removed from the active query-key contract rather than suggesting cache ownership that does not exist.

Viewer data is not a global QueryClient cache yet. The `ViewerData` and `SearchHistory` interfaces are the replacement seam for a future local/remote adapter; IndexedDB reads and writes remain browser-only and validated at the adapter.
