# AnimeSource — agent instructions

> Replacement draft, not an additional instruction layer. Codex does not automatically load `agents2.md`. To adopt it, replace root `AGENTS.md` with this content and remove this note; make `CLAUDE.md` a pointer to `AGENTS.md` rather than a duplicate.

SolidJS + TanStack Start. AniList GraphQL owns discovery and metadata through server loaders. Mounted Watch and Reader sessions initiate AniSource requests in the browser through `/api/anisource/*`; the gateway forwards them server-side. Use the domain vocabulary in `CONTEXT.md`, especially Source, Candidate, Match, Server, Stream, Chapter, and Page.

## Working agreement

Deliver the smallest coherent change that satisfies the requested behavior. Optimize for correctness and readable data flow, not cleverness, file count, or test volume.

- For non-trivial work, identify the observable outcome, owning module, and likely failure modes. Read the affected implementation, callers, and relevant tests. Follow the references below as needed, not as a mandatory reading list. Small fixes need no repository-wide audit or formal plan.
- Reuse sound local patterns, not incidental complexity. Check `package.json` and `bun.lock`; consult version-matched official documentation when an API is uncertain. Do not apply React advice to Solid or upgrade dependencies as a side quest.
- Proceed with ordinary implementation and deterministic local checks. Ask about unresolved choices affecting product behavior, data compatibility, security boundaries, accepted ADRs, or new runtime dependencies. State minor reversible assumptions and continue.
- Preserve unrelated work. Include necessary callers, migrations, and removal of code made obsolete by the change; avoid drive-by renames, reformatting, and speculative extension points.

## Boundaries

- **AniSource:** only mounted Watch or Reader sessions use `app/data/anisource/client.ts`. Loaders, prefetch, discovery, and shared layouts stay AniSource-free; `bun run verify:boundary` checks the build. The server-only gateway is intentional. Preserve its validation and access controls. `ANISOURCE_*` and `UPSTASH_*` are server-only runtime variables; a `VITE_` prefix leaks them.
- **Routes:** Watch is `/anime/$animeId/watch/$episodeId?source=`; Reader is `/manga/$mangaId/read/$chapterNumber?source=`. Both are deep-linkable, code-split, and separate from detail presentation. `createWatchSession` and `createMangaReaderSession` own their orchestration. Chapter lists come from `/chapters`, never the update endpoint.
- **SSR:** create the QueryClient per router instance. Ask before adding module-level mutable state reachable during SSR; its lifetime must not leak across requests. Browser APIs stay out of server execution; playback libraries stay client-only and out of the shared initial bundle.
- **Persistence:** viewer data is versioned, Zod-validated IndexedDB behind `app/lib/persistence/` interfaces. UI consumes resources, not raw transactions. Distinguish loading, unavailable storage, and empty data; initialization defaults must not overwrite saved data. The bounded query-cache mirror in `app/router.tsx` is the only other browser storage.
- **External data:** parse AniList, AniSource, and IndexedDB inputs with Zod at trust boundaries; internal code consumes validated types. AniList HTTP-200 `errors[]`, HTTP 429, and network failures remain distinct. Never disguise malformed data or failure as successful empty results. Defaults require a contract that permits missing data.
- **Caching:** follow `docs/architecture/cache-policy.md` for keys, freshness, invalidation, retries, and prefetch. AniSource is session-owned, not Solid Query-owned. Do not add broad hover prefetch, another cache, or a second retry loop to conceal latency.

## Implementation judgment

- **Solid reactivity:** components execute once. Read props lazily as `props.x` or accessors; use `splitProps`/`mergeProps` when needed, not destructuring or eager copies. Use signals, memos, resources, `<Show>`, and `<For>`. Derive state instead of synchronizing duplicate signals with effects. Clean up owned listeners, timers, observers, and media instances with `onCleanup`.
- **Cohesion over fragmentation:** keep presentation in components, orchestration in sessions, parsing in adapters. Extract functions for meaningful decisions or dependency boundaries, not arbitrary line limits. Local duplication can be preferable to coupling unrelated behaviors through an abstraction.
- **Truthful types:** model states with discriminated unions where they exclude impossible combinations. Distinguish loading, empty, failure, and success where behavior differs. Fix the model rather than hiding errors with casts, `any`, non-null assertions, or suppression. Isolate genuine library typing limitations in a narrow adapter and explain the invariant.
- **Async ownership:** changing Source, Episode, or Chapter invalidates obsolete work; unmount releases it. Reuse `app/lib/source-session/` cancellation/generation machinery. Aborting alone cannot guarantee that late responses will not overwrite current state or persist progress for the wrong selection. Cancellation is not a user-facing failure.
- **Recovery:** handle errors where a real fallback or bounded retry exists. Preserve useful error context; never swallow a required failure or report success before an operation succeeds. Best-effort features may degrade gracefully, but required behavior may not silently disappear.
- **Readability and performance:** use domain names and direct control flow. Comments explain constraints and tradeoffs, not obvious operations. First remove unnecessary requests and serial waits between independent operations. Measure suspected bottlenecks before adding complexity; do not claim unmeasured speedups. Preserve image dimensions and below-the-fold lazy loading.

## UI acceptance

