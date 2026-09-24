# Engineering standards

Task-triggered guidance for retry loops, flaky checks, and scope decisions. `AGENTS.md` is the primary project guidance and wins if anything here conflicts with it. Keep this document aligned with `AGENTS.md` rather than introducing a second policy.

## Failure, stopping, and scope

- Diagnose the cause before adding retries, defensive fallbacks, or recovery UI. Preserve distinct error kinds and retryability; cancellation is not a user-facing failure.
- After three failed attempts at the same problem, change approach or report the blocker with the evidence collected. Repeating the same unsuccessful approach is not progress.
- Before attributing a failure to infrastructure, reproduce it at least twice or find independent evidence. Once confirmed, use the appropriate retry or report the blocker instead of debugging infrastructure inline.
- If a test and a manual check disagree, determine which is wrong—including races and relevant edge cases. Never weaken or remove a failing test or type just to get a green check.
- Finish all required behavior. A workaround, silent degradation, placeholder, or TODO does not complete the request. Defer only genuinely separate work; file it as a GitHub Issue when appropriate, not as a code comment.

## Testing

- Tests are not the default for every change. Before adding one, identify a plausible incorrect implementation it rejects and the observable user-facing result that proves the behavior. Prefer fewer, sharper tests over broad coverage.
- Every real bug fix needs a regression test. Where feasible, confirm it fails for the bug before the fix; if reproduction is blocked, report that rather than adding a vacuous assertion.
- Focus tests on meaningful edge cases and boundaries: matching and ranking, navigation, persistence and migrations, stale responses, retry bounds, malformed external data, and transport failure branches.
- Drive public APIs and assert observable outcomes: rendered text and roles, returned values, navigation, and persisted records. Avoid tautologies, tests of constants or types, schemas parsing their own fixtures, markup snapshots, and callback-only wiring assertions.
- Mock external edges such as `fetch`, media libraries, and time—not application modules. Use real IndexedDB code with `fake-indexeddb` for persistence tests.
- Add a Playwright test when the contract crosses routes or cannot be exercised meaningfully in a focused test. Use the mocked API and accessible locators; do not gate CI on live AniList or AniSource services. Run live tests only when asked.
- Give each test one behavior, isolate storage and time, and avoid arbitrary sleeps. For UI changes, also follow the browser-check requirements in `AGENTS.md`.

## Performance and caching

- Remove unnecessary requests and serial waits between independent work first. Measure a suspected bottleneck before adding complexity, and do not claim unmeasured speedups.
- Do not hide latency with broad hover prefetch, another cache, or another retry loop. Follow `docs/architecture/cache-policy.md` for query keys, freshness, invalidation, and prefetch.
- Preserve the AniSource boundary: it is browser-only within mounted Watch and Reader sessions, through the client and same-origin gateway. Do not move its calls into SSR, loaders, prefetch, or shared layouts.
- Preserve lazy loading and image dimensions; keep playback libraries out of the shared initial bundle.

## Checks and delivery

- Use Bun and the narrowest relevant check from `AGENTS.md` and `package.json`. Docs-only and copy-only edits need `bun run lint`; markup and behavior changes need appropriate tests and browser review.
- `bun run verify` is the CI merge gate, not the default iteration loop. Follow the current `AGENTS.md` guidance on when to run it; when a check fails, diagnose with the affected focused check and get a passing final result where required.
- Work on a feature branch; `main` receives merges only. Commit and push only when asked, and stage only files belonging to the requested change. Never include secrets, generated builds, or unrelated work.
- When a push or PR is requested, inspect CI results and address genuine failures. For confirmed infrastructure flakes, follow the evidence and retry guidance above.
