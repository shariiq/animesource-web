# AGENTS.md

AnimeSource: a SolidJS + TanStack Start app combining AniList discovery/metadata with on-demand AniSource anime streaming and manga reading.

**Read this first, every session:** you do not get credit for believing your work is correct. You get credit for the command output that proves it. If a rule below has a command next to it, run the command before you say you're done — don't infer the result from reading your own diff.

## Stack & commands

Package manager is **Bun** (not npm/pnpm/yarn) — Node 22.12+, Bun 1.4+. Copied verbatim from `package.json`; if it ever diverges, `package.json` wins and this file is stale.

| Task | Command |
|---|---|
| Install | `bun install --frozen-lockfile` |
| Dev server (:3000) | `bun run dev` |
| **Full local merge gate** (lint, typecheck, build, unit, mocked e2e) | `bun run verify` |
| Live service smoke (real AniList/AniSource — operational only, never blocks merges) | `bun run test:live` |
| Unit tests only | `bun run test` |
| Build | `bun run build` |

`bun run verify` is not a suggestion — it's the literal command CI runs as the merge gate. If you haven't run it and seen it exit 0, you don't know the work is done, you're guessing.

## The one loop to run for every change

This is the actual mechanism for "high quality" — not a value to aspire to, a sequence to follow:

1. **Read the real file before editing it.** Never write a diff from memory of what you think is there.
2. **Make the smallest diff that satisfies the request — then run the second pass below before deciding you're done.** No drive-by refactors, no unrelated cleanup, no renaming things you weren't asked to rename. "Smallest diff that satisfies the request" isn't the same as "only what the sentence literally said" — the request assumes engineering judgment you still have to supply.
3. **Read your own diff once, fully, before running anything.** This catches leftover `console.log`/debug code, an unused import, a `TODO` you forgot to resolve, or a type you loosened just to make an error disappear — and it catches them for free, before spending a test run on them.
4. **Run the narrowest command that would catch a regression in what you just touched** (one test file, `bun run typecheck`, lint on the changed file) — not the full gate, while you're still iterating.
5. **Only repeat a step if the last run gave you new information.** If nothing changed your understanding of the failure, you're not iterating — see below.
6. **Run the full gate once, at the end**, as the actual done-check — not as a way to find out what to fix next.

## A second pass: lenses, not a checklist

A task description names the feature, not the standing engineering concerns around it — that doesn't make those concerns optional, it means the task assumed you'd already think of them. A memorized checklist won't cover the case nobody wrote down, so instead of a list of items, use a short list of *lenses*: standing questions you answer fresh, in your own words, for the specific diff in front of you.

After the diff is written and before you run the gate, take exactly one pass through these six questions about what you just changed:

1. **Who else touches this?** — other callers, routes, or components that import what you changed.
2. **What happens on empty, wrong, or slow input?** — not just the input the task's example described.
3. **Who's using this besides a mouse on a desktop screen?** — mobile, keyboard, screen reader, the ~390px viewport.
4. **What did the existing code already solve here that this diff might duplicate or break?**
5. **What fails silently instead of loudly if this is wrong?** — an unvalidated boundary, a loosened type, a swallowed error.
6. **What happens the second time this runs, not the first?** — SSR reuse, caching, re-render, stale state.

Most diffs will only surface a real answer for one or two of these — that's expected, not a sign you did it wrong. The point isn't to tick off six boxes, it's to generate the specific concern this diff actually has, in the language of this diff, rather than pattern-matching to a list of concerns from other diffs.

This pass is bounded: once, per diff, not repeated and not a substitute for the actual commands. Self-review catches what you can see by rereading; it doesn't reliably catch what a type checker or linter is built to catch — run those regardless of what this pass turns up.

## Don't get stuck testing

A rerun is only useful if something changed since the last one — your diagnosis, the code, or the command. Rerunning the same command hoping for a different result is thrashing, not progress, and it's the most expensive way to burn a session.

- **Cap it at 3.** Three reruns of the same failing command with no new hypothesis means stop, read the actual error or stack trace in full, and state in plain terms what you now believe is wrong before touching code again. This is the same rule as the Stopping rules in `docs/agents/engineering-standards.md` — it applies to test/verify commands specifically, not just generic failures.
- **Don't run `bun run verify` as your iteration loop.** It's the full gate, meant to run once at the end. While you're actually debugging, use the narrowest command that isolates the thing you're checking.
- **A test failing on a change that couldn't plausibly have caused it is a signal to check for flakiness, not a signal to start "fixing" code.** Rerun once to see if it's consistent. If it's inconsistent, say so — don't patch around a flake by adding retries, sleeps, or defensive checks to code that was never broken.
- **Never edit a test to make it pass instead of fixing the underlying code** — that's not a fix, it's hiding a real regression from the next person who reads this file.

## Before you say a task is done

1. Run `bun run verify` (or the tier-appropriate subset from the table below) and get a real, non-truncated pass.
2. Paste or summarize the actual command output, not a description of what you expect it would say.
3. If it fails, fix it or say explicitly what's still broken — never report success alongside a failing or unrun check.
4. If any step above didn't happen, say "not verified" instead of "done."

## Tier once, out loud

Tier by impact; shared tokens, multiple consumers, or an explicit fidelity target are at least Medium. **If a task looks High tier, stop and confirm scope before starting rather than guessing at the architecture** — High-tier judgment calls (auth, concurrency, large refactors) are where a smaller model diverges from what was actually wanted. Small and Medium tasks don't need this pause.

| Tier | Scope | Verification (run it, don't estimate it) | Before push |
|---|---|---|---|
| Small | Docs/config/copy, isolated styling, narrow behavior-preserving refactor | `bun run lint` on changed files | Same |
| Medium | Features, API clients, routing, shared utilities/tokens | `bun run typecheck`; `bun run build` if plausibly affected; exercise the behavior at desktop + ~390px | Small + above |
| High | Auth, playback, deployment, caching/concurrency, security, large refactors | `bun run verify` (full gate) + manually exercise failure/race/cancellation paths | Full `bun run verify` green |

## Locked decisions (exact shapes — implement these literally, don't paraphrase)

- SolidJS (not React), TanStack Start/Router, Solid Query, strict TypeScript, Tailwind.
- AniList GraphQL for discovery/metadata, server loaders for SEO/first paint. AniSource REST is client-only for Watch and Manga Reader interactions; never SSR or page load.
- Watch route: `/anime/$animeId/watch/$episodeId?source=` — deep-linkable, code-split, not embedded in the detail route.
- Manga Reader route: `/manga/$mangaId/read/$chapterId?source=` — deep-linkable, client-only, not embedded in detail; chapter list comes from `/chapters`, never the update endpoint.
- Persistence: typed, versioned, Zod-validated IndexedDB through Solid Query resources/hooks. `localStorage` calls are a violation, not a style preference — there is no case where it's the right layer here.
- `docs/adr/` governs visuals. `comick.dev`/MangaDex/nothing.tech are direction references, not markup or copy sources — do not port their DOM structure or class names.

## Hard rules — each paired with what actually catches a violation

- **Fix Root-Cause; Not just the Side Effects. Never hide errors** with catch/defaults/optional chaining, `as any`, or `@ts-ignore`. Check: `bun run typecheck` should fail loudly on a real type problem — if you're reaching for `as any` to make it pass, the type is telling you something real. Fix the modeled type, don't silence the checker.
- **No stubs, fake production data, dead controls, or silently unsupported states.** If a state isn't handled, say so in your summary — don't ship a control that does nothing.
- **Validate AniList, AniSource, and IndexedDB data with Zod at every boundary.** Handle AniList's HTTP-200 `errors[]`, rate limits, and network failures as three distinct branches, not one catch-all. Check: a boundary with no `.parse()`/`.safeParse()` call on external data is a bug, not a style choice.
- **No cache/queue singleton shared across SSR requests.** This is the specific bug shape that leaks one viewer's data into another viewer's response — treat any module-level mutable cache touched during SSR as a stop-and-ask case, not a judgment call.
- **IndexedDB-dependent UI must hydrate safely under Solid resources/Suspense.** Check: the component should render a defined loading state, not throw, when IndexedDB isn't ready yet.
- **Match the nearest existing file's pattern by default.** Don't introduce a new pattern because it seems better — that's a judgment call you're not positioned to make reliably. If you genuinely think an existing pattern is wrong, say so and ask, rather than silently replacing it.
- **Accessibility:** semantic elements, keyboard navigation, visible focus, labels, `prefers-reduced-motion` respected. Use tokens from `app/styles/theme.css`; if a design reference gives you an exact value, add it as a token — don't eyeball a close approximation.
- **Git:** feature branch + PR, never push to `main` directly. Commit/push only when explicitly asked. No secrets, no unrelated changes bundled into one commit.
- **0 subagents.** Do the exploration and the edit in one continuous thread — don't spawn a child task and summarize its output back to yourself.
- **Don't write tests by default.** Write one only when it covers true core logic/behavior, or as the required regression test for a real bug fix — that second case is mandatory, not optional. Never render to static markup just to assert props, and never test callback wiring alone.

## Deeper reference (load only when the trigger fires)

- **A failure, retry loop, or deferred work** → `docs/agents/engineering-standards.md` § Stopping rules
- **Milestone completion or a bug fix** → same file § Testing
- **Data loading, media, images, or caching changes** → same file § Performance
- **Commit, push, PR, or CI work** → same file § Git and CI
- **Architecture or domain-language questions** → `CONTEXT.md`, `docs/adr/`, `docs/architecture/`
- For complex TypeScript (generics, discriminated unions, inference-heavy types, tricky Zod), check for an installed Matt Pocock/Total TypeScript skill before hand-rolling it.

## Done means

`bun run verify` (or the tier's subset) actually ran and actually passed — reported with its real output, not inferred. UI changes inspected at desktop + ~390px against the approved reference. Anything incomplete or deferred is stated as such in plain terms, never implied to be finished.