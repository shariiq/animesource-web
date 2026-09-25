# AGENTS.md

AnimeSource is a SolidJS + TanStack Start app. AniList GraphQL supplies discovery and metadata through server loaders. AniSource REST supplies anime playback and manga reading, browser-only, through the same-origin `/api/anisource/*` gateway. Domain vocabulary is in `CONTEXT.md`; use its terms (Source, Candidate, Match, Server, Stream, Chapter, Page) in code and prose.

This file holds what the code cannot tell you. When it and the code disagree, the code wins: finish the task and name the discrepancy in your summary. 

## Commands

Bun only: `bun install --frozen-lockfile`, `bun run <script>`, `bunx <tool>`. Scripts live in `package.json`.

- Iterate with the narrowest check: `bun run typecheck`, `bun run lint`, `bunx vitest run tests/<file>`, `bunx playwright test -g "<title>"`.
- NEVER run `bun run verify` or `bun run verify:boundary` unless a huge part of codebase is changed. CI runs both (they need a full build). Diagnose and confirm your work with the focused checks above. If Playwright's browser is missing, run `bunx playwright install chromium`.
- Docs-only changes need no automated check: lint doesn't validate prose or paths, so review those directly. Copy-only edits in source files need `bun run lint`. Markup or behavior changes are not copy-only.
- Local checks use mocks and disposable fixtures with no production access. Run them, fix failures your change caused, and rerun without asking. A plain dev server is not mocked.
- `bun run test:live` hits real AniList/AniSource. Run it only when asked; it never gates a merge.

## Done means

Finish the requested outcome end to end before stopping. A task is done when all of these hold:

1. Every part of the request is implemented and wired through every surface it touches, including callers and code the change made obsolete. No stubs, placeholder data, dead controls, fabricated success, or TODO comments.
2. Every state the change introduces and can actually reach (loading, empty, error, retry, IndexedDB unavailable) renders something deliberate.
3. The focused checks that cover the change pass, or you report the exact failing check and why.
4. Your summary covers what changed and why, tradeoffs that matter, the commands you actually ran with results, and anything unhandled, out of scope, or left as a follow-up. Keep automated checks, manual checks, and checks not performed distinct.

Broken required behavior is incomplete, not a follow-up. After three failed attempts at the same problem, change approach or report the blocker with evidence.

Ask first only when the answer could change the design: adding a dependency, adding module-level mutable state, changing a persisted record shape, editing an accepted ADR, or a choice that alters product behavior or a security boundary. For minor reversible choices, state the assumption and continue.

## Writing code here

Before writing a helper, search for one that already exists (`app/lib/`, `app/data/`, the query-key factory). Match the surrounding code's patterns and change only what the task needs. No drive-by refactors, renames, or reformatting. Delete all dead code, including code your change makes obsolete. Don't preserve backwards compatibility in code. Comments explain *why* something non-obvious is done, never what the code already says.

**SolidJS, not React.** Component bodies run once; reactivity lives in the accessors you call.
- Read props lazily as `props.x`. Destructuring breaks reactivity; use `splitProps`/`mergeProps` to split or default props.
- Derive values with plain functions or `createMemo`. Keep `createEffect` for syncing with the outside world (DOM, media element, storage), not for copying one signal into another.
- Use `<Show>`, `<For>`, `<Switch>/<Match>`. There are no hooks, dependency arrays, or re-renders.
- Release listeners, timers, observers, and media instances with `onCleanup`. Playback libraries stay client-only and out of the shared initial bundle.
- `eslint-plugin-solid` flags most slips. Fix the code rather than disabling the rule; a disable needs a `--` reason, as the existing ones have.

**Model state honestly.** Multi-state results are discriminated unions on `kind` (see `MatchResult`, `SourceFailure`). Handle each branch exhaustively; don't stack booleans. Fix the modeled type instead of reaching for `as`, `any`, `!`, or `@ts-expect-error`. A genuine library typing limit goes in a narrow adapter with the invariant explained.

**Errors are data, not silence.** Fix the cause before adding defensive handling. Classify failures where they enter the app into typed kinds with a retryable flag, and surface them in the UI. Catch only where the failure is expected and handling it is part of the design. Never return a success-shaped default (empty list, zero, null) for a failure or for malformed data, and never report success before the operation succeeds. Keep specific failures specific. Best-effort features may degrade gracefully; required behavior may not silently disappear. For AniList, HTTP-200 `errors[]`, 429 rate limits, and network failures are three distinct branches.

**Async work goes stale.** Watch and Reader session requests run through the cancellable scope and generation machinery in `app/lib/source-session/`. Changing Source, Episode, Server, or Chapter invalidates in-flight work; unmount releases it. Pass abort signals through to `fetch`, but aborting alone is not enough: a late response must not overwrite current state or persist progress for the wrong selection. Cancellation is not a user-facing failure.

**Validate at every boundary with Zod:** AniList responses, AniSource responses, and IndexedDB reads. Derive types with `z.infer` rather than declaring the shape twice. A default for missing data needs a contract that permits it.

**Performance.** First remove unnecessary requests and serial waits between independent operations. Measure a suspected bottleneck before adding complexity, and don't claim unmeasured speedups. Don't hide latency with broad hover prefetch, another cache, or a second retry loop. Preserve image dimensions and below-the-fold lazy loading.

## Architecture invariants

These are load-bearing. Each has a reason, so apply the reason to cases the rule doesn't name.

