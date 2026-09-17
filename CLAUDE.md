# Engineering Standard

**The deliverable MUST be COMPLETE, WORKING, and well-composed features.** For user-facing work, functional behavior, information hierarchy, visual composition, responsive behavior, and accessibility are one implementation—not sequential follow-up work. Verification is how the feature becomes shippable, not a substitute for designing it. Operate at senior/principal-engineer quality: ship the **BEST** simplest maintainable, readable implementation that is correct, complete, and coherent with the approved design system.

If you find yourself implementing data and behavior while postponing the page's visual hierarchy or composition, you are off-task. Establish the visual structure early, render it with real data, and iterate on behavior and presentation together. Keep verification proportional to risk, but do not declare a UI feature complete before its real route has been visually inspected at desktop and narrow width.

**Speed and efficieny of a task is as important as anything and comes from scoping correctly, not from lowering the bar on the requested feature.** The tier table, stopping rules, and test budget below trim time spent on things *outside* that feature — never the feature itself. (The Stopping Rules section spells out exactly where that line is; nothing else in this doc overrides it.)

---

## Default mode: build

Most sessions should produce **new working functionality** — a feature, a route, a component, a real design improvement. The following are explicitly *not* the job unless asked:

- Writing tests for code you wrote five minutes ago in the same session.
- Re-running a suite you already ran because you touched one more line — batch to a natural stopping point instead.
- Chasing a failure in infrastructure you do not control (see the evidence bar under Stopping Rules before deciding something qualifies).
- Improving coverage of code that already works.

Verify by running the thing throughout implementation, not only at the end. Open the affected route with representative real data as soon as the first visual slice exists; inspect hierarchy, typography, spacing, surfaces, contrast, responsive behavior, and interaction while the feature is still being shaped. Click the button, watch the video play, and confirm the composition remains coherent at desktop and approximately 390px. That rendered experience—not compilation or tests alone—is the primary signal during the build phase.

---

## Tier the change, once, out loud

Tier by *impact*, not by category label. "Styling" is not automatically Small — a one-off color tweak on a single component is Small; a shared design-token replacement, a change with an exact visual-fidelity target (a reference file, a design spec, a screenshot to match), or any change touching more than one consumer is Medium or High regardless of the fact that the diff is CSS. When in doubt, tier up.

| | **Small** | **Medium** | **High** |
|---|---|---|---|
| **Examples** | docs, comments, config, copy, an isolated single-component style tweak with no shared-token or cross-consumer impact, narrow refactor w/ unchanged behavior | feature work, component behavior, API client changes, routing, shared utilities, shared design-token changes, styling work with an explicit visual-fidelity target | auth, playback/media, deployment, caching/concurrency, security, large refactor, shared data models |
| **Investigate** | Read only the file(s) you're editing + direct imports. | Read the file + direct callers/consumers + its tests. Trace data flow through the touched boundary. | Full root-cause + architecture pass, end-to-end including edge/race/failure paths. |
| **Verify** | Glance at the diff; run it if that takes under a minute. Never a full suite. | Run it. Confirm behavior and visuals in the browser side by side with any reference — and a keyboard-only pass for anything interactive. | Run it + tests for the paths that are actually risky (race, failure, cancellation, retry). |
| **Before push** | Format + lint on changed files. | + typecheck, + build if plausibly affected. | + typecheck, + build, + test suite. |

"Verify: nothing" is never correct, even at Small. State the tier in one line and proceed — don't ask permission or re-litigate mid-task. Escalate a tier if something unexpected surfaces, without redoing prior work. For visual composition work, the natural stopping point must include a rendered browser inspection before the feature is treated as complete.

**If a change has an explicit reference to match (a design file, a screenshot, a spec) and you don't have a way to actually render and visually compare against it in this environment, say so before starting**, rather than declaring a visual match you inferred from source code alone.

---

## Stopping rules (hard limits)

These exist to stop you burning a day on a side quest that isn't the feature — **they do not authorize shipping the actual requested feature in a broken or partial state.** If you're tempted to invoke one of these to justify why the thing you were asked to build doesn't fully work, stop and say so plainly instead.

