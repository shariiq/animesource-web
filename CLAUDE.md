# Engineering Standard

Ship complete, working, maintainable features. For UI, composition, behavior, responsive layout, and accessibility are one implementation: establish hierarchy, typography, density, surfaces, and states early with real loader data; render during development and inspect the actual route at desktop and ~390px before declaring done. Compare approved references side by side; disclose missing rendering capability before starting a fidelity task. Efficiency comes from scope, never reduced correctness.

## Tier once, out loud

Tier by impact; shared tokens, multiple consumers, or an explicit fidelity target are at least Medium. When unsure, tier up; escalate on new evidence without repeating completed work.

| Tier | Scope and investigation | Verification | Before push |
|---|---|---|---|
| Small | Docs/config/copy, isolated styling, narrow behavior-preserving refactor; read target + direct imports | Review diff; run if under a minute; no full suite | Format + lint changed files |
| Medium | Features, API clients, routing, shared utilities/tokens; trace boundary, callers, consumers, tests | Exercise behavior; UI: desktop + ~390px, reference comparison, keyboard pass | Small + typecheck; build if plausibly affected |
| High | Auth, playback, deployment, caching/concurrency, security, large refactors/shared models; trace architecture and edge/race/failure paths | Medium + risky-path tests (failure, race, cancellation, retry) | Small + typecheck, build, test suite |

## Locked decisions

- SolidJS (not React), TanStack Start/Router, Solid Query, strict TypeScript, Tailwind.
- AniList GraphQL for discovery/metadata, server loaders for SEO/first paint. AniSource REST only for watch, client-only on interaction; never SSR or page load.
- Watch: deep-linkable, code-split `/anime/$animeId/watch/$episodeId` with `?source=`, not embedded in detail.
- Persistence: typed, versioned, Zod-validated IndexedDB through Solid Query resources/hooks, not raw localStorage.
- Current approved `docs/adr/` governs visuals. References supply visual direction, not production content or copied markup.

## Guardrails

- Prefer the repository's existing sound patterns over introducing new ones unnecessarily unless they are better. Changes should maintain or improve the existing level of architectural and code quality; do not regress it, always do an improvement on the codebase.
- Fix root causes not just the sideeffects; never hide errors with catch/defaults/optional chaining, `as any`, or `@ts-ignore`. No stubs, fake production data, dead controls, or silently unsupported states. Report incomplete work as incomplete.
- Validate AniList, AniSource, and IndexedDB data with Zod at boundaries. Handle AniList HTTP-200 `errors[]`, rate limits, and network failures distinctly; batch related queries with aliases. Surface AniSource cold-start delays.
- No cache/queue singleton shared across SSR requests. IndexedDB-dependent UI must hydrate safely under Solid resources/Suspense.
- Use semantic elements, keyboard navigation, visible focus, labels, reduced motion. Use design tokens; add exact approved reference values as tokens rather than approximating them.
- Build the requested feature, not unrelated coverage improvements. Batch tests at milestone end; the milestone requires its test pass, and every real bug fix requires regression coverage. Batch reruns at natural stopping points.
- Stopping rules constrain side quests, not completeness. After three failed attempts at one failure, stop and report attempts/evidence; seek another approach or direction. Defer unrelated work after ~15 minutes via GitHub Issues. Read failure rules below before blaming infrastructure or modifying a failing test.
- No secrets or unrelated changes in commits. Branch + PR; no direct pushes to main. Commit/push only when asked.

## Context and skills

- Read targeted excerpts; reuse already-loaded, unchanged content. Search a known symbol directly. Delegate broad multi-file exploration to one focused subagent returning conclusions and file:line references, not file dumps; do not duplicate its search or retrieve its transcript.
- Invoke the most specific applicable installed skill before its work; do not load a whole plugin family. For complex TS (generics, discriminated unions, inference-heavy types, tricky Zod), check for a relevant Matt Pocock/Total TypeScript skill. If none fits, proceed normally. Required and explicitly requested skills still apply.
- Read only relevant reference sections when their trigger fires; do not preload every linked document:
  - **Failure/retry/deferral:** `docs/agents/engineering-standards.md` → Stopping rules.
  - **Milestone testing or bug fix:** same file → Testing.
  - **Data loading, media, images, or caching changes:** same file → Performance.
  - **Commit, push, PR, or CI work:** same file → Git and CI.
  - **Architectural/domain changes:** `docs/agents/domain.md`, root `CONTEXT.md`, and relevant ADRs. Consult current framework docs when needed; check AniList's schema when field definitions need confirmation.
  - **Issue operations:** `docs/agents/issue-tracker.md`.

## Done

Requested behavior works in real execution at the tier's depth, including rendered UI inspection and milestone/regression tests where applicable. Compilation alone is insufficient; broken requested behavior is not a deferral.
