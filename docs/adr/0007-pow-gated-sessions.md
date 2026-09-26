# ADR 0007: Proof-of-work gated sessions for the AniSource gateway

**Status:** Accepted

## Context

Every gateway control so far verified the *request* (same-origin headers, request nonce, ticket signatures) while sessions were free: any client received one on first contact, and the request nonce was expiry-only with a 12-hour life, transferable across sessions. A scraper with a cookie jar therefore passed every check except rate limits. The missing property was session *issuance* bound to real computation.

## Decision

1. **Sessions are earned, not given.** Catalog, fallback, and asset routes require a live session; sessionless callers get a distinguishable `401 session-required` (never camouflage — the client must learn it has to verify). Health checks stay exempt for headerless monitors and keep the legacy mint-if-absent behavior. The request nonce is deleted as redundant: a PoW-backed session proves everything the nonce proved (recent HTML render in a JS engine), strictly stronger, and the two together were parallel ways of saying the same thing.
2. **Hashcash challenges, cheap to verify, expensive to stockpile.** `GET /api/anisource/challenge` mints `{id, exp, difficulty, binding, tag}` where tag is HMAC over all fields and binding is an HMAC of the request network. `POST /api/anisource/session` accepts `{challenge, solution: {nonce}}` with `SHA-256("{id}:{nonce}")` carrying `difficulty` leading zero *bits* (bit granularity doubles the work per step, unlike hex-char steps that jump 16x). Verification is one hash plus tag check — the verification path cannot itself be DoS'd. Difficulty defaults to 20 bits (~1M hashes: sub-second desktop, seconds on phones) via `ANISOURCE_POW_DIFFICULTY`, clamped to 1–30.
3. **Single-use enforced where it counts.** Challenge ids are spent atomically (Redis `SET NX EX` in production). Development without Redis intentionally allows reuse inside the freshness window — never rely on single-use there. Challenge and exchange endpoints carry tight per-IP budgets (60/20 per minute); over-budget answers are 429 with `Retry-After`.
4. **Short sessions.** Session lifetime drops from 12h to 2h. A harvested session rots quickly, so bulk abuse must keep solving. Capability (15 min) and ticket lifetimes nest inside it unchanged.
5. **Transparent recovery.** The browser client solves on first 401 and replays the original request exactly once; concurrent requests share one in-flight exchange. Solved state needs no UI: pending session work renders inside the existing loading states, and only a failed verification surfaces (retryable, "Complete the browser verification to continue"). Solvers run chunked off the critical path with abort support.
6. **Parallel search.** The solver fans out across Web Workers on disjoint nonce strides (near-linear speedup, fully off the main thread), falling back to sequential search where workers don't exist (SSR, tests) or fail to construct (CSP worker-src). Searches carry an attempt cap so misconfiguration fails loudly instead of spinning. The SHA-256 core uses typed arrays throughout.
7. **Adaptive difficulty without extra round trips.** Challenge issuance already counts per-network budget hits; past 30 hits/minute the minted difficulty rises +2 bits, past 45 +4 bits (clamped to the 30-bit ceiling). A lone browser does one challenge per session and never leaves its tier; whoever hammers issuance pays 4–16x per puzzle.

## Consequences

- `curl`-only scraping of the gateway is dead: every catalog call needs a JS engine plus seconds of compute per 2-hour session. Headless browsers still pass (proof-of-work prices computation, it does not prove humanity) — GPU farms trivialize SHA-256, so a future upgrade path is a memory-hard puzzle (Argon2id via WASM), deliberately deferred: it needs a new dependency and the current threat is CPU-bound scrapers, not mining rigs.
- First-visit catalog latency gains one challenge round trip plus solve time (milliseconds in tests at difficulty 8, ~1s real at difficulty 20). E2E pins difficulty low so journeys measure product behavior.
- New operator knob: `ANISOURCE_POW_DIFFICULTY`. Raise it under active scraping; lower it if low-end devices report slow verification. The config validator rejects absurd values.
- Removed: `requestNonce.ts`, the document nonce cookie, nonce sending/verification, and their tests. The HMAC-SHA256 primitive and RFC 4231 vectors moved to `proofOfWork.ts`, where the solver lives.
- Deliberately deferred: WASM SHA-256 (reach for it only if measured solve p95 exceeds ~3s on target devices at the deployed difficulty — dependency cost for headroom we don't need), and Argon2id (memory-hardness fights GPUs, but verification must stay one cheap hash or verification itself becomes the DoS vector the literature warns about; it also needs a new dependency).
