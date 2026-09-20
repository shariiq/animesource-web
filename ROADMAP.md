 # AnimeSource Product Roadmap

**Last reviewed:** 2026-09-17  
**Roadmap status:** Active  
**Product target:** A production-grade anime discovery, library, schedule, and playback platform.

This is the product roadmap for AnimeSource. It tracks user-visible capability and the engineering work required to support it. Production behavior, real AniList data, the current route tree, `CLAUDE.md`, and the accepted ADR remain authoritative.

## How to maintain this file

1. Work from the current highest-priority incomplete phase unless a dependency requires otherwise.
2. Change a checkbox only when the behavior exists on the real application path and has been exercised at the appropriate verification depth.
3. Keep each item small enough to finish as a coherent user-visible slice. Split an item rather than marking a partial implementation complete.
4. Record material scope or sequencing changes in the changelog at the bottom of this file.
5. Link implementation issues or pull requests beside an item when they exist. Deferred work belongs in GitHub Issues as required by `docs/agents/issue-tracker.md`.
6. Reassess this document after each milestone. Remove stale assumptions instead of accumulating another layer of plans.

### Status legend

- `[x]` Shipped and verified.
- `[~]` Partially implemented; the remaining acceptance criteria still matter.
- `[ ]` Not started or not yet verified.
- `Blocked:` A dependency or product decision must be resolved before implementation.

---

## Definition of full-scale

AnimeSource is full-scale for this project when a viewer can:

- discover anime through search, filters, genres, schedule, relationships, and recommendations;
- inspect complete and trustworthy metadata;
- save anime to a durable account-backed library;
- see watch history and progress;
- resume and complete episodes across devices;
- recover from source, stream, and network failures;
- manage playback, content, notification, and appearance preferences;
- receive useful release updates;
- use the product with reliable SEO, accessibility, performance, monitoring, privacy, and operational controls.

The current application is a **working discovery plus watch vertical slice**. The next major milestone is to turn isolated persistence and playback capabilities into a coherent viewer product: **Library, Continue Watching, Schedule, and playback progress**.

---

## Current baseline

### Shipped foundation

- `[x]` SolidJS + TanStack Start + TanStack Router application structure.
- `[x]` Home discovery backed by validated AniList data.
- `[x]` Explore search, typed URL search state, filters, sorting, pagination, loading, error, and empty states.
- `[x]` Anime detail route with validated metadata, synopsis, trailer, characters, relations, recommendations, rankings, and information fields.
- `[x]` Functional detail-page genre links that preserve Explore route intent.
- `[x]` Separate nested Watch route: `/anime/$animeId/watch/$episodeId`.
- `[x]` AniSource client-only, interaction-triggered watch boundary with validated payloads.
- `[x]` Source selection, AniList-to-AniSource title matching, saved matches, manual match selection, episodes, servers, streams, subtitles, HLS/direct playback, retries, and cold-start messaging.
- `[x]` Typed, versioned, Zod-validated IndexedDB persistence for favorites, continue-watching records, preferred source, and saved source matches.
- `[x]` Focused Vitest coverage and mocked vertical-slice Playwright coverage.
- `[x]` Shared paper/ink/frosted material system, responsive route compositions, semantic controls, visible focus behavior, reduced-motion guidance, and updated design documentation.

### Partial or missing today

- `[x]` Favorites and Continue Watching are a complete local library experience with status filters, metadata refresh, unavailable-title handling, progress, completion, resume, and history management.
- `[x]` The schedule route provides timezone-aware day/week views, library/status/genre filters, truthful airing states, and detail/Watch navigation.
- `[x]` Watch persists and restores playback position and completion state, supports reliable previous/next/continue-to-next behavior, and ignores stale requests after rapid route or selection changes.
- `[ ]` No account, server-side library, or cross-device synchronization model.
- `[~]` Profile, settings, notification, and content-preference surfaces exist in local-first mode; account scoping remains pending authentication.
- `[ ]` No production operations layer for monitoring, error reporting, source health, privacy, or deployment policy.
- `[ ]` No systematic SEO, performance, or full accessibility hardening pass.