- **AniSource stays out of SSR and shared code.** Only a mounted Watch or Reader session calls it, via `app/data/anisource/client.ts` and the gateway. Loaders, prefetch, and shared layouts never do. Reason: the upstream host and credential must never reach the browser bundle, and discovery must not spend AniSource quota. CI's `verify:boundary` checks the built output. Preserve the gateway's validation and access controls.
- **Server-only secrets.** `ANISOURCE_*` and `UPSTASH_*` are runtime server variables. A `VITE_` prefix on any of them ships the secret to every visitor.
- **No cross-request state.** The QueryClient is created per router instance. Module-level mutable state touched during SSR leaks between users, and browser APIs must not run in server execution.
- **Viewer data is local-first IndexedDB** (favorites, progress, matches, search history) behind the interfaces in `app/lib/persistence/`. UI consumes those interfaces through resources and never opens a database. Distinguish loading, unavailable storage, and empty data. Initialization defaults must never overwrite saved data. Persisted shapes are versioned: a shape change needs a schema version and a migration that keeps old records readable. This concerns users' saved data, not code compatibility. The bounded query-cache mirror in `app/router.tsx` is the only other browser storage.
- **Routes are deep-linkable and code-split.** Watch is `/anime/$animeId/watch/$episodeId?source=`; Manga Reader is `/manga/$mangaId/read/$chapterNumber?source=`. Neither is embedded in its detail route. Chapter lists come from `/chapters`, never the update endpoint or feed.
- **Caching.** Query keys, `staleTime`, invalidation, and prefetch follow `docs/architecture/cache-policy.md`. AniSource state is session-owned, not Solid Query-owned.
- **Generated code:** don't edit `app/routeTree.gen.ts`; the router plugin regenerates it.

## UI

Visuals follow `docs/adr/0001-editorial-material-system.md`: tokens from `app/styles/theme.css`, shared treatments in `app/styles/recipes.css`, composition in route styles. When a design calls for an exact value that has no token, add a token. comick.dev, MangaDex, and nothing.tech are direction references only; never copy their markup or copy.

Baseline: semantic elements, full keyboard operation, visible focus, labelled controls, `prefers-reduced-motion`.

When a change alters layout, visuals, or interaction, check it once in a browser at desktop width and once at about 390px, exercising the changed controls and navigation and any loading, empty, or error states it introduces. A screenshot alone is not enough, and passing tests do not establish visual quality. Logic-only changes inside a component skip this.

## Tests

Test quality over quantity. A test earns its place when it would fail for a bug a user would notice and would **still pass after a correct refactor**. Before adding one, ask: what plausible wrong implementation would this reject, and what observable result proves it? Expected values come from the requirement or an independent fixture, never from the code under test. Write fewer, sharper tests. Zero new tests is the right answer for style, copy, and pure refactors that existing tests already cover; say so in your summary.

These are the situations where a test may be warranted, not a checklist. Before writing one, check whether an existing test already covers the behavior and extend it instead of adding a file. Cover related cases (typed failure branches, edge inputs) with one table-driven test, not one test per case.
- Every real bug fix: a regression test. When it's cheap (a single fast Vitest file), confirm it fails for the right reason before the fix. If reproduction is blocked, say so rather than writing a vacuous assertion.
- Logic with real edge cases: matching and ranking, episode and chapter navigation, snapshot merge and tombstones, persistence migrations, stale-response races, bounded retries.
- Boundary schemas: malformed required identity is rejected, and documented optional data is handled safely.
- Transport clients: success, each typed failure branch, retry limits.

Don't write:
- Tautological tests, or tests that restate the implementation or assert that a mock returned what you configured it to.
- Tests of constants, types, or a schema parsing its own fixture.
- Markup snapshots, prop pass-through, or "callback was called" wiring checks. An interaction assertion is right only when the interaction is the contract: no AniSource request before mount, no write after cancellation, bounded retries.
- Mocks of our own modules. Mock only at the edges: `fetch`, hls.js, time. IndexedDB uses real code over `fake-indexeddb`.

Drive the public API the way callers do, and assert observable outcomes: returned values, rendered text and roles, persisted records, navigation. "Source A resolving after a switch to B cannot overwrite B's state" is the kind of assertion to aim for, not "the mock returns this list." Name each test after the behavior it protects; one behavior per test, with isolated storage and time and no arbitrary sleeps. Vitest lives in `tests/` (jsdom, `tests/setup.ts`). Mocked Playwright journeys live in `tests/e2e/` against `tests/e2e/mock-api.mjs`, using accessible locators and web-first assertions; add one only for a cross-route flow a unit test can't reach. Delete tests for code you removed. Otherwise never weaken or delete a failing test or type to get green unless the user changed the feature it tests: first think whether the test or the code is wrong.

## Git

Work on a feature branch. `main` receives merges only. Commit and push only when asked. Never commit secrets, generated builds, or unrelated work. List follow-ups in your summary; file GitHub Issues on `shariiq/animesource-web` with `gh` (see `docs/agents/issue-tracker.md`) only when asked.

## Read more when the task needs it

- A retry loop, a flaky check, or tempted to defer work: `docs/agents/engineering-standards.md`.
- Which route or module owns a piece of data: `docs/architecture/ownership.md`.
- Making or questioning a durable decision: `docs/adr/` (process in `docs/agents/domain.md`). Record accepted new decisions in an ADR.
- Gateway, session, or rate-limit setup: `docs/deployment/anisource-access-control.md`.

## Maintaining this file

Add a line only after an agent makes the same mistake twice, and delete lines the code or tooling now enforces. Keep it free of file inventories, versions, and counts; those belong to the code.