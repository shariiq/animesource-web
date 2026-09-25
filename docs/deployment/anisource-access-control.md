# AniSource access control

The browser calls the same-origin `/api/anisource/*` TanStack server route. It never receives the AniSource API base URL or the service bearer token. The route is limited to `GET` and `HEAD`, validates operation-specific paths, query parameters, and successful JSON responses with the client's Zod schemas, checks same-origin request metadata, and rejects redirects rather than following them. Requests failing the same-origin check get a response byte-identical to an unknown route (404), never a message naming the rule — confirming the route exists only teaches probers what to spoof.

## Runtime controls

- The route mints a signed, HttpOnly, SameSite=Lax anonymous session cookie (Secure and `__Host-` in production). The session expires after 12 hours.
- Playback and reader media URLs are wrapped in HMAC tickets bound to the session, exact upstream path and query, and a 55-minute expiry. HLS child URLs retain the request's scope. Ticketed media is streamed; JSON and session-bound media are never shared-cached.
- Catalog callers prove a recent site visit with a request nonce: the document response sets a short-lived HMAC cookie (`anisource-nonce`), and the browser client echoes it as `x-anisource-nonce` on catalog requests. Missing or stale nonces answer exactly like unknown routes. Media tickets stay exempt (image and media elements cannot send headers), as do health checks (headerless monitors). The nonce is a speed bump for naive replay scripts, not identity — rate limits remain the real abuse control.
- With `ANISOURCE_DIRECT_MEDIA=1` the gateway instead passes absolute API media URLs (segments, keys, subtitles, manga pages, playlists) through to the browser. Catalog JSON still resolves here, so the service credential stays hidden. Enable only after the API deployment sets short segment TTLs (`HLS_PROXY_SEGMENT_TTL`) and the site origin allowlist (`MEDIA_ALLOWED_ORIGINS`); see ADR 0004. Stale pre-flag tickets keep working through the gateway until they expire.
- Production rate limits use Upstash Redis: 240 requests per 10 seconds per session and 1,200 per 10 seconds per trusted Vercel client IP. Both must pass for catalog JSON. Session-bound media tickets (`/asset/*`) skip the web limiter — the URLs are unguessable, the API enforces its own proxy rate limit, and charging every HLS segment and manga image against Upstash added round trips to each media fetch. Redis errors and missing production configuration fail closed. Local development skips the distributed limiter.
- Abuse-control ownership is split by layer on purpose: the website limiter guards catalog JSON (search/match/chapters/streams metadata), while the API's own proxy rate limiter guards media bandwidth. Neither layer assumes the other is present, so keep both enabled in production rather than "simplifying" to one.
- Gateway failures carry `X-AniSource-Error-Kind` (`rate-limited`, `misconfigured`, `invalid`, plus the transport kinds) so the browser reports throttling and credential problems honestly instead of as network errors. An upstream 401 on a service-authenticated catalog request is translated to a `misconfigured` outage naming `ANISOURCE_SERVICE_TOKEN`, because passing it through would make sessions report "expired stream links" and burn refresh budgets on an outage no retry can heal.
- The Upstash endpoint must use HTTPS; invalid or insecure URLs fail closed before the Redis token is sent.
- The API requires `Authorization: Bearer <service-token>` for every `/api/v1/*` route except its existing signed HLS and manga-page capability URLs. Public wildcard CORS was removed from catalog routes; CORS remains only for direct use of signed media capabilities. Root `/health` remains public for deployment liveness.
- The root document's `connect-src` policy ships as a per-request response header (browsers ignore CSP meta tags added after the initial document): same-origin traffic plus the configured AniList GraphQL origin, with local mock/HMR origins only in development. In direct-media mode the API origins from server runtime configuration are appended; they never enter the client bundle (see `verify:boundary`).

These controls stop direct unauthenticated catalog/playback-metadata requests and keep the API origin out of normal browser requests. They are not user accounts: a determined visitor can create anonymous sessions and call the website gateway, so rate limiting is abuse control rather than proof of identity. A genuine account or subscription gate is a separate product decision.

## Required production configuration

Configure these values on the web application server. They are runtime server variables, not `VITE_` build variables:

| Web variable | Requirement |
| --- | --- |
| `ANISOURCE_BASE` | Optional; defaults to the AniSource value in `config/api-urls.json`. Production must use HTTPS. |
| `ANISOURCE_FALLBACK_BASE` | Optional second upstream origin; defaults to the fallback URL in `config/api-urls.json`, empty disables it. |
| `ANISOURCE_SERVICE_TOKEN` | Required; must exactly match the API's `MEDIA_API_SERVICE_TOKEN` and contain at least 32 bytes. When a fallback origin is configured, its deployment must accept the same token. |
| `ANISOURCE_SESSION_SECRET` | Required; unique random value of at least 32 bytes, used to sign sessions and asset tickets. |
| `UPSTASH_REDIS_REST_URL` | Required in production. |
| `UPSTASH_REDIS_REST_TOKEN` | Required in production; keep private. |

Configure `MEDIA_API_SERVICE_TOKEN` and `MEDIA_API_REQUIRE_SERVICE_TOKEN=true` on the API. Vercel defaults to requiring the token; Render's `render.yaml` also requires it. Store one randomly generated service token in both deployments. Generate independent secrets with Node, for example:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Use one generated value for the shared API service token and a separate generated value for the web session secret. Add the Upstash REST URL/token from the Redis database settings. Set Preview and Production environments before testing Watch or Manga Reader; without these values the web gateway intentionally returns 503, and the API fails closed rather than serving catalog data.

The scheduled public smoke sends no secret: it expects an unauthenticated catalog request to receive 401. It does not exercise authenticated search/playback. Vercel WAF rules can reject abusive traffic earlier, but are project-level infrastructure and are not configured by this repository change.

## Known trade-off

The website server streams signed images, captions, and video bytes so the browser sees only its own origin. Since the outer media ticket is session-bound, the website responds with private cache headers and cannot use a shared CDN cache safely. This adds website function duration and bandwidth cost compared with loading AniSource's signed media URLs directly. The API continues to stream upstream bytes without buffering whole media files; no dedicated media edge is added here.

## Fallback origin

`ANISOURCE_FALLBACK_BASE` points at a second API deployment that acts as the
overflow origin (see ADR 0005): catalog operations and manga pages serve
from the primary origin while video operations (streams) prefer the
overflow deployment, keeping bulk video bandwidth off primary. Either class
moves on measured latency or origin-health failures.
Media tickets stay origin-bound either way, so a switch never disturbs
in-flight playback or reading. Without the variable the shared default in
`config/api-urls.json` applies; set it empty to disable the overflow
entirely, in which case origin failures surface without an alternate
attempt. Catalog requests follow the active origin through the matching
gateway prefix; media tickets are origin-bound, so an overflow ticket never
resolves against the primary origin. Mounted Watch and Reader sessions also
fire one throttled, best-effort warm ping at the overflow health endpoint so
a sleeping deployment is already waking when overflow is first needed;
failures stay silent by design.