### Current routes

```text
/
/explore
/library
/schedule
/anime/$animeId
/anime/$animeId/watch/$episodeId
```

### Current data seams

- **AniList:** discovery and metadata through `app/data/anilist/queries.ts` and Zod schemas in `app/data/anilist/schema.ts`.
- **AniSource:** on-demand playback resolution through `app/data/anisource/client.ts`; never use it during SSR or initial page load.
- **Matching:** source-title candidate ranking in `app/data/matching.ts`.
- **Local persistence:** typed IndexedDB module in `app/lib/persistence/store.ts`.
- **Browse intent:** typed Explore search state in `app/lib/browse.ts`.

---

# Roadmap phases

## Phase 0 — Stabilize the product foundation

**Priority:** P0  
**Goal:** Make the existing vertical slice a dependable base for larger product work.

### Repository and delivery baseline

- `[x]` Resolve the repository/Git baseline so application files have a dependable tracked history before release work begins.
- `[x]` Make lint, typecheck, build, and mocked tests repeatable in a clean checkout.
- `[x]` Define the deployment target, runtime environment variables, and production start procedure.
- `[x]` Add a lightweight release checklist covering route smoke checks, external-boundary checks, and rollback ownership.

### Module and data discipline

- `[x]` Document route ownership and data ownership for Home, Explore, detail, Watch, persistence, and future library routes.
- `[x]` Audit SSR versus client-only behavior, especially IndexedDB and AniSource access.
- `[x]` Document every query key, stale time, garbage-collection policy, invalidation trigger, and failure behavior.
- `[x]` Keep local persistence behind a small library/progress interface so a future remote adapter can be added without coupling account behavior to UI components.
- `[x]` Split Watch orchestration into maintainable internal modules or seams before adding substantial playback behavior. Preserve the current public route behavior while improving locality and testability.
- `[x]` Remove duplicated Hero image styling declarations and keep the visual contract in one maintainable source of truth.

### Phase 0 completion criteria

- A clean checkout can run the documented verification commands without generated artifacts or machine-specific configuration.
- The existing Home → Explore → detail → Watch flow is still functional after the foundation work.
- AniSource is demonstrably absent from SSR and initial page-load execution.
- Future library/progress work has a narrow interface that can support both local and remote implementations.
- Any deferred foundation issue is recorded in GitHub Issues rather than left as an undocumented stub.

**Depends on:** None.  
**Unblocks:** All subsequent phases.

---

## Phase 1 — Complete the core viewer product

**Priority:** P0  
**Goal:** Turn discovery and local persistence into a site viewers can return to every day.

### Library and My List

- `[x]` Add a first-class `/library` or `/watchlist` route with a clear navigation entry.
- `[x]` Render persisted favorites with real AniList metadata, loading, empty, stale, and unavailable-title states.
- `[x]` Support removing a favorite and updating the library immediately without requiring a full reload.
- `[x]` Add useful library filters or views: all saved, currently watching, completed, planned, paused, and dropped where the underlying model supports them.
- `[x]` Add recently added and recently watched ordering with deterministic empty states.
- `[x]` Add migration behavior for records whose AniList metadata or source match is no longer available.

### Continue Watching and history

- `[x]` Add a dedicated Continue Watching surface or a clearly substantial library section.
- `[x]` Display episode number, title, source, progress, last-watched time, and a direct resume action.
- `[x]` Add remove-from-history and clear-history behavior with confirmation where destructive.
- `[x]` Distinguish an active progress record from a completed episode and from a saved source match.
- `[x]` Define retention and ordering rules for history instead of relying on incidental array order.

### Schedule

