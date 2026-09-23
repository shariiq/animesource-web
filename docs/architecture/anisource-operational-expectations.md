# AniSource operational expectations

## Dependency contract

AniSource provides source search, episode lists, servers, and stream manifests for Watch, plus source search, chapter lists, and page URLs for the mounted Manga Reader route. The browser calls the same-origin `/api/anisource/*` gateway only during user-initiated Watch/Reader work; the gateway talks to AniSource from the server:

- AniList owns discovery, schedule, detail metadata, and all server-rendered loader data.
- AniSource must **never** run in an AniList loader, SSR request, route prefetch, discovery route, or shared layout. The server gateway must not be treated as a discovery data loader.
- `createWatchSession` is the sole production caller for anime source → Match → Episode → Server → Stream resolution.
- `createMangaReaderSession` is the sole production caller for manga source → Match → Chapter → Page resolution. It loads the full chapter list from `/chapters`; `/update` is not a reader data source.
- Browser IndexedDB stores the viewer's Match, source preference, playback ledger, manga reading position, reader preferences, and profile preferences. AniSource response data is not durable viewer state.

This separation means an AniSource outage cannot prevent browsing, searching, or reading an Anime or Manga detail page.

The gateway uses an HttpOnly signed anonymous session, session-bound tickets for signed HLS/manga assets, same-origin request checks, and shared Upstash limits in production. The AniSource service token remains server-only. The gateway streams signed media but disables shared caching because its tickets are session-bound; this intentionally trades CDN reuse for access control.

## Timeout, cold start, and retries

The client uses one abortable request per operation with these current limits:

| Policy | Value | Purpose |
| --- | ---: | --- |
| Slow-response signal | 4.5 seconds | Warn that a cold backend may still be waking up. |
| Request timeout | 25 seconds | End a stalled request with a typed timeout rather than leaving the Watch UI stuck. |
| Transport retries | 0 | Do not duplicate provider calls or silently mask source/server failures. |
| Health retry | 1 bounded retry | Bound the initialize-time Source health probe. A manual stream retry resolves the Server directly; its outcome updates Source health. |
| Manual stream retries | 2 after the initial attempt | Refresh an expired or transient Stream without creating an unbounded provider loop. |
| HLS recovery | 1 network recovery and 1 media recovery per Stream load | Recover common player faults once, then expose the provider failure. |
| Source-list cache TTL | 10 minutes, in-browser client instance | Avoid repeated anime or manga source-list calls while evicting rejected promises immediately. |

A timeout is presented as a cold-start-capable condition, not as proof that a provider is permanently unavailable. Caller cancellation is silent and never becomes an error state. Invalid payloads are not retried. The source picker remains enabled whenever AniSource has supplied a list, so viewers choose an alternate Source explicitly rather than being silently switched.

## Health and failure semantics

The optional `/health` request is schema-validated and reports backend-wide `status`, `version`, `uptime_seconds`, `memory_usage_mb`, `active_sources`, and backend-owned `cache_stats` fields. It is a capability probe for the selected Source, not a claim that an individual upstream host has a playable Stream.

Watch records health per selected Source as `unknown`, `checking`, `healthy`, `degraded`, or `unavailable`:

- `healthy`: the backend reported `ok` and at least one active Source;
- `degraded`: a timeout/network/other non-terminal health failure or reduced availability;
- `unavailable`: an upstream 502/503/504 health failure;
- `unknown`: a Source whose health has not been checked in this Watch session.

Health is scoped to the mounted Watch session. It is not a server singleton, shared SSR cache, or discovery-time probe. Source-specific outcomes refine this capability probe: a successful Server or Stream resolution marks that Source healthy; timeout/network failures mark it degraded; repeated upstream 502/503/504 failures mark it unavailable. Alternate Source selection ranks healthy Sources first, then untested Sources, while unavailable Sources are not presented as the automatic fallback.

Stream diagnostics expose only safe context: operation, classified error kind, retry count, selected Source name/id, and selected Server name/id. They never render Stream URLs, request headers, backend bodies, cookies, or credentials. HTTP 401, 403, and 410 while resolving a Stream are classified as an expired Stream; the viewer can request a fresh Stream from the selected Server or choose another Server/Source.

## Browser telemetry and launch gates

Useful browser telemetry aggregates must remain privacy-safe and avoid Stream URLs:

- Watch stage transition duration (source list, Match, episodes, Servers, Stream);
- cold-start signal and typed result (`timeout`, `network`, `invalid`, `expired-stream`, `unavailable-server`, `media`);
- selected Source/Server identifier, not headers or URLs;
- manual retry and alternate Source/Server selection counts;
- backend `/health` version, uptime bucket, active-source count, and cache-stat keys when telemetry is explicitly enabled.

Before production launch or capacity expansion, establish and observe:

1. availability and latency objectives for `/health`, source lists, search, episodes, chapters, pages, Servers, and Streams;
2. cold-start rate and p95 wake duration against the 25-second timeout;
3. capacity limits for concurrent source/stream resolution and upstream provider error budgets;
4. dashboard/alert ownership for a sustained increase in typed timeouts, 5xx health failures, expired Streams, or empty server lists;
5. an incident runbook that confirms AniList browsing remains independent while Watch is degraded.

## Capacity, uptime, and observability targets

These are launch expectations, not claims about the current public AniSource deployment. The deployment owner must attach measured results to the release record before public launch or a capacity increase.

| Area | Expectation | Evidence required |
| --- | --- | --- |
| Availability | 99% monthly availability for `/health` and the source-list endpoint, excluding planned maintenance. | Monthly uptime report and incident links. |
| Warm latency | p95 below 5 seconds for search, Episodes, Chapters, and Servers; p95 below 10 seconds for Pages and Streams. | Scheduled live smoke latency samples. |
| Cold start | The cold-start rate and p95 wake duration remain visible against the 25-second client timeout. | Live smoke history with timeout/error-kind counts. |
| Capacity | The maximum safe concurrent source/Stream resolution count and each upstream provider's error budget are recorded before launch. | A repeatable load check owned by the deployment operator. |
| Alerts | Alert on sustained timeout/network failures, 5xx health failures, expired Streams, and empty Server lists. | Dashboard links, alert thresholds, and an on-call owner. |
| Privacy | Telemetry contains operation, typed error, Source/Server identifiers, and timing only; never Stream URLs, headers, cookies, or credentials. | Event-schema review and sampled payload inspection. |

The browser models and displays the safe diagnostic context needed for the Watch UI and retry decisions. A production telemetry sink remains an operational deployment concern; until one is configured, the release is not allowed to claim that uptime or capacity objectives are measured.
