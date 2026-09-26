# AniSource access control

The browser calls the same-origin `/api/anisource/*` TanStack server route. It never receives the AniSource API base URL or the service bearer token. The route is limited to `GET` and `HEAD`, validates operation-specific paths, query parameters, and successful JSON responses with the client's Zod schemas, checks same-origin request metadata, and rejects redirects rather than following them. Requests failing the same-origin check get a response byte-identical to an unknown route (404), never a message naming the rule — confirming the route exists only teaches probers what to spoof.

## Runtime controls

- The route mints a signed, HttpOnly, SameSite=Lax anonymous session cookie (Secure and `__Host-` in production). The session expires after 2 hours and carries the issuing-network fingerprint. Metadata stays lenient across network hops; media resolution (Streams, Pages) and asset tickets require the current network to match, answering drift with a distinguishable 401 (`session-required`) so the browser re-verifies transparently. Sessions are earned, not given: every gateway route but health requires a live session, and sessions are issued only for a solved proof-of-work challenge (ADR 0007, hardened by ADR 0008). Sessionless catalog callers get a distinguishable 401 (`session-required`) so the browser client learns it must verify before retrying — never camouflage, which would hide the recovery path from the client too.
- Proof-of-work challenges (`GET /api/anisource/challenge`) are HMAC-signed, expire in 5 minutes, and bind the requesting network; solutions are verified with one hash and each challenge id is spent exactly once (Redis in production, reusable-in-window in development). Challenge and exchange endpoints carry tight per-IP budgets (30/5 per minute). Default difficulty is 20 leading zero bits (`ANISOURCE_POW_DIFFICULTY`); each bit doubles the work. Networks burning issuance budget earn +2/+4 bits past 10/20 hits. Exchanges require a current attestation schema version and client week (missing values are malformed 400, stale values are 426 upgrade); suspicious sessions get a 20-minute TTL and pre-burn the network's challenge budget into the escalation tiers, and in production they resolve metadata but never media (streams and manga-page lists answer 403 `automation`; stealth clients pass by construction).
- Abuse tripwires assume unique residential IPs per operator, so IP reputation is dead by design and only per-identity behavior is judged: sampled per-session velocity (~1500 requests/10 min → 30-minute ban), session sharing across networks (HyperLogLog distinct IPs > 10 → 60-minute ban), unsampled per-session media pacing (30 Streams/Pages resolves per 10 min → 30-minute ban; one resolve serves a whole Episode or Chapter, so human pacing is single digits), and pre-auth probing floods (200+ sessionless hits/10 min → 15-minute network ban scoped to sessionless and challenge paths, leaving valid sessions behind shared NAT untouched). All surface as 429 with Retry-After; asset-ticket media reads check standing bans without telemetry writes (Redis-cheap), so banned sessions stop serving bytes immediately instead of lingering out the ticket lifetime.
- The Streams `server_id` query replays upstream verbatim, so the gateway refuses internal-pivot shapes before they leave this deployment (control bytes, non-HTTP fetch schemes, loopback/private/link-local/metadata hosts in the raw or base64-decoded value answer as unknown routes). Public-host fetching stays upstream territory: Sources legitimately resolve third-party embed hosts, so the API must allowlist them there.
- Playback and reader media URLs are wrapped in HMAC tickets bound to the session, exact upstream path and query, network fingerprint, and a 9-minute expiry that nests inside the 10-minute playback capability (gateway expiry fires first; refresh pulls a fresh capability too). Ticket-mode asset fetches carry the service Bearer upstream like catalog, replay the preserved upstream signed query, and additionally bind a session playback capability when secrets resolve. HLS child URLs retain the request's scope. Ticketed media is streamed; JSON and session-bound media are never shared-cached.
- With `ANISOURCE_DIRECT_MEDIA=1` the gateway instead passes absolute API media URLs (segments, keys, subtitles, manga pages, playlists) through to the browser, each carrying a session-bound playback capability (ADR 0006, default 600 s via `ANISOURCE_PLAYBACK_TTL`) instead of a bare bearer. Catalog JSON still resolves here, so the service credential stays hidden. Enable only after the API deployment sets short segment TTLs (`PROXY_SEGMENT_TTL_SECONDS`) and the site origin allowlist (`MEDIA_ALLOWED_ORIGINS`), and only with `ANISOURCE_PLAYBACK_SECRETS` set — without it the gateway fails closed in production. See ADR 0004. Stale pre-flag tickets keep working through the gateway until they expire. Direct-mode playback is verified by the API against the shared secrets, which never consult website session bans: cap replay is bounded by the 10-minute capability expiry, and pushing website bans to the API's cap-fingerprint denylist (ADR 0006 §4) stays an operator follow-up.
- Production rate limits use Upstash Redis: 240 requests per 10 seconds per session and 1,200 per 10 seconds per trusted Vercel client IP. Both must pass for catalog JSON. Session-bound media tickets (`/asset/*`) skip the web limiter — the URLs are unguessable, the API enforces its own proxy rate limit, and charging every HLS segment and manga image against Upstash added round trips to each media fetch. Redis errors and missing production configuration fail closed. Local development skips the distributed limiter.
- Abuse-control ownership is split by layer on purpose: the website limiter guards catalog JSON (search/match/chapters/streams metadata), while the API's own proxy rate limiter guards media bandwidth. Neither layer assumes the other is present, so keep both enabled in production rather than "simplifying" to one.
- Gateway failures carry `X-AniSource-Error-Kind` (`rate-limited`, `misconfigured`, `invalid`, plus the transport kinds) so the browser reports throttling and credential problems honestly instead of as network errors. An upstream 401 on a service-authenticated request (catalog or media) is translated to a `misconfigured` outage naming `ANISOURCE_SERVICE_TOKEN`, because passing it through would make sessions report "expired stream links" and burn refresh budgets on an outage no retry can heal.
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
| `ANISOURCE_PLAYBACK_SECRETS` | Required in production when direct media is on; comma-separated, first entry signs and the rest verify during rotation, each at least 32 bytes. Binds direct-mode media URLs to the requesting session (ADR 0006). |
| `ANISOURCE_PLAYBACK_TTL` | Optional; capability lifetime in seconds (default 900). |
| `UPSTASH_REDIS_REST_URL` | Required in production. |
| `UPSTASH_REDIS_REST_TOKEN` | Required in production; keep private. |

Configure `MEDIA_API_SERVICE_TOKEN` on the API. Vercel and Render deployments fail startup without it; local development stays open. Store one randomly generated service token in both deployments. Generate independent secrets with Node, for example:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Use one generated value for the shared API service token, a separate generated value for the web session secret, and a third for playback capabilities (shared with the API's `MEDIA_API_PLAYBACK_SECRETS`). Add the Upstash REST URL/token from the Redis database settings. Set Preview and Production environments before testing Watch or Manga Reader; without these values the web gateway intentionally returns 503, and the API fails closed rather than serving catalog data.

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