- `[x]` Add a dedicated schedule route backed by the existing validated AniList schedule query.
- `[x]` Add timezone-aware day and week views with a clear current-time context.
- `[x]` Link schedule items to detail and the correct Watch entry when playback is available.
- `[x]` Represent airing, delayed, skipped, completed, and unavailable states without inventing data.
- `[x]` Add filters for the viewer's library and relevant anime status or genre.
- `[x]` Define refresh and cache behavior for countdowns and schedule changes.

### Detail and discovery completeness

- `[x]` Add intentional season, sequel, remake, franchise, and relation navigation.
- `[x]` Add staff, studios, voice actors, and character detail navigation where AniList data supports it.
- `[x]` Make supported themes, tags, and external links meaningful without turning unsupported metadata into dead controls.
- `[x]` Improve alternate-title and language presentation.
- `[x]` Add search history and a stronger mobile search entry point.
- `[x]` Improve suggestion grouping and exact query/result semantics.
- `[x]` Add dedicated genre/discovery views only when they provide behavior beyond a filter shortcut.

### Phase 1 completion criteria

- A viewer can save an anime, leave the site, return to a first-class library, remove it, and navigate back to detail or Watch.
- A viewer can resume from a Continue Watching surface and understand whether an item is in progress or complete.
- A viewer can open a schedule view, change the displayed time window, and navigate from an airing item to its anime detail.
- Detail relationships and supported metadata are navigable through real routes or semantic controls with no dead buttons.
- Library, schedule, and discovery states have focused tests for persistence, route intent, error/empty behavior, and the relevant schema boundary.

**Depends on:** Phase 0.  
**Unblocks:** A coherent daily-use viewer experience and account synchronization design.

---

## Phase 2 — Make playback a complete product

**Priority:** P0  
**Goal:** Make watching reliable, resumable, and understandable across normal source failures.

### Progress and episode lifecycle

- `[x]` Persist playback position while a stream is playing with throttling and a defined write-failure behavior.
- `[x]` Restore playback position when a viewer resumes an episode.
- `[x]` Define episode completion thresholds and record completed episodes explicitly.
- `[x]` Add previous-episode, next-episode, and continue-to-next behavior where episode ordering is reliable.
- `[x]` Keep route state, player state, and persistence state consistent when a viewer changes episode quickly.

### Player preferences and controls

- `[x]` Persist quality preference with a safe fallback when a stream does not support it.
- `[x]` Persist subtitle and caption preferences where the resolved stream exposes those capabilities. Audio preference is intentionally out of scope because AniSource does not expose audio streams.
- `[x]` Improve mobile controls, alignment issues, design, touch targets, orientation/fullscreen behavior, and keyboard shortcuts.
- `[x]` Add stream expiry handling and a clear recovery path.
- `[ ]` Add skip-intro/outro only if reliable timing data exists; do not fake markers. Deferred until AniSource exposes reliable timing metadata.

### Source and request resilience

- `[x]` Define source health and fallback behavior based on observed availability rather than arbitrary preference.
- `[x]` Cancel or ignore stale source, episode, server, and stream requests after route or selection changes.
- `[x]` Preserve useful error kinds for network failure, timeout/cold start, invalid payload, unavailable server, and expired stream.
- `[x]` Add bounded retry behavior only where it improves recovery and does not hide a provider failure.
- `[x]` Add source attribution and provider failure diagnostics suitable for a public product.
- `[x]` Establish AniSource capacity, uptime, and observability expectations before public launch.

### Phase 2 completion criteria

- `[x]` A viewer can start an episode, leave, return, and resume near the previous position.
- `[x]` Completing an episode updates history and offers the next episode without losing route intent.
- `[x]` Rapid episode/source changes cannot cause an older request to overwrite current UI or persistence state.
- `[x]` A failed server or expired stream produces a recoverable state with a useful alternative when one exists.
- `[x]` The one required Playwright smoke test covers search → detail → Watch → player mounting after the watch pipeline is feature-complete; broad media E2E expansion remains out of scope.

