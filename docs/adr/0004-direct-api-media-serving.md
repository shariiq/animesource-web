# ADR 0004: Direct API media serving

**Status:** Accepted

## Context

ADR 0003 routes every AniSource byte through the website gateway as session-bound asset tickets. That hides the API origin but puts a serverless function in the media data path, marks every media response private (defeating shared CDN caching entirely), and pays function duration for each segment. Production playback showed intermittent slow-but-200 segments consistent with upstream trickle amplified by two function hops, while the API already mints short-lived, cross-viewer-stable signed media URLs with immutable VOD segment cache headers.

## Decision

1. Add an explicit opt-in, `ANISOURCE_DIRECT_MEDIA=1`. When set, the gateway passes absolute API media URLs (segments, keys, subtitles, manga pages, playlists) through to the browser instead of wrapping them in asset tickets. Catalog JSON — including `/streams` resolution — still resolves through the gateway, so the service credential never leaves the server. Relative URLs and the ticket machinery are unchanged.
2. Keep the default off (session-bound tickets). Enable in production only after the API deployment sets `HLS_PROXY_SEGMENT_TTL` short and `MEDIA_ALLOWED_ORIGINS` to the site origin, so exposed bearer URLs carry a small replay window plus a hotlink check.
3. The upstream-host guard understands the mode: in direct mode the gateway intentionally surfaces API media URLs, so the 502 backstop only applies to ticketed mode.
4. The document `connect-src` policy moves from a static meta tag to a per-request response header carrying the API origins in direct mode. API origins come from server runtime env during SSR and never enter the client bundle (`verify:boundary` enforces this); without the header, hls.js segment fetches would be CSP-blocked.

## Consequences

- Media bytes skip the website function: lower TTFB/variance and VOD segments become edge-cacheable for the first time. Upstream trickle still trickles — one less middleman, not a faster origin.
- The API origin becomes visible to visitors; per-session gateway limits no longer cover media bytes. Remaining controls are the API's per-IP limiter, short expiring bearer URLs, and the origin allowlist — weaker than session binding, matching standard signed-URL delivery. Vercel WAF stays an operator configuration.
- Rollout order matters: API hardening first, website flag second. Stale pre-flag tickets keep working through the gateway until they expire.