Follow `docs/adr/0001-editorial-material-system.md`: semantic tokens in `app/styles/theme.css`, shared treatments in `app/styles/recipes.css`, composition in route styles. Reuse tokens; add one when an exact reference value is missing. comick.dev, MangaDex, and nothing.tech provide direction, not markup or copy to reproduce.

Use semantic elements, accessible names, keyboard operation, visible focus, and `prefers-reduced-motion`. Check the changed flow in a browser at desktop and about 390px, including relevant loading/empty/error states. Exercise controls and navigation; a screenshot alone is insufficient. Ship no dead controls, fabricated success, or stubbed production data. Tests do not establish visual quality.

## Tests that earn their maintenance cost

Before adding a test, answer: **what plausible wrong implementation would this reject, and what observable result proves it?** Expected results come from the requirement or an independently understood fixture, not the same helper or algorithm under test.

- **Bug fixes:** add or strengthen a focused regression test. Where feasible, confirm it fails against unfixed behavior for the right reason, then passes with the fix. Report blocked reproduction rather than replacing it with a vacuous assertion.
- **New behavior:** cover meaningful decisions, schema contracts, and failure/state transitions. Use the lowest-cost layer that exposes the bug: pure logic, adapter/session integration, or browser journey. Existing coverage may suffice for refactors; cosmetic/docs changes need no invented tests. No test-count or coverage quota.
- **Controlled edges:** keep the subject under test real. Use injected transports, controlled time, and persistence seams; use `fake-indexeddb` for the IndexedDB adapter. A mock returning its configured value does not prove application behavior.
- **Outcomes first:** assert returned decisions, rendered state, persisted records, or navigation. Interaction assertions are appropriate when the interaction IS the contract: no AniSource request before mount, no write after cancellation, bounded retries, or required request payloads. Do not blanket-ban spies or component tests.
- **Legibility:** one behavior per test, descriptive names, visible relevant inputs, isolated storage/time. Avoid private-field assertions, broad markup/prop snapshots, arbitrary sleeps, and redundant coverage at every layer. Playwright uses accessible locators and web-first assertions against `tests/e2e/mock-api.mjs`; Vitest uses `tests/setup.ts`.

Examples of stronger evidence:

- Not merely “retry calls a spy”; a failed load can recover and its content becomes usable.
- Not “the mocked Source returns this list”; Source A resolves after switching to B, and cannot overwrite B's state.
- Not only “a complete fixture parses”; malformed required identity is rejected and documented optional data is handled safely.

Do not add tests for every new function or delete existing coverage to reduce the count. When test and implementation disagree, establish which violates the contract. Never weaken assertions or types to get green checks.

## Checks and completion

Bun only: `bun install --frozen-lockfile` when installing dependencies. `package.json` owns commands.

- Iterate narrowly: `bun run typecheck`, `bun run lint`, `bunx vitest run tests/<name>.test.ts`, or `bunx playwright test -g "<title>"`.
- For application, script, test, dependency, or build/config behavior changes, run `bun run verify` on the finished change: lint, typecheck, build, AniSource boundary check, Vitest, mocked Playwright. Do not repeat the full gate after every edit. Diagnose failures with affected checks, then obtain a passing final gate after fixes.
- Docs-only or copy-only changes need `bun run lint`; markup or behavior changes are not copy-only. Review prose and paths directly because lint does not validate them. These tiers and the test policy above supersede older quotas, test-timing prescriptions, or blanket pre-PR build rules in `docs/agents/engineering-standards.md`.
- `bun run test:live` contacts real services: operational only, never a merge gate, and run only when requested. Do not assume an ordinary dev server is mocked.

Finish when requested behavior works, relevant failures are handled, the diff is reviewed, and applicable checks pass. Do not stop at a first draft or polish unrelated code. After three failed attempts at the same problem, change approach or report the blocker with evidence.

Handoff: what changed, consequential tradeoffs, commands actually run and results, and remaining limitations. Distinguish automated, manual, and unperformed checks. Broken required behavior is incomplete, not a follow-up disguised as delivery.

## Git and task references

Feature branch and PR; `main` receives merges only. Commit and push when asked. Never commit secrets, generated builds, or unrelated work. Separate follow-ups go to GitHub Issues on `shariiq/animesource-web` via `gh`, not TODO comments; report unavailable issue access.

Read only what applies:

- Domain/ownership: `CONTEXT.md`, `docs/architecture/ownership.md`.
- Durable architectural decisions: relevant `docs/adr/`; record accepted new decisions in an ADR. Workflow: `docs/agents/domain.md`.
- Cache/retry/prefetch: `docs/architecture/cache-policy.md`.
- Gateway security/deployment: `docs/deployment/anisource-access-control.md`, `docs/adr/0003-anisource-server-access-control.md`.
- Repeated failures, flakes, deferrals: relevant sections of `docs/agents/engineering-standards.md`.
- Issue triage: `docs/agents/issue-tracker.md`.

These references are not automatically registered skills. A recurring workflow may warrant `.agents/skills/<name>/SKILL.md` with `name`, a narrowly triggered `description`, and links to supporting material. Do not install broad skill bundles or duplicate these rules in skills. Keep always-loaded instructions focused on durable constraints and demonstrated recurring failures.