**Depends on:** Phase 0; Phase 1 library/history model should be available for visible progress.  
**Unblocks:** Account sync and reliable daily watching.

---

## Phase 3 — Add identity and cross-device synchronization

**Priority:** P1  
**Goal:** Move from browser-local utility to a durable viewer account without losing offline resilience.

### Identity and account lifecycle

- `[ ]` Choose and document the authentication model, session policy, and account recovery behavior.
- `[ ]` Add sign-in, sign-out, session expiry, and account deletion flows.
- `[~]` Add a profile route and a settings route with accessible navigation and clear destructive-action handling. Local-first routes are shipped; account identity wiring remains deferred.
- `[~]` Define adult-content, language, timezone, and notification preferences at the account level. The versioned preference model is implemented locally and ready for account scoping.

### Remote library and progress model

- `[x]` Define a server-side interface for favorites, lists, progress, history, preferences, and source matches through the `RemoteViewerAdapter` seam.
- `[x]` Keep IndexedDB as a local cache/offline adapter rather than silently replacing it with UI-owned remote calls.
- `[x]` Add local-to-account migration for an existing anonymous viewer through the snapshot sync orchestrator.
- `[x]` Define conflict resolution for edits made on multiple devices or while offline using timestamped records and deletion tombstones.
- `[~]` Add sync status, retry, and partial-failure states that explain what is and is not saved. The adapter and status model are implemented; live account wiring is pending authentication.
- `[~]` Add export and deletion semantics for viewer data. Local export/deletion and the remote deletion interface are implemented; account deletion remains pending authentication.
- `[x]` Add import from AniList or another supported list provider only after the internal model is stable. Public AniList anime-list import is available from Settings.

### Phase 3 completion criteria

- A signed-in viewer sees the same library, progress, preferences, and history on two devices.
- Offline/local changes have a documented conflict policy and do not disappear silently.
- Sign-out, account deletion, data export, and session expiry leave no ambiguous stale account state.
- The UI calls a small data interface; it does not know whether local or remote persistence is active.

**Depends on:** Phase 1 library/history model and Phase 2 progress model.  
**Unblocks:** Personalization, notifications, and social features.

---

## Phase 4 — Personalization and community (conditional)

**Priority:** P1/P2  
**Goal:** Add retention and social value only after the core product and identity model are trustworthy.

### Personalization

- `[ ]` Define recommendation inputs, privacy expectations, and an explanation for why an anime is recommended.
- `[ ]` Add personalized discovery rails based on explicit library and viewing signals.
- `[ ]` Add release notifications or reminders with account-level opt-in, timezone handling, and unsubscribe behavior.
- `[ ]` Add useful schedule and library notifications without creating notification noise.

### Community and sharing

- `[ ]` Decide whether reviews, ratings, comments, shared lists, or follows are part of the product scope.
- `[ ]` Define moderation, reporting, blocking, privacy, and abuse-prevention requirements before exposing user-generated content.
- `[ ]` Add shareable canonical anime and list URLs without exposing private library data.
- `[ ]` Add social features incrementally, each with a complete moderation and deletion path.

### Phase 4 completion criteria

- Personalization is opt-in or transparently explained and can be disabled.
- Recommendations degrade gracefully for a new viewer and never present fabricated reasons or data.
- Every community feature has moderation, reporting, privacy, and deletion behavior before release.

**Depends on:** Phase 3.  
**Optional:** This phase is not required for a strong full-scale solo viewing product.

---

## Phase 5 — Production hardening

**Priority:** P0 before public launch; execute incrementally from Phase 0 onward.  
**Goal:** Make the product safe, discoverable, observable, and maintainable in production.

### SEO and metadata