1. **Three strikes.** Three failed attempts at the same failure and you stop. Write down what you tried and what you now believe is true. "Route around it" means finding a different way to satisfy the *same requirement* (or asking the user for direction) — never shipping the feature broken and calling the workaround done.
2. **Fifteen-minute rule — for side quests only.** If a problem is genuinely not the feature you set out to build (a pre-existing unrelated bug, an adjacent nice-to-have) and it's cost more than ~15 minutes, defer it and move on. **If the problem is the feature not working, this rule does not apply.** That's not a deferral, it's the task — keep working or say explicitly that you're stuck and why.
3. **Not-my-layer rule — needs evidence, not a first impression.** Flaky network, cold starts, rate limits, CI runner weirdness, tooling bugs are never debugged inline *once genuinely confirmed as such* — reproduce at least twice, or find independent evidence (a status indicator, a second run behaving differently, a documented rate limit), before attributing a failure to infrastructure.
4. **Test-vs-code rule — investigate before touching the test.** If a test fails but your manual check says the feature works, that disagreement is a signal, not a verdict. Determine *which one is wrong* first — the test may assert stale/incorrect behavior, or your manual check may be shallower than what the test catches (an edge case, a race). Only fix or delete the test once you know why they disagreed. Never delete or weaken a test just because it's inconvenient.
5. **Deferred list is real output — for genuinely separate concerns only.** Three fully-working shipped features and five noted deferrals (unrelated bugs, follow-on work) is a good session. **A feature that doesn't do what it was asked to do is not a shipped feature with a footnote — it's incomplete, and gets reported as incomplete.**

Deferrals go in the issue tracker (`gh`), not in code comments, and never as a silent stub.

---

## Project Decisions (locked — don't re-litigate)

- **Stack:** TanStack Start + TanStack Router + Solid Query, **SolidJS** (not React), TypeScript strict, Tailwind.
- **Data:** AniList GraphQL for all discovery/metadata (server-loader-fetched where SEO/first-paint matters). AniSource REST for the watch pipeline only — client-only, on-demand, never during SSR or on page load.
- **Watch is its own nested route** — `/anime/$animeId/watch/$episodeId` (`?source=` param) — not a section embedded in the detail page. Deep-linkable, own code-split boundary.
- **Persistence:** typed, versioned, zod-validated IndexedDB, exposed through Solid Query resources/hooks — not raw `localStorage`.
- **Visual language:** whatever the current approved ADR under `docs/adr/` records is authoritative. A reference file (mockup, screenshot) used to update that direction is a visual source, never a content source or markup to copy — production data always comes from the real loaders.

---

## Non-negotiables (every tier)

- **Root cause, not symptom** — subject to the stopping rules above, which govern *time spent on side quests*, not the correctness bar of the feature itself. No try/catch, optional chaining, defaults, or `as any`/`@ts-ignore` used to hide an error instead of fixing it.
- **No fake completeness.** No stubs, hardcoded/mock data on production paths, dead buttons/routes, silently-unsupported states. If it can't be done correctly, say so and file it — don't fake it, and don't call it done with a deferral note attached.
- **Types are load-bearing.** Strict TS; validate all external data (AniList, AniSource, IndexedDB reads) with zod at the boundary; no untyped pass-through of raw JSON into components.
- **External APIs are unreliable.** AniList can return `errors[]` on a 200 or rate-limit — handle both distinctly from network failure; batch related queries via GraphQL aliases. AniSource cold-starts on free-tier hosting — a slow first response is *expected*, surfaced as such. (A real, confirmable behavior, not a blanket excuse — see the Not-My-Layer evidence bar above.)
- **SSR safety:** no module-level singleton cache/queue shared across concurrent SSR requests; IndexedDB-dependent UI (favorite heart, continue-watching) must not hydration-mismatch under Solid's resource/Suspense model.
- **UI works without a mouse.** Semantic elements, keyboard nav, visible focus, labels, reduced-motion — checked in the Medium/High verify step, not assumed.
- **Design tokens are load-bearing too, in both directions.** Use existing tokens — no one-off spacing/color/radius values invented ad hoc. But when implementing an approved visual reference, the exact values it specifies (colors, radii, spacing, type scale, easing) get added to the token file as new tokens — don't silently snap them to the nearest pre-existing value. A design-fidelity task that quietly reverts to old tokens because they're "existing" has failed the task.
- **Visual composition is part of implementation.** Design the information hierarchy, typography, density, surfaces, responsive behavior, and states before wiring every data field into the page. Establish or reuse the visual recipes first, implement a representative real-data slice, render it at desktop and narrow width, then apply the proven composition to the remaining states.
- **No secrets, no unrelated changes in a commit.**

