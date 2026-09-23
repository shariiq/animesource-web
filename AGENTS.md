# AGENTS.md

AnimeSource: a SolidJS + TanStack Start app. AniList GraphQL supplies discovery and metadata through server loaders; AniSource REST supplies anime playback and manga reading through the same-origin `/api/anisource/*` gateway, browser-only. Domain vocabulary and route/data ownership live in `CONTEXT.md`.

## Commands

Bun only (`bun install --frozen-lockfile`). Scripts are defined in `package.json`; the ones that shape the workflow:

- `bun run verify` is the CI merge gate (lint, typecheck, build, AniSource boundary check, Vitest, mocked Playwright). Run it once, at the end, for changes under `app/`, `scripts/`, or `tests/`. Docs and copy changes need only `bun run lint`.
- Iterate with the narrowest check: `bun run typecheck`, `bunx vitest run tests/<name>.test.ts`, `bun run lint`.
- `bun run test:live` calls real AniList/AniSource. It is operational only and never gates a merge.

## Conventions the code does not announce

- SolidJS, not React. Signals and `createResource`/Solid Query resources, `<Show>`/`<For>`, props read lazily (never destructured). No hooks, no virtual-DOM idioms.
- Deep-linkable, code-split routes: Watch is `/anime/$animeId/watch/$episodeId?source=`; Manga Reader is `/manga/$mangaId/read/$chapterNumber?source=`. Neither is embedded in its detail route. Chapter lists come from `/chapters`, never the update endpoint.
- AniSource is reached only from a mounted Watch or Reader session in the browser, via `app/data/anisource/client.ts` and the gateway. Server loaders, prefetch, and shared layouts stay AniSource-free; `bun run verify:boundary` enforces this on the built output. Gateway secrets (`ANISOURCE_*`, `UPSTASH_*`) are server-only runtime variables; a `VITE_` prefix on any of them is a leak. Setup: `docs/deployment/anisource-access-control.md`.
- Viewer data (favorites, progress, matches, search history) is versioned, Zod-validated IndexedDB behind the interfaces in `app/lib/persistence/`. UI consumes those interfaces through resources and renders a defined loading state while IndexedDB is unavailable. The bounded query-cache mirror in `app/router.tsx` is the only other browser storage.
- Validate external data with Zod at every boundary: AniList responses, AniSource responses, IndexedDB reads. AniList HTTP-200 `errors[]`, 429 rate limits, and network failures are three distinct branches.
- The QueryClient is created per router instance. Module-level mutable state touched during SSR is a cross-request leak; stop and ask before adding one.
- Visuals follow `docs/adr/0001-editorial-material-system.md` using tokens from `app/styles/theme.css`; add a token for any exact value a reference specifies. comick.dev, MangaDex, and nothing.tech are direction references only; their markup and copy are not sources.
- Accessibility baseline: semantic elements, keyboard operation, visible focus, labels, `prefers-reduced-motion`. UI changes are checked at desktop and ~390px.
- Types tell the truth: fix the modeled type rather than casting or suppressing. Handle a state or say it is unhandled in your summary; ship no dead controls or stubbed data.

## Tests

Vitest in `tests/` (jsdom, `fake-indexeddb`, `tests/setup.ts`); mocked Playwright in `tests/e2e/` against `tests/e2e/mock-api.mjs`. Every real bug fix ships with a regression test. New tests otherwise cover core logic or a schema boundary; component-prop snapshots and callback-wiring tests add nothing here.

## Git

Feature branch and PR; `main` receives merges only. Commit and push when asked. Follow-ups go to GitHub Issues via `gh`, never code comments.

## When to read more

- A retry loop, a flaky check, or work you want to defer: `docs/agents/engineering-standards.md` (Stopping rules, Testing, Performance, Git and CI).
- Query keys, `staleTime`, or invalidation: `docs/architecture/cache-policy.md`.
- Which route or module owns a piece of data: `docs/architecture/ownership.md`.
- A durable architectural decision, made or questioned: `docs/adr/`.

## Agent skills

### Issue tracker

GitHub Issues on `shariiq/animesource-web` via `gh`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `CONTEXT.md` plus `docs/adr/`. See `docs/agents/domain.md`.
