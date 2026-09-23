# Route and data ownership

This application keeps discovery data, playback orchestration, and viewer data in separate modules. A route may compose these modules, but it does not move their ownership into UI markup.

| Route / module | Owns | Does not own |
| --- | --- | --- |
| `/` Home | Home loader and AniList home query; hero and discovery rail composition | AniSource requests, IndexedDB, Explore filters |
| `/explore` Explore | Typed `BrowseSearch` URL state, AniList browse and genre loaders, result/error/empty presentation | Playback resolution or persistence records |
| `/anime/$animeId` Detail | AniList detail loader, metadata presentation, favorite action through `ViewerData` | Source matching, episode/server/stream state |
| `/anime/$animeId/watch/$episodeId` Watch | AniList detail loader plus mounted `createWatchSession` orchestration and playback presentation | Discovery query ownership, low-level IndexedDB transactions |
| `/manga/$mangaId` Manga detail | AniList manga detail loader, metadata presentation, favorite and reading actions | Source matching, chapter/page state |
| `/manga/$mangaId/read/$chapterNumber` Manga Reader | AniList manga detail loader plus mounted `createMangaReaderSession` orchestration and page presentation | Discovery query ownership, low-level IndexedDB transactions |
| `/profile` Profile | Local viewer profile presentation and account-state messaging | Authentication, remote account identity |
| `/settings` Settings | Viewer preferences, export/import, local deletion, provider import, and sync-state presentation | Authentication and provider credentials |
| `app/data/anilist` | GraphQL transport, response schemas, discovery query functions | Route navigation or viewer state |
| `app/data/anisource` | Browser-initiated REST client, typed errors/schemas, subtitle normalization, manga chapter/page requests; `proxy.server.ts` owns the server-only AniSource gateway | AniList metadata and route loaders |
| `app/lib/source-session` | Shared request cancellation/generation scope, source-match search flow, and transport failure descriptions used by Watch and Manga Reader | Route state, navigation, or durable persistence |
| `app/lib/persistence/indexedDb` | Browser-only IndexedDB connection and validated key/value transactions | Domain decisions and UI state |
| `app/lib/persistence/viewer` | Favorites, Continue Watching, preferred Source, and saved Match interface plus browser adapter | Search history and route rendering |
| `app/lib/persistence/mangaReader` | Versioned manga source match, chapter/page position, layout, direction, and completion records | Anime playback records and route rendering |
| `app/lib/persistence/searchHistory` | Search-history interface, limits, deduplication, and browser adapter | Favorites/library or playback records |
| `app/lib/persistence/active` | Route-facing `ViewerData` adapter seam | Provider-specific account or database behavior |
| `app/lib/persistence/snapshot` | Versioned snapshot merge rules and deletion conflict policy | IndexedDB transactions and route rendering |
| `app/lib/sync` | Remote viewer adapter interface, migration orchestration, status, retry, and partial-failure semantics | Authentication credentials and provider SDK details |

## Rules

- AniList loaders may execute during SSR for SEO and first paint.
- AniSource is only reached by the Watch or Manga Reader session after the route mounts in a browser, through `/api/anisource/*`. The gateway calls AniSource server-side; it is never a discovery loader or prefetch.
- Watch and Manga Reader own separate route state while sharing cancellation, match-search, and transport-error mechanics from `app/lib/source-session`.
- IndexedDB is browser-only. UI uses the domain interfaces and does not open a database or issue transactions itself.
- A future remote or synchronized viewer-data adapter should implement `ViewerData` without changing Detail or Watch presentation.
- Manga reading progress stays behind its own persistence interface so account sync can adopt it without coupling the Reader to a provider SDK.
- Viewer snapshot merges use timestamped records and deletion tombstones; see [ADR 0002](../adr/0002-local-first-viewer-data-sync.md).
- Query keys and cache policy are documented in [cache-policy.md](./cache-policy.md).