- `[ ]` Add canonical URLs for discovery and anime detail routes.
- `[ ]` Add route-specific title, description, Open Graph, and social metadata.
- `[ ]` Add safe dynamic social preview images where the runtime supports them.
- `[ ]` Add sitemap and robots behavior appropriate to discovery, detail, and Watch routes.
- `[ ]` Add JSON-LD structured data where the data is accurate and supported.
- `[ ]` Decide whether Watch routes should be indexed; do not expose provider-specific stream details as search content by accident.

### Performance

- `[ ]` Audit route-level code splitting, especially the Watch player and HLS/YouTube code.
- `[ ]` Optimize image loading, dimensions, aspect ratios, responsive sizes, and below-the-fold lazy loading.
- `[ ]` Add prefetch-on-intent for high-value route transitions where it improves real navigation.
- `[ ]` Document and verify every cache's key, lifetime, invalidation trigger, and failure mode.
- `[ ]` Measure Core Web Vitals and regressions on representative desktop and approximately 390px mobile layouts.

### Accessibility and quality

- `[ ]` Perform a screen-reader review of Home, Explore, detail, library, schedule, and Watch.
- `[ ]` Exercise the core routes keyboard-only, including search, filters, pagination, episode selection, server selection, and player controls.
- `[ ]` Measure contrast for normal, hover, focus, loading, error, empty, and imagery-backed states.
- `[ ]` Audit mobile touch targets, focus visibility, reduced-motion behavior, and no-horizontal-overflow behavior.
- `[ ]` Keep tests focused on actual seams: schemas, persistence, matching, query clients, route intent, and high-value regressions.
- `[x]` Keep live AniList/AniSource calls out of CI. Use mocked transports; live checks, if needed, must be non-blocking operational checks. (Done: `verify.yml` is mock-only; scheduled, non-blocking `live-smoke.yml` opens an issue on failure — see `docs/ci.md`.)

### Operations, policy, and legal readiness

- `[ ]` Add structured error reporting and logs with provider failures distinguishable from application failures.
- `[ ]` Add uptime and latency monitoring for the application and AniSource dependency.
- `[ ]` Add rate limiting, abuse protection, and a clear external-API failure policy.
- `[ ]` Define environment, secret, backup, rollback, and incident-response procedures.
- `[ ]` Publish privacy, terms, source attribution, content policy, and contact/takedown processes as required by the deployment context.
- `[ ]` Define adult-content filtering and age/content controls without relying on hidden or misleading defaults.

### Phase 5 completion criteria

- A production deployment can be observed, rolled back, and diagnosed without relying on local console output.
- Public routes have correct metadata, indexing behavior, accessible interaction, and measured responsive behavior.
- External failures are visible, bounded, and communicated to viewers without fabricated success states.
- Privacy, content, source attribution, and data-retention decisions are documented before public launch.

**Depends on:** Phase 0; feature-specific checks can ship alongside Phases 1–4.  
**Unblocks:** Public launch confidence and sustainable maintenance.

---

## Explicitly deferred decisions

These are intentional sequencing decisions, not forgotten tasks:

- **AniList genre artwork:** The current AniList genre collection returns names, not artwork. Do not invent genre imagery or add an unlicensed artwork source until there is a real source and a product decision.
- **Multiple AniSource adapters:** The current transport seam is valuable for tests. Do not build a broader provider abstraction until a second materially different Source implementation is real.
- **Community features:** Do not add comments, ratings, reviews, or social lists before identity, moderation, privacy, reporting, and deletion are designed.
- **Large visual redesigns:** Prefer product capability, data-model, and reliability work while the current approved paper/ink/frosted system is coherent.
- **Broad snapshot suites:** Prefer focused tests at module interfaces and real regression cases over snapshots that make visual change expensive without proving behavior.
- **Skip-intro/outro:** AniSource currently exposes no reliable timing metadata. Do not render guessed markers; revisit this item when the upstream contract supports verified timings.

## Milestone release gates

Before marking a milestone `[x]`:

