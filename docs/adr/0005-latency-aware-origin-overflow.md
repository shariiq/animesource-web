# ADR 0005: Latency-aware origin overflow

**Status:** Accepted

## Context

ADR 0003 routes AniSource traffic through the website gateway with a
primary origin and a last-resort fallback origin, used by the Watch session
only for streams after its expired-ticket budget runs out. The Manga Reader
has no second origin at all. Both deployments in `config/api-urls.json` are
live API deployments, so the fallback shape underuses the second one: every
origin-health failure on any operation, in either session, surfaces without
ever trying the healthy deployment.

A naive active-active split is worse than the status quo. The overflow
origin sleeps when idle (free-tier cold starts cost tens of seconds), and
media tickets are origin-bound, so splitting must happen per session scope,
never per request.

## Decision

1. Route inside the browser AniSource client (`overflowBaseUrl`), not in
   sessions: every catalog operation gets passive, per-instance routing
   state. Watch and Reader sessions pass the overflow client through their
   existing `api` option unchanged.
2. Learn only from real outcomes: the existing cold-start signal marks slow
   calls, and only origin-health failures (timeout, network, 502/503/504)
   switch origins. Expired tickets, rejected routes, throttling,
   credential outages, and cancellations never switch — rate limits apply
   per session regardless of origin, and both deployments share one
   service token (a shared-token outage homes traffic to primary).
3. Switches are sticky with bounded cost: a switchable failure alternates
   once per call; two slow calls switch only toward an origin with a recent
   success (a slow origin still beats a sleeping one); three
   consecutive recent failures fast-path new calls past the outage, and the
   exiled preferred origin gets one recovery probe per window. No probes, no
   retry loops, no persisted state.
4. Delete the Watch-only explicit fallback machinery (`fallbackApi`,
   fallback warm-ups, streams last-resort re-resolution). Per-operation
   overflow subsumes it; primary-side expired-ticket refresh already
   re-extracts, so the fallback re-extract added only deployment diversity
   at the cost of a second code path. The content-source `fallbackSource`
   picker is unrelated and stays.
5. Prefer per operation class, not per deployment: catalog metadata stays on
   primary while operations that mint media-byte URLs (streams, manga
   reader pages) prefer overflow, keeping video bandwidth off the primary
   deployment. Each class converges its own routing state with identical
   mechanics; the exiled preferred origin of either class is probed back
   on the same window.

## Consequences

- Origin-health failures on any operation now recover transparently in both
  sessions; the Reader gains a second origin for the first time.
- Expired-ticket recovery is unchanged (budgeted primary refresh, then a
  terminal error with no origin consulted).
- First use of a long-idle overflow origin can still be slow, bounded by
  the existing client timeout; slow-triggered switches never target a cold
  origin. Mounted sessions fire one throttled best-effort warm ping to
  narrow that window; it is upkeep, not a probe — silent, and never on a
  critical path.
- `ANISOURCE_FALLBACK_BASE` keeps its name and gateway semantics; "fallback"
  now reads as the overflow deployment rather than a streams-only last
  resort.
