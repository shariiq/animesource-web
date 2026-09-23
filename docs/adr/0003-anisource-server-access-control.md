# ADR 0003: Server-side AniSource access control

**Status:** Accepted

## Context

The AniSource base URL was a `VITE_` value and the browser called its catalog and playback-metadata endpoints directly. A public build cannot safely hold a private API credential. Merely hiding the URL or checking `Origin` would not stop direct requests from scripts or command-line clients.

The API already issues signed, expiring HLS and manga-page URLs and keeps extractor-origin headers server-side. Those URLs are bearer capabilities, not account authentication.

## Decision

1. Route all website AniSource traffic through the same-origin TanStack server route `/api/anisource/*`. Only Watch and Manga Reader clients call it; discovery loaders remain AniSource-free. Validate each supported operation's path, query, and successful JSON response with the existing Zod contracts before returning it to the browser.
2. Keep the upstream base, shared service token, session signing secret, and Upstash credentials server-only. The API requires the shared bearer token for all `/api/v1/*` routes except its existing signed HLS and manga-page media routes.
3. Mint a signed HttpOnly anonymous session cookie. Require same-origin request metadata for the website gateway and apply shared per-session and trusted-client-IP rate limits. Only accept HTTPS for the Upstash REST endpoint so its token cannot be sent in cleartext.
4. Rewrite API media URLs to signed tickets bound to the anonymous session and exact path/query. Rewritten HLS child URLs carry the manifest's scope. The gateway streams media bytes and does not follow upstream redirects or accept arbitrary target URLs.
5. Mark API JSON responses private/no-store. Keep session-bound website media responses private and uncached. Restrict cross-origin API CORS to existing signed media capabilities; keep root `/health` public for platform liveness.
6. Exclude user accounts and identity-based quotas: this project has no account system today. Anonymous sessions and rate limits reduce casual/direct abuse but are not an identity gate.

## Consequences

The browser no longer sees the AniSource API origin or its shared key in normal network requests. Direct catalog calls without the key receive 401; missing required production configuration fails closed. The website function now sits in the media transfer path, streams without buffering complete files, and sacrifices shared CDN caching for session-bound media. This increases bandwidth and function-duration costs; a dedicated media edge is a separate future architecture.

Production requires the same random service token in the web and API environments, a separate web session secret, and Upstash REST credentials. These deployment values must be configured before media routes work. Project-level Vercel WAF rules remain an operator configuration rather than repository code.