---

## Testing (batched, budgeted by actual risk — not a fixed ceiling)

Tests are written in a **test pass at the end of a milestone**, not alongside each function. A milestone is a coherent slice a user can exercise: "search works," "watch route plays an episode," "favorites persist." **The milestone is not done until its test pass is written** — not optional cleanup dropped under time pressure.

**Guideline: 3–6 tests for a typical milestone — a floor, not a ceiling.** Scale up for milestones with more real failure modes (the watch pipeline's matching algorithm, two API clients, and player fallback genuinely need more than 6). Never cut a test that would catch a real failure mode just to hit a number.

Spend the budget in this priority order:

1. **Regression tests for bugs you actually hit.** Highest value, always first. Every real bug fix gets one.
2. **Pure logic** (matching/similarity scorer, format/date helpers): normal input plus the edge case that actually worries you, and one real sample pair.
3. **Schema boundaries:** one test that a malformed external payload is rejected/defaulted rather than crashing a component, per schema — not per field.
4. **API clients:** mocked transport. Success and `errors[]`/rate-limit-retry for AniList; success, timeout, and cold-start for AniSource — these are documented, recurring conditions for this app, not hypothetical edge cases.

Explicitly **not** required by default:
- Loading/empty/error/success tests for every component. Cover error-with-retry on the player and the grid; skip the rest — unless a real bug showed up there, in which case rule 1 applies.
- Per-route loader tests, beyond the watch route.
- Coverage targets of any kind.

**No live-API tests in CI, ever.** AniList rate-limits and AniSource cold-starts; a gate that fails for reasons no commit can fix is worse than no gate. Run live checks, if wanted, as a scheduled non-blocking job that opens an issue on failure.

**E2E: deferred until the watch pipeline is feature-complete.** Then one Playwright smoke test for the core path (search → detail → watch route → player mounts), and a second for the match/fallback path (ambiguous match → picker → episode → server fallback), given it's the highest-breakage-risk journey in the app. Stop there by default.

Tests must fail if the implementation is genuinely broken. Small, specific, purposeful — never rewritten or dropped just to make a session's test count look complete.

---

## Performance

- Loader-fetched, server-rendered data for anything SEO/first-paint-relevant (home, explore, detail metadata). Keep the watch route and HLS.js/YouTube embed client-only via Solid's `lazy()` — out of the shared/initial bundle.
- Never call AniSource during SSR or on page load — only on user interaction.
- Prefetch route data on link hover/intent via the router. Explicit image dimensions/`aspect-ratio` everywhere (no CLS), lazy-load below the fold.
- Any cache (Solid Query included) needs a defined key, `staleTime`/`gcTime`, invalidation trigger, and failure behavior.

---

## Docs & Skills

Check current docs before architecture-sensitive changes rather than relying on memory: TanStack Start (https://tanstack.com/start/latest), TanStack Router, Solid Query, SolidJS. Check AniList's GraphQL schema before adding fields — don't guess names/enums.

**Use installed skills proactively, don't wait to be told.** Before writing TypeScript of any real complexity — generics, discriminated unions, inference-heavy utility types, tricky Zod schemas — check for and apply the installed Matt Pocock (`/mattpocock-skills:`) / Total TypeScript skills. Same principle for any other installed skill: if one exists for the work in front of you, use it rather than freehanding something it already has a better answer for.

---

## Git & CI

- Branch + PR by default, no direct pushes to `main`. Pre-commit: format + lint (fast, never interrupts flow).
- **Before opening a PR** (not every commit): run typecheck, build, and the milestone's tests locally at least once. CI is the authoritative re-check, not the first check.
- After push, check CI. On a genuine failure, fix the real cause and push a correction — never weaken a test or type to force green (Stopping Rule 4). On a flake or infra failure meeting the evidence bar (Stopping Rule 3), re-run once and move on.

---

## Done Means

The requested behavior works when a user exercises it, verified at the depth its tier requires — visually, not just structurally, when there's a visual target — with regression coverage for anything that broke along the way. "Compiles" isn't done. Neither is a restyle that matches the reference in code but was never looked at rendered, or a feature reported as shipped with the parts that don't work listed as deferrals.

---

## Agent skills

### Issue tracker
Issues are tracked in this repository's GitHub Issues via `gh`. See `docs/agents/issue-tracker.md`. Deferred items from the stopping rules go here.

### Domain docs
Single-context repository: use root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.