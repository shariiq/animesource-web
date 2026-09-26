# ADR 0008: Gateway hardening against distributed extension reuse

**Status:** Accepted

## Context

ADR 0007 priced single-IP bulk scraping with proof-of-work sessions, automation pricing, and per-identity tripwires. Audit against the distributed threat (each end user runs a shipped client from a real residential IP with full HTTP/JS capability, never visiting the site) found six gaps: unsigned `server_id` replayed upstream verbatim, ticket-mode media fetches omitting service auth and capabilities, `cw:null`/`av`-unchecked exchanges that never rotted, issuance budgets permitting session-rotation farming, sessions and bearer media floating across networks, and bans that left outstanding tickets serving until expiry while ordinary per-user pacing sat far below every tripwire.

## Decision

1. **Validate `server_id` at the gateway.** Length plus control-byte, fetch-scheme, and loopback/private/link-local/metadata-host checks over the raw and base64-decoded value; rejects answer as unknown routes (404). The API enforces the same boundary at the trust point where identifiers become fetch targets (public-DNS resolution plus literal checks on the extractor transport, scheme/shape checks per Source, length caps at the router).
2. **Unify upstream auth.** Ticket-mode asset fetches carry the service Bearer like catalog, replay the preserved upstream signed query, and mint a fresh session playback capability server-side after the session/network/ban checks — tickets carry no browser-redeemable grant, so decoding one yields no direct-API access. Direct mode is unchanged (fail-closed capabilities). A joint contract test pins both modes.
3. **Enforce attestation freshness.** Schema requires `av` and `cw`; missing is 400 malformed, stale version or week is 426 upgrade-and-reload. `cw:null` no longer passes.
4. **Tighten issuance economics.** Challenge 30/min, exchange 5/min per network; escalation +2/+4 bits past 10/20 hits. One session per two hours is legitimate; farming pays full solve cost per rotation.
5. **Bind sessions to networks for media.** Sessions carry the required issuing-network fingerprint; Streams/Pages resolves and asset tickets from a drifted network answer 401 session-required (transparent re-verify), while metadata stays lenient across hops. No grandfathering: pre-binding cookies fail verification outright.
6. **Revoke media on ban, pace media issuance.** Asset tickets read standing denials (no telemetry writes, preserving the cheap byte path) and answer 429 immediately. Streams/Pages resolves count unsampled against a 30/10-min per-session media budget mapping to the existing session ban. Ticket lifetime drops 55→9 min, nesting inside the 10-minute capability (gateway expiry fires first); capability default drops 900→600 s with the interop vector updated on both suites (no grandfathering per the compat waiver).

## Consequences

- Per-user extension reuse still passes with a faithful reimplementation (documented residual: PoW prices compute, it does not prove viewing), but each identity now pays solves per rotation, per-network re-verification, tight media pacing, and short-lived media that dies on ban.
- Legitimate mobile→WiFi hops re-verify once for in-flight media; metadata never blocks on drift. Mid-movie tickets re-resolve through the existing expired-link refresh path.
- `curl`-grade and lazy-Chrome impersonation still die at the same gates; competent forgery is priced, not blocked, by construction.
- New operator reality: exchange budget and media pacing are the primary knobs under active scraping; difficulty is secondary.
