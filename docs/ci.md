# CI

Continuous integration has two independent tracks. They share nothing at runtime: the merge gate never touches the network beyond package installation; the operational track never gates merges.

## Track 1 — `verify` (merge gate)

`.github/workflows/verify.yml` runs on pull requests and on pushes to `main`. It is fully deterministic: AniList and AniSource are replaced by `tests/e2e/mock-api.mjs`, including the manga source, chapter, and page responses used by the reader journey. Neither live service is ever contacted. A red run here means the commit is broken and blocks the merge.

Three parallel jobs, Node 22.12.0. Bun and Playwright downloads are cached; Vitest and Playwright run side by side instead of back to back:

- **`static`** — `bun run lint` (ESLint, zero warnings), `bun run typecheck` (strict TS), `bun run build` (Nitro `vercel` preset, emits `.vercel/output/`).
- **`unit`** — `bun run test` (Vitest, jsdom, mocked transports).
- **`e2e`** — Playwright Chromium install, `bun run e2e` sharded 2 ways across parallel jobs (the suite is one serial spec file sharing a single mock API, so workers can't parallelize it — each shard boots its own mock API and dev server). On failure each shard uploads `playwright-report/` and `test-results/` (traces, screenshots) as artifacts.

Runs are concurrency-canceled per ref, so a new push supersedes an in-progress run. Pushes to `main` only verify the merged result; PR pushes run exactly once via the `pull_request` event instead of twice (once as `push`, once as `pull_request`).

## Track 2 — `live smoke` (operational)

`.github/workflows/live-smoke.yml` runs on a schedule (twice daily) and manually via workflow dispatch — never on push or PR. `scripts/live-smoke.mjs` calls the real services:

- **AniList** — `GenreCollection` and the production five-rail home query, schema-validated against the production Zod contracts, with rate-limit (HTTP 429 + `Retry-After`) surfaced distinctly.
- **AniSource** — `/health` with bounded cold-start polling (4 attempts × 8s; retries only transient statuses), followed by an unauthenticated `/api/v1/anime/sources` request. HTTP 401 proves the catalog gate is active; this public workflow intentionally never sends the service credential and does not test authenticated source search.

Results are written as a Markdown table to the GitHub Step Summary; the job exits nonzero on any failure and a follow-up step opens or comments on a single rolling issue ("Live smoke failed"). What a red run means: the deployed services or their contracts drifted — **not** that the branch is broken. It never blocks a merge or release.

## Local commands

```bash
bun run verify      # lint + typecheck + build + vitest + e2e (the gate, locally)
bun run test:live   # scripts/live-smoke.mjs against real services
```

Run `bun run verify` before opening a PR. Run `bun run test:live` when you want to check service health and the unauthenticated access gate — expect AniSource cold-start latencies on the first call.
