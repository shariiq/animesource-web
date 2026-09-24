# Query and cache policy

The QueryClient is created per router instance in `app/router.tsx`; no query cache is shared between SSR requests. Unless an option overrides it, queries use a five-minute `staleTime` and a one-hour `gcTime`. Client-side successful AniList queries are also persisted in a bounded browser cache (the 40 most recently updated entries, excluding typeahead suggestions) so the hydrated client can reuse recent data. Storage failures are non-fatal; a full SSR document request still has its own server-side loader lifecycle.

| Query | Key | Freshness | Owner / SSR | Refetch and failure |
| --- | --- | --- | --- | --- |
| Home | `['anilist', 'home']` | 10 minutes | Home route loader; SSR allowed | Refetch when stale or invalidated; Home renders its query error state |
| Detail | `['anilist', 'detail', id]` | 10 minutes | Detail and Watch route loaders; SSR allowed | Refetch when stale or invalidated; route error state offers retry |
| By IDs | `['anilist', 'byIds', ids]` | 10 minutes | Discovery/library consumers; SSR allowed when a route owns it | Refetch when stale; consumer handles unavailable metadata |
| Browse | `['anilist', 'browse', params]` | 5 minutes | Explore loader and page; SSR allowed | Key changes with typed filters/search; Explore presents loading, empty, and error states |
| Suggestions | `['anilist', 'suggest', query]` | 10 minutes | Header SearchSurface only; client query, never a route loader | Enabled after a 320ms typing debounce; suggestions are not persisted because the key space is high-cardinality |
| Genres | `['anilist', 'genres']` | 24 hours | Explore loader and page; SSR allowed | Refetch when stale or invalidated; Explore keeps the filter control usable with its error state |
| Schedule | `['anilist', 'schedule', start, end]` | 5 minutes | Schedule route client query over a padded local day/week range | `keepPreviousData` keeps the previous range visible with an updating indicator while the next range loads; countdowns tick locally every 30 seconds with no interval refetch — stale ranges refetch on focus; the route presents skeleton loading, empty, and failure states |

## Invalidation and transport rules

There are currently no mutation paths that invalidate AniList query data. Route navigation changes the key or reuses the fresh cache. Route intent preloading is opt-in: only the primary Home, Library, and unfiltered first-page Explore links enable it. Explore pagination and anime-card links explicitly disable it so hovering them does not fan out into speculative AniList requests. External AniList responses are schema-validated and GraphQL `errors[]` are treated as failures rather than successful empty data.

The AniList client owns 429 handling: it honors `Retry-After` and `X-RateLimit-Reset`, banks an exhausted `X-RateLimit-Remaining: 0` window into a short shared cooldown, treats GraphQL `Too Many Requests` errors as rate limits, and performs at most one rate-limit retry. The schedule fan-out is serial with a small inter-page gap so paged week ranges never trip the undocumented burst limiter; query-level retries do not repeat a final 429 or a cancelled request; other failures receive at most one query retry. Query functions pass TanStack Query's abort signal through to the transport so abandoned route or typeahead work can stop.

AniSource has no Solid Query entries by design. Anime source, search, episode, server, and stream requests are interaction-driven methods on the Watch session. Manga source, search, chapter, and page requests are interaction-driven methods on the Manga Reader session. Both use the same-origin `/api/anisource/*` server gateway only after the route mounts in a browser; neither runs in SSR loaders, discovery, route prefetch, or shared-layout execution. Catalog JSON is private/no-store; rewritten manifests are private for at most 15 seconds; signed media bodies stream through the same-origin gateway and are private, never shared-cached. The active query-key contract contains no AniSource family because these operations do not have Query ownership.

Viewer data is not a global QueryClient cache. The `ViewerData`, `SearchHistory`, and `MangaReaderPersistence` interfaces remain local/remote adapter seams; IndexedDB reads and writes remain browser-only and validated at the adapter. Manga page images are not cached as application data; the reader uses the URLs returned by the validated AniSource page response.
