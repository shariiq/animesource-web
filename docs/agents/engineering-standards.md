# Engineering protocols

Task-triggered reference for `CLAUDE.md`; read the relevant section, not the whole file by default.

## Stopping rules

These limits prevent side quests, never authorize broken or partial delivery.

1. **Three strikes:** After three failed attempts at the same failure, stop that approach. Report what was tried and current evidence; satisfy the same requirement another way or ask for direction. Never call broken functionality a workaround.
2. **Fifteen minutes:** Defer genuinely unrelated bugs or nice-to-haves after ~15 minutes. If the requested feature fails, keep working or explicitly report being stuck; this limit does not apply.
3. **Infrastructure evidence:** Before blaming network, cold starts, rate limits, CI runners, or tooling, reproduce at least twice or find independent evidence (status indicator, a differing second run, documented limit). Once confirmed, avoid debugging infrastructure inline; use an appropriate retry or report the blocker.
4. **Test versus code:** When a test and manual check disagree, determine which is wrong, including edge cases/races the manual check may miss. Change a test only after establishing its expectation is incorrect. Never weaken/delete tests or types for green checks.
5. **Deferrals:** File genuinely separate follow-ups in repository GitHub Issues via `gh`, not code comments or silent stubs. A requested feature that fails is incomplete, not shipped with a footnote.

## Testing

Write tests in a batched pass at the end of a coherent, exercisable milestone, rather than alongside each function. Completion requires this pass. Usually 3–6 tests is a floor guideline, not a ceiling; scale to actual failure modes. Avoid unrelated coverage expansion and repeated suites after individual edits.

Priority:

1. Every real bug fix gets a regression test, including bugs encountered during implementation.
2. Pure logic: normal input, the concerning edge case, and a real sample pair for matchers/formatters.
3. Schema boundaries: malformed external data rejected/defaulted safely, per schema rather than per field.
4. API clients with mocked transport: AniList success, HTTP-200 `errors[]`, rate-limit/retry; AniSource success, timeout, cold start.

Default exclusions: component-state matrices (cover player/grid error-with-retry), loader tests outside watch, and coverage targets. Real regressions override these exclusions. Tests must fail for genuinely broken implementations.

No live-API CI gates. Optional live checks run as scheduled, non-blocking jobs opening issues on failure.

Defer E2E additions until the watch pipeline is feature-complete. Then default to two Playwright smoke journeys: search → detail → watch → player mount; and ambiguous match → picker → episode → server fallback. This is a default scope, not a hard cap on tests justified by actual bugs.

## Performance

- Use server-loader data for home/explore/detail SEO and first paint.
- Keep watch and HLS.js/YouTube embeds client-only through Solid `lazy()`, out of the shared/initial bundle.
- AniSource runs only on user interaction, never SSR or initial page load.
- Prefetch through router hover/intent. Set explicit image dimensions/aspect ratios; lazy-load below the fold.
- Every cache, including Solid Query, defines its key, `staleTime`/`gcTime`, invalidation trigger, and failure behavior.

## Git and CI

- Branch + PR by default; no direct main pushes, secrets, or unrelated commit changes. Commit/push only when asked.
- Pre-commit: format and lint changed files. Apply the root tier's before-push checks.
- Before opening a PR, run typecheck, build, and milestone tests locally at least once. CI rechecks; it is not the first check.
- After pushing, inspect CI. Fix genuine causes and push corrections within the authorized work. For confirmed infrastructure flakes meeting the evidence rule, rerun once and move on. Never weaken a test/type to force green.
