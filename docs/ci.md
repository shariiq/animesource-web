# CI

Continuous integration has two independent tracks. They share nothing at runtime: the merge gate never touches the network beyond npm; the operational track never gates merges.

## Track 1 — `verify` (merge gate)

`.github/workflows/verify.yml` runs on every push and pull request. It is fully deterministic: AniList and AniSource are replaced by `tests/e2e/mock-api.mjs`, and neither live service is ever contacted. A red run here means the commit is broken and blocks the merge.

Two parallel jobs, Node 22.12.0:

- **`static`** — `npm run lint` (ESLint, zero warnings), `npm run typecheck` (strict TS), `npm run build` (Nitro `vercel` preset, emits `.vercel/output/`).
- **`test`** — Playwright Chromium install, `npm test` (Vitest, jsdom, mocked transports), `npm run e2e` (mocked Playwright). On failure it uploads `playwright-report/` and `test-results/` (traces, screenshots) as artifacts.

Runs are concurrency-canceled per ref, so a new push supersedes an in-progress run.

## Track 2 — `live smoke` (operational)

`.github/workflows/live-smoke.yml` runs on a schedule (twice daily) and manually via workflow dispatch — never on push or PR. `scripts/live-smoke.mjs` calls the real services:

- **AniList** — `GenreCollection` and the production five-rail home query, schema-validated against the production Zod contracts, with rate-limit (HTTP 429 + `Retry-After`) surfaced distinctly.
- **AniSource** — `/health` with bounded cold-start polling (4 attempts × 8s; retries only transient statuses), then `/api/v1/anime/sources` and the first-source search with up to 4 transient/timeout retries so a cold start can complete before the check reports a failure. The dependent search is recorded as non-blocking when no source list is available.

Results are written as a Markdown table to the GitHub Step Summary; the job exits nonzero on any failure and a follow-up step opens or comments on a single rolling issue ("Live smoke failed"). What a red run means: the deployed services or their contracts drifted — **not** that the branch is broken. It never blocks a merge or release.

## Local commands

```bash
npm run verify      # lint + typecheck + build + vitest + e2e (the gate, locally)
npm run test:live   # scripts/live-smoke.mjs against real services
```

Run `npm run verify` before opening a PR. Run `npm run test:live` when you want to check service health — expect AniSource cold-start latencies on the first call.
