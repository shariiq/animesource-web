# ADR 0001: Tailwind-driven editorial material system

- **Status:** Accepted
- **Date:** 2026-09-17
- **Scope:** Application-wide visual styling and UI composition

## Decision

AniSource uses Tailwind CSS v4 through the official `@tailwindcss/vite` plugin. The stylesheet entry point is `app/styles/app.css`, which composes the shared theme, base, atmosphere, reusable recipes, and Explore route styles.

The current production code and this ADR are the sources of truth. The source hierarchy is:

1. implemented tokens and recipes in `app/styles/theme.css`, `base.css`, `atmosphere.css`, `recipes.css`, and route stylesheets;
2. this ADR for durable visual and interaction invariants;
3. `design-preview-components.html`,related screenshots, and research notes as historical visual references for the editorial material direction.

The static previews are not production specifications. They are not sources for anime titles, artwork, counts, metadata, route contracts, component APIs, labels, section numbering, or exact markup. Their placeholder content must never enter production. Real, validated AniList data and the current route behavior remain authoritative.

The adopted visual language is a light editorial composition built from luminous paper and frosted foreground surfaces, strong ink typography and controls, restrained atmospheric forms, fine hairlines, rounded shells, and localized contrast treatments where imagery threatens legibility. The system is intentionally allowed to evolve beyond the original preview while preserving this material and typographic character.

## Visual system

### Tokens

Shared values live in `app/styles/theme.css` as CSS custom properties and Tailwind `@theme` tokens. The current baseline is:

- **Foundation:** ink `#09090b`, paper `#f8f8fa`, page `#fafafd`, and hairline `rgba(9,9,11,.13)`.
- **Text:** primary ink `#09090b`, readable secondary `#42404b`, muted signal `#4f4e57`, and quiet metadata `#777580`.
- **Accents:** violet `#7665e8`, plum `#ae6a8d`, mint `#9de4c4`, acid `#d9f56a`, orange `#fa775f`, and emerald `#00c853`.
- **Type:** Instrument Serif for editorial display type, Manrope for body/interface copy, and DM Mono for metadata and status signals.
- **Shape:** rounded controls, panels, and feature shells using the measured radius tokens rather than arbitrary per-screen geometry.
- **Material:** translucent white surfaces, white edge highlights, fine dark dividers, static grain, localized atmosphere, and restrained shadows.
- **Motion:** `cubic-bezier(.16, 1, .3, 1)` for nonessential transitions; reduced-motion rules in `app/styles/base.css` remain authoritative.

When a new value is needed, add or reuse a semantic token before repeating a literal. A route-specific value is appropriate only when it expresses a real composition constraint and cannot be shared.

### Composition rules

- `PageShell`, `material-panel`, `frosted-shell`, `ink-control`, `paper-control`, and `editorial-field` are the shared building blocks for page frames, surfaces, actions, and fields.
- `SectionHeading` uses one title/description alignment system and does not show decorative numbering by default. A route may add an index only when it carries navigational meaning.
- Rails, cards, genre navigation, and telemetry/fact panels are data-driven components. They may vary in layout for their route, but should continue using the shared surfaces, type, borders, focus treatment, and motion.
- Route stylesheets own responsive composition; shared recipes own reusable material behavior. New screens should not create a competing visual language merely because their content is richer or image-led.
- Every responsive composition must remain usable around 390px, preserve side gutters, and avoid page-level horizontal overflow.

### Image-led surfaces

Featured artwork remains inside a clipped, rounded shell with explicit `object-fit`, stable geometry, and a deliberate `object-position`. Do not use an accidental extra scale or crop to compensate for an unstable frame. Text over artwork must use a localized editorial scrim or surface treatment that protects the title, metadata, genres, and actions without washing over the entire image or turning the feature into a separate dark hero page. Preserve the shared frosted/paper/ink language and the visibility of the artwork on the non-text side.

## Current product contracts

- **Discovery data:** Home and Explore use loader/query-backed, Zod-validated AniList responses. The relevant boundaries are `app/data/anilist/schema.ts`, `app/data/anilist/queries.ts`, and `app/data/options.ts`. Prototype data is never a fallback for production content.
- **Discovery route state:** Explore filters use the typed `BrowseSearch` schema and `makeBrowseSearch` in `app/lib/browse`. Any link that targets discovery must preserve its intended query state through the typed route search rather than constructing an untyped URL by hand.
- **Detail discovery:** AniList genres displayed on an anime detail page are actionable links to `/explore` carrying the selected genre. Tags or other metadata without a supported destination remain non-interactive.
- **Playback boundary:** AniSource is used only by the nested watch route and only after client-side interaction/page mounting. It must never be called during SSR or as a discovery-page preload. AniList detail data, playback state, and IndexedDB persistence are separate concerns.
- **Navigation and accessibility:** Use semantic links for navigation and buttons for actions. Preserve visible `:focus-visible`, keyboard interaction, correct labels/relationships, reduced-motion behavior, meaningful image geometry and alternate text, and readable contrast.

## Why

The first static preview was useful for establishing the editorial material direction, but it cannot describe the full application. The production system now has multiple data-backed routes, typed search state, client-only playback, persistence, responsive behavior, and evolving shared recipes. Treating the preview as an immutable specification would preserve stale labels and layout assumptions and would encourage placeholder content or one-off styling. The source hierarchy above keeps the visual intent while allowing the implementation and durable ADR rules to evolve safely.

The shared semantic layer is intentionally small: `theme.css` owns palette, text hierarchy, surfaces, radii, type, and motion tokens; `recipes.css` owns reusable shells, fields, controls, rows, and media surfaces; route stylesheets own layout and responsive composition. New UI should consume these layers before adding a one-off visual value.

Controls composed as one visual unit must share a common block height and baseline alignment. Prominent input/action pairs use the named prominent-control height token, while ordinary controls use the standard control token. Search fields need an explicit user-visible path: selecting a suggestion opens its detail route, and submitting a typed query without an active suggestion opens full Explore results.

## Accessibility and performance constraints

- Existing semantic links, buttons, form controls, ARIA relationships, keyboard behavior, and route behavior are preserved.
- `:focus-visible` remains clearly visible with an offset and sufficient contrast.
- `prefers-reduced-motion: reduce` removes nonessential motion and smooth scrolling.
- Grain and backdrop effects remain static and pointer-transparent; they must not block controls or become animated decoration.
- Images retain explicit geometry, meaningful alternate text where applicable, lazy loading below the fold, and asynchronous decoding where appropriate.
- Missing optional AniList metadata is omitted without fabricated replacement content or empty visual shells.
- No design treatment may introduce horizontal page overflow or make an interactive control inaccessible at narrow widths.

## Verification

A visual change is verified against real loader-backed data at desktop and approximately 390px widths. Review the affected route and at least one neighboring route for shared material consistency rather than comparing only against the static preview.

For discovery and image-led surfaces, inspect:

- Hero artwork framing, object position, localized text contrast, carousel controls, and narrow stacking;
- shared shell, panel, control, heading, and typography consistency across Home, Explore, detail, and Watch;
- typed search submission and detail-page genre-link route intent;
- semantic focus states, keyboard operation, reduced-motion behavior, and absence of horizontal overflow.

Component regression tests should cover reported failures and assert behavior and route intent, not only that a parent section renders. Transport tests use mocks; live AniList and AniSource calls never run in CI. Playwright remains deferred until the watch pipeline is feature-complete, at which point the project should add the single smoke path required by `CLAUDE.md` rather than a broad visual snapshot suite.