1. The user-visible path exists in production application code, not only in a schema, query, fixture, or prototype.
2. Real loader-backed data and unsupported states are represented honestly.
3. The feature works without a mouse and does not introduce hydration, SSR, focus, reduced-motion, or horizontal-overflow regressions.
4. The relevant external and persistence boundaries validate their inputs.
5. Focused tests cover the highest-risk regression or seam, using mocked transports where external calls are involved.
6. The documented completion criteria for that milestone are all true.

## Changelog

### 2026-09-19

- Completed the implementable Phase 2 playback work:
  - restored saved subtitle/caption preferences, added mobile-friendly wrapped controls, 44px control targets, keyboard shortcut metadata, and optional landscape orientation locking;
  - classified media-level HLS expiry and added fresh-stream recovery, source-health-ranked alternate Source selection, and a two-retry manual Stream limit;
  - documented AniSource uptime, latency, capacity, alerting, and privacy-safe observability expectations;
  - added focused player/session regressions and the required search → detail → Watch → player Playwright smoke journey.
- Audio preference remains intentionally unsupported because AniSource does not return audio streams. Skip-intro/outro remains deferred because AniSource does not return reliable timing metadata.
- Prepared the auth-independent Phase 3 account model:
  - added local-first profile and settings routes with language, timezone, adult-content, and notification preferences;
  - added versioned viewer export/import, local deletion, public AniList list import, and an active `ViewerData` adapter seam;
  - added `RemoteViewerAdapter`, local-to-account migration orchestration, timestamp conflict resolution, deletion tombstones, sync status, and partial-failure handling;
  - documented the local-first synchronization decision in ADR 0002. Authentication, session lifecycle, and the concrete remote adapter remain intentionally deferred.

### 2026-09-18

- Completed Phase 1 (Core Viewer Product):
  - Library: completed full state handling for unavailable metadata, local persistence migration behavior, and full accessibly-mapped filtering. Tab structures migrated to proper tab semantics.
  - Schedule: added timezone-aware day/week views, genre and status filters, library integration, real-time local countdowns, deep Watch linking, and cache invalidation policies. Documented AniList's missing delay/skipping metadata in empty states.
  - Search: ensured mobile navigation and search history behavior matches exact exact-match and deduplication behaviors.
  - Persistence: integrated stale match cleanup by purging source pairings when AniSource removes an upstream source.
  - Verification: component, persistence, and mocked E2E Playwright coverage achieved and tested via full CI gate.

### 2026-09-17

- Created the roadmap from the repository assessment.
- Recorded the current state as a working discovery plus Watch vertical slice.
- Prioritized Library, Continue Watching, Schedule, and playback progress as the next major product milestone.
- Completed Anime detail completeness: expanded validated AniList metadata, alternate titles, canonical entity/resource links, structured themes and tags, Japanese voice-actor identity links, and ordered relation navigation.
- Completed search/discovery depth: typed Home and mobile header search surfaces, bounded IndexedDB search history, grouped exact-title suggestions, and explicit query-versus-suggestion navigation semantics. Dedicated genre routes remain deferred because canonical Explore genre filters already provide the supported behavior.
- Completed Phase 0 (foundation stabilization): initial tracked commit on `feature/solid-tanstack-vertical-slice`; `npm run verify` gate (lint, strict typecheck, Vercel/Nitro build, Vitest, mocked Playwright) reproducible in a clean checkout; `npm start` documented as the Vite preview of the built Vercel/Nitro output; release checklist, deployment procedure, route/data ownership, cache policy, and SSR/client-only boundary audit documented under `docs/`; persistence kept behind the `ViewerData`/`SearchHistory` interfaces; Watch orchestration extracted into tested `createWatchSession`; header search made fully client-side (no reloads, no focus loss); duplicate Hero image styling consolidated; unused AniSource query-key family removed. Deployment itself remains intentionally unexecuted pending a real Vercel release.
