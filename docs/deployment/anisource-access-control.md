# AniSource access control

The browser calls the same-origin `/api/anisource/*` TanStack server route. It never receives the AniSource API base URL or the service bearer token. The route is limited to `GET` and `HEAD`, validates operation-specific paths, query parameters, and successful JSON responses with the client's Zod schemas, checks same-origin request metadata, and rejects redirects rather than following them.

## Runtime controls

- The route mints a signed, HttpOnly, SameSite=Lax anonymous session cookie (Secure and `__Host-` in production). The session expires after 12 hours.
- Playback and reader media URLs are wrapped in HMAC tickets bound to the session, exact upstream path and query, and a 55-minute expiry. HLS child URLs retain the request's scope. Ticketed media is streamed; JSON and session-bound media are never shared-cached.
- Production rate limits use Upstash Redis: 240 requests per 10 seconds per session and 1,200 per 10 seconds per trusted Vercel client IP. Both must pass. Redis errors and missing production configuration fail closed. Local development skips the distributed limiter.
- The Upstash endpoint must use HTTPS; invalid or insecure URLs fail closed before the Redis token is sent.
- The API requires `Authorization: Bearer <service-token>` for every `/api/v1/*` route except its existing signed HLS and manga-page capability URLs. Public wildcard CORS was removed from catalog routes; CORS remains only for direct use of signed media capabilities. Root `/health` remains public for deployment liveness.
- The root document's `connect-src` policy allows same-origin traffic and the configured AniList GraphQL origin; local mock/HMR origins are included only in development.

These controls stop direct unauthenticated catalog/playback-metadata requests and keep the API origin out of normal browser requests. They are not user accounts: a determined visitor can create anonymous sessions and call the website gateway, so rate limiting is abuse control rather than proof of identity. A genuine account or subscription gate is a separate product decision.

## Required production configuration

Configure these values on the web application server. They are runtime server variables, not `VITE_` build variables:

| Web variable | Requirement |
| --- | --- |
| `ANISOURCE_BASE` | Optional; defaults to `https://anisource-api.vercel.app`. Production must use HTTPS. |
| `ANISOURCE_SERVICE_TOKEN` | Required; must exactly match the API's `MEDIA_API_SERVICE_TOKEN` and contain at least 32 bytes. |
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
