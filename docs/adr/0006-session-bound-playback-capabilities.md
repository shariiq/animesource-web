# ADR 0006: Session-bound playback capabilities for direct media

**Status:** Accepted

## Context

ADR 0003 routes every byte through the website gateway as session-bound asset tickets. ADR 0004 adds the `ANISOURCE_DIRECT_MEDIA=1` opt-in, which hands browsers raw API bearer URLs for speed. Live benchmarking confirmed the speed motive, but direct mode downgrades authorization to bare bearer tokens: anyone holding a playlist URL plays it until the registry TTL expires, with no session binding and no API-side knowledge that a website session authorized the playback. The two token systems (website asset tickets, API registry tokens) do not know about each other, and ancillary checks (origin allowlists, nonces) are spoofable speed bumps. This ADR unifies them into one capability both edges speak.

## Decision

### 1. One capability format, minted by the website, verified by the API

- Token: `v1.<encoded>.<sig>`, where `encoded` is base64url of JSON with **sorted keys and compact separators**, and `sig` is base64url of `HMAC-SHA256(secret, "playback-cap-v1:<encoded>")`, compared in constant time.
- Claims (`zod`-validated website-side, structurally validated API-side): `{v: 1, kid, scope, sid, iat, exp}`.
  - `kid` = first 8 hex chars of `sha256(secret)`; verifiers accept a primary plus one previous secret (dual-accept rotation).
  - `scope` = `hex(sha256(apiPathToken))` — binds the capability to one exact API registry token, so a capability cannot be replayed across streams.
  - `sid` = first 32 hex chars of `sha256(website session sid)` — forensic binding only; the API holds no session state and never validates the session itself.
  - `exp - iat` = 600s default (`ANISOURCE_PLAYBACK_TTL`); verifiers allow 60s clock-skew leeway on both ends. (Amended from 900s by the ADR 0008 hardening: shorter replay window, no grandfathering.)
- Secret: `ANISOURCE_PLAYBACK_SECRETS` (website, comma-separated, first entry signs) / `MEDIA_API_PLAYBACK_SECRETS` csv (API, verify-only, order irrelevant), each entry ≥32 bytes. Outside production the website falls back to its existing server-secret derivation so local dev works with no env. Direct mode with no resolvable secret fails closed (503 `misconfigured`), matching the service-token and limiter conventions.

### 2. Enforcement matrix (API: configured secrets mean enforced capabilities)

One uniform rule: **every media request needs a capability whose scope matches the requested path token.** The website scopes top-level URLs (playlists, pages, subtitles as returned by catalog JSON); the API re-scopes capabilities into each URL it mints during playlist rewrites (variants, keys, segments), inheriting identity and lifetime without extending either. Re-scoping is deterministic, so playlist memoization varies on the capability fingerprint instead of fragmenting. Failures are **403** (never 410: a capability failure is not fixed by refetching the same URL; the website client re-resolves streams, and its player already maps 401/403/410 to silent recovery).

### 3. TTL ladder (keys shortest — the current 1800s key window is the most generous setting in the system)

Keys ~60–120s (hls.js fetches once and caches client-side, so short key TTLs never interrupt playback), segments per existing `HLS_PROXY_SEGMENT_TTL`, playlists per entry-capability expiry. Mid-episode playlist revalidation after capability expiry recovers through the existing silent re-resolve path.

### 4. Share detection (log first, enforce second)

Per-instance bounded tracker (`cap fingerprint → distinct client IPs`, fingerprint = `sha256(cap)`): ≥2 IPs within the capability window flags sharing; flagged fingerprints join a bounded denylist consulted before registry resolve (denylist works for stateless signed tokens, which have no per-token revoke). Per-instance state is the accepted pattern (mirrors the existing proxy rate limiter); distributed enforcement stays an operator concern (WAF).

### 5. Scraper defenses (all safe by construction: none touch valid-token or same-origin browser flows)

- API: `/robots.txt` disallow-all (server-to-server API; no legit crawler); honeypot tarpit (2–5s jittered delay + warn log) on scanner-only paths (`/.env`, `/.git/`, `/wp-*`, `/phpmyadmin`, `/actuator`, `/server-status`, …) — legitimate traffic never requests these; progressive backoff on service-token 401s; 50–250ms jitter on 401/403 only (never on 410 recovery or media bytes); API docs (`/docs`, `/redoc`, `/openapi.json`) disabled outside debug (route inventory is currently public).
- Website: honeypot paths under `/api/anisource/` tarpit then answer the existing 404 camouflage; nonce-failure camouflage keeps its shape (timing jitter only, still indistinguishable).
- Explicitly out of scope: retaliation against scanners, poisoned content (never serve false data — it breaks the "errors are data" contract and risks legitimate clients), and anything that delays valid-token media.

### 6. Rollout (API first, website second — mirrors ADR 0004)

There is no enforcement flag: presence of secrets is the switch, and production without them refuses to start. Roll out by configuring secrets first, then deploying:

1. Set `MEDIA_API_PLAYBACK_SECRETS` on the API deployment and `ANISOURCE_PLAYBACK_SECRETS` on the website, then deploy the API. Verification code ships inert until a request carries a `cap` parameter — unknown params are ignored, zero behavior change.
2. Deploy the website (caps minted on direct-mode URLs; harmless extra query param until step 1 is live everywhere the site points at).
3. No step three: enforcement is live as soon as secrets exist on both sides. Stale pre-cap URLs die at registry TTL. Roll back by deploying the previous build, not by flipping a flag that no longer exists.

## Fixed interop vector (asserted by both suites)

Secret: `test-playback-capability-secret-0123456789`. Token `master-token-abc`, session `test-session-sid`, `iat` 1750000000, `exp` 1750000600 (600s TTL):

```
v1.eyJleHAiOjE3NTAwMDA2MDAsImlhdCI6MTc1MDAwMDAwMCwia2lkIjoiZjkyYzQ4NTgiLCJzY29wZSI6IjY5N2JhNjYxNzIyODk4YTk4YTRmODJmOGMwMDQzMjlhNzdjYmQxNTJjOWNkM2IyODQ3OTI5NzM4NmE3MDg5MTEiLCJzaWQiOiJkNjI3ZTc0M2NjYjUwZmIxYjMwZmFmN2JhNTlkOTIzMyIsInYiOjF9.W-xDn2W_eByNhrh13mmhcCQqS3q7lJI4qA6c5MVne9E
```

(`kid` `f92c4858`, `scope` `697ba6…08911`. Both suites mint/verify this byte-identically.)

## Consequences

- Direct mode keeps its speed (bytes still fly direct; one HMAC verify ≈ microseconds per request, no I/O on the hot path) and gains session binding: a copied URL without the victim's `HttpOnly` session context is useless, and replay is bounded by capability expiry rather than registry TTL.
- `ANISOURCE_PLAYBACK_SECRETS` / `MEDIA_API_PLAYBACK_SECRETS` join the secret-sync set with dual-accept rotation; Vercel env changes need redeploys.
- 403s on media now have two authors (website ticket vs API capability); both sides keep distinct error kinds in logs.
- Honest ceiling (unchanged): an authorized viewer can still save bytes inside the window or re-record. Every leak is small, short, attributable, and unscalable — the most any non-DRM system promises.
