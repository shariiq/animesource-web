# ADR 0001: Editorial paper, ink, and frosted material system

- **Status:** Accepted
- **Date:** 2026-09-17
- **Scope:** Application-wide visual styling and UI composition

## Decision

AnimeSource uses Tailwind CSS v4 through the official `@tailwindcss/vite` plugin. `app/styles/app.css` is the stylesheet entry point and imports, in order, Tailwind, the shared theme, base rules, atmosphere, reusable recipes, and route-specific Explore composition.

The accepted visual language is a **stark editorial and liquid-glass material system** characterized by:

- **Maximum stark minimalist contrast**: E.g. Crisp ink (`--ink: #09090b`) against luminous paper (`--paper: #f8f8fa`) and canvas (`#fafafd`), anchored by razor-sharp hairlines and high-contrast typography.
- **Papery matte surfaces, glass only where it earns it**: Opaque paper fills (`--surface-panel: #fcfcfd`), ink hairlines, and soft diffused shadow carry every component. Backdrop refraction survives only on small floating signatures — the compact header shell, the mobile tab bar, image-led chips — never on page panels, rows, cards, or controls.
- **British industrial minimalism (inspired by nothing.tech)**: Transparent structural layers, raw monospace signal instrumentation (`DM Mono`), dot-matrix precision, and stark monochromatic discipline punctuated by deliberate accent pops.
- **High-density, super-responsive components (inspired by comick.dev and MangaDex)**: Dense, beautifully articulated catalog metadata, fluid multi-rail discovery, comprehensive character/staff/relation graphs, instantaneous client-side search, and frictionless responsive layouts from mobile (390px) to ultra-wide desktop.
- **Niche semantic accent coloring**: Purposeful, vibrant accent roles (`violet`, `plum`, `mint`, `acid`, `orange`, `emerald` etc ) used with surgical restraint rather than overwhelming full-screen tints.

It is distinctly an editorial, liquid-glass, and industrial-minimalist system—not a retro Y2K chrome, Frutiger Aero bubble, skeuomorphic bevel, or dark-glass system. Those early explorations survive only as superseded research history.

The source hierarchy is:

1. production tokens and recipes in `app/styles/theme.css`, `base.css`, `atmosphere.css`, `recipes.css`, and route stylesheets;
2. this ADR for durable visual, composition, interaction, and accessibility invariants;
3. preview files, screenshots, and `docs/research/` as historical visual references only.

Static previews are not product specifications or content sources. They do not define anime titles, artwork, counts, metadata, routes, module interfaces, labels, or exact markup. Production UI always uses validated application data and current route behavior.

## System architecture

The styling system is deliberately layered:

| Layer | Responsibility |
| --- | --- |
| `app/styles/app.css` | Import order and the single application stylesheet entry point. |
| `app/styles/theme.css` | Semantic CSS variables and Tailwind `@theme` mappings for color, type, radii, motion, and shadows. |
| `app/styles/base.css` | Document defaults, body typography, selection, focus visibility, and reduced-motion behavior. |
| `app/styles/atmosphere.css` | Fixed, pointer-transparent background fields and static film grain. |
| `app/styles/recipes.css` | Shared material, control, field, row, search, card, genre, detail, and page recipes. |
| Route stylesheets and utility composition | Responsive information hierarchy and route-specific layout without redefining the material language. |

Shared recipes own reusable appearance and behavior; route composition owns content hierarchy and responsive layout. A richer or more image-led screen must not establish a competing visual system.

## Foundation and palette

The semantic values in `theme.css` are the production baseline.

### Paper, ink, and lines

- `--paper: #f8f8fa` is the luminous paper foundation used inside the composition.
- The document canvas is `#fafafd`, giving paper surfaces a subtle edge without becoming gray or dark.
- `--ink: #09090b` is the primary text and decisive-action color.
- `--line: rgb(9 9 11 / .13)` is the standard hairline.
- `--line-strong: rgb(9 9 11 / .2)` is reserved for stronger control and state boundaries.
- `--line-light: rgb(255 255 255 / .18)` provides specular separation on translucent surfaces.

### Text hierarchy

- `--text-primary: #09090b` for headings and primary content.
- `--text-secondary: #42404b` for readable supporting prose.
- `--text-muted: #4f4e57` for labels and secondary signals that must remain legible.
- `--text-quiet: #777580` for lower-priority metadata.
- `--muted: #62616b` and `--quiet: #8b8993` are additional subdued semantic values; they are not substitutes for reducing opacity until text becomes unreadable.

### Accent palette

Accents communicate hierarchy or state and should remain localized rather than becoming full-screen themes unless required for better design:

- violet `#7665e8` — focus, editorial emphasis, and selected accents;
- plum `#ae6a8d` — atmospheric warmth;
- mint `#9de4c4` and acid `#d9f56a` — selective categorization or decorative energy;
- orange `#fa775f` — warm emphasis;
- emerald `#00c853` — positive, live, or available state.

Do not assign accent colors arbitrarily per route. A repeated meaning should receive a semantic token or recipe.

## Design influences and adaptation

External products are direction references, not templates. AnimeSource adapts principles from them while retaining its own tokens, production data, interaction semantics, and component implementation:

- **nothing.tech** informs the British industrial character: monochrome clarity, exposed information structure, technical mono labeling, disciplined negative space, and small high-energy color signals. AnimeSource does not reproduce Nothing branding, proprietary dot treatments, or product layouts.
- **comick.dev** informs responsive catalog utility: fast search-to-content paths, rich but scannable metadata, efficient card and chapter-density patterns, and mobile compositions that remain useful rather than merely collapsing.
- **MangaDex** informs information architecture for a deep media catalog: clear title identity, relationships, people and production credits, status signals, and high-density browsing that stays navigable across screen sizes.

These references set a quality bar—exceptional polish, detail, responsiveness, and information utility—not permission to copy branding, markup, or exact component appearance. Every borrowed principle must be translated into this system's stark ink/paper contrast, liquid-glass depth, typography, semantic colors, accessibility rules, and validated anime data.

## Typography

The three-family hierarchy is a core part of the visual identity:

- **Instrument Serif** (`--font-display`) is the expressive editorial voice. Use it for mastheads, route and section titles, prominent anime titles, and restrained italic emphasis. Its generous scale and tight display tracking create hierarchy; it should not replace UI copy.
- **Manrope** (`--font-body`) is the reading and interface face. Use it for descriptions, navigation, button text where the recipe calls for body type, and dense content that must remain clear.
- **DM Mono** (`--font-mono`) is the signal face. Use it for metadata, status, dates, scores, episode counts, compact labels, and technical state. It is normally small, uppercase, and deliberately tracked.

The font fallbacks in `theme.css` are required: Georgia for display, `system-ui` for body, and `ui-monospace` for signals. Pages must remain legible if remote web fonts are unavailable.

## Liquid glass, material, and depth

Glass is a signature accent, not the default material. Components read as matte paper — opaque fills, ink hairlines, soft shadow — because frosted-everything is what makes interfaces read as generic SaaS. The header shell, floating tab bar, and chips over artwork keep their refraction; everything a viewer reads (panels, rows, cards, fields, rails) is paper.

Paper stays credible because the canvas behind it has tooth: a flat `#f2f2f4` field, one fine fractal-grain tile, and the dot-matrix registration layer. Depth comes from hairlines and restrained shadow rather than translucency.

### Surface tokens

- `--surface-panel: #fcfcfd` — opaque panel fill.
- `--surface-control: #ffffff` — opaque interactive controls.
- `--surface-soft: #f4f4f6` — quiet rows and nested surfaces.
- `--shadow-panel: 0 28px 80px -50px rgb(0 0 0 / .35)` — restrained panel lift.
- `--shadow-glass: 0 38px 110px -40px rgb(0 0 0 / .38), inset 0 1.5px rgb(255 255 255)` — header shell and floating signatures only.

### Surface recipes

- `frosted-shell` is the compact header signature: high-opacity white edge, translucent fill, `blur(64px) saturate(200%)`, and `--shadow-glass`. It is the exception, not the rule.
- `material-panel` is the paper panel: a `22px` radius, opaque `--surface-panel`, ink hairline, restrained lift, and a fine inset white highlight. No backdrop blur.
- `editorial-row` is a low-depth repeating item on `--surface-soft` grey with a bottom hairline, lifting to white on hover.
- Image-led surfaces may use a localized scrim or more opaque nested surface to protect text. Do not dim or wash the entire artwork when a local treatment is sufficient.

Material effects are progressive enhancement. Content order, contrast, and separation must remain understandable when backdrop filtering is unavailable.

## Shape, spacing, and controls

The shared shape and control metrics are:

- `--radius-control: 10px`;
- `--radius-panel: 22px`;
- `--radius-shell: 26px`;
- `--control-height: 42px`;
- `--prominent-control-height: 54px`;
- `--ease: cubic-bezier(.16, 1, .3, 1)` / Tailwind `--ease-fluid`.

Use these named values before inventing local geometry. A route-specific measurement is acceptable only when it expresses a real composition constraint rather than duplicating an existing token.

`ink-control` is the decisive action: ink fill, white label, mono signal typography, and a compact radius. `paper-control` is the secondary action: translucent paper, strong hairline, and ink label. `editorial-field` is the input/select control primitive and receives an ink border, white fill, and violet focus halo on keyboard focus. Form fields must be wrapped in `editorial-field-group` (or equivalent grid composition with the standard 8px gap and mono label typography) to ensure full-width alignment, cursor behavior, and consistent vertical rhythm across Explore, Schedule, and Detail surfaces.

Do not override standard control heights (e.g. `h-9` or `h-8`) with ad-hoc utility classes. Controls composed as one visual unit share height and baseline. Prominent search or input/action pairs use the prominent control height; ordinary controls use the standard control height (`42px`). Rounded pill geometry is reserved for search, tags, and compact categorical controls rather than applied indiscriminately.

## Atmospheric composition

The background is a flat paper canvas with tooth, not content and not a per-route hero treatment:

- `app-background` supplies the fixed `#f2f2f4` field with a whisper of top light.
- `atmospheric-ink` and `atmospheric-depth` are the only two monochrome shadow masses keeping the paper from washing out.
- `film-grain` is a single fine fractal-grain tile at whisper opacity — tooth, not speckle.
- `dot-grid` keeps the dot-matrix registration layer at the viewport edges.

Every atmospheric layer is fixed or absolutely positioned, static, decorative, `pointer-events: none`, and placed behind or above content only as intended by its recipe. Grain must never intercept input, animate, or become an excuse for insufficient text contrast.

## Shared composition recipes

New screens should begin with the existing vocabulary:

- `editorial-page` / `PageShell` establish the centered page width, side gutters, and vertical rhythm.
- `SectionHeading` establishes the shared section title and description hierarchy without decorative numbering by default.
- `frosted-shell` and `material-panel` establish primary and nested surface depth.
- `ink-control`, `paper-control`, and `editorial-field` establish actions and form controls. `editorial-field-group` composes a labeled form field with standard typography, gap, and sizing; use it instead of restating label, gap, and width classes per consumer.
- `editorial-row` establishes repeated list and result behavior.
- `search-surface` recipes establish compact and full query composition, popovers, result states, and keyboard-focused selection.
- `genre-tile`, `card`, `detail-section`, `detail-panel`, and `explore-grid` provide the existing discovery and detail compositions.

Recipes may be combined with Tailwind utilities for layout, but consumers should not restate the recipe's color, blur, border, radius, shadow, typography, or interaction contract. When several consumers need the same variation, deepen the shared recipe instead of copying a literal class sequence.

### Field placement contexts

A CSS primitive such as `editorial-field` is not a finished component. Its visual quality depends on the surrounding field-group composition. Three placement contexts use the same field primitive and control height but differ in surrounding composition:

- **Filter deck** (Explore, Schedule): Horizontal grid of labeled fields inside a `material-panel`. Labels and fields are evenly spaced via route-specific grid columns. Fields are full-width within each column.
- **Dense row editor** (Library cards): Compact inline label and select within an `editorial-row`. The field group fits alongside a remove action within limited row depth. Use `editorial-field-group` at the narrower width.
- **Hero-side action module** (Detail page poster column): A quiet nested translucent surface beneath a primary action button. The field sits inside a visually distinct container with its own border, radius, backdrop blur, and ambient shadow. A status signal above the select shows the current value before the select is opened.

All three share: `editorial-field` as the primitive, `--control-height` (`42px`), `--radius-control` (`10px`), `--line-strong` border, `--surface-control` fill, mono uppercase label typography, violet focus halo, and the standard custom select arrow. Matching class names between contexts does not guarantee visual equivalence; rendered inspection at desktop and ~390px is required.

## Responsive and image-led composition

Every route must remain coherent around 390px and preserve at least the established page gutter. Flex and grid compositions should wrap or stack intentionally; the document must never depend on page-level horizontal scrolling.

Artwork uses explicit geometry, `object-fit`, and an intentional `object-position`. Do not add arbitrary scale transforms to compensate for an unstable frame. Text over artwork requires localized contrast that protects title, metadata, and actions while preserving visible artwork on the non-text side. Below-the-fold images should be lazy-loaded and all meaningful imagery needs useful alternate text.

## Product and interaction contracts

- Home and Explore consume loader/query-backed, Zod-validated AniList data. Prototype content is never a production fallback.
- Explore intent uses typed `BrowseSearch` state and `makeBrowseSearch`; links do not hand-build untyped query strings.
- Supported detail metadata links to real destinations. Unsupported metadata remains informative rather than becoming a dead control.
- AniSource belongs only to mounted Watch and Manga Reader routes and is never called by SSR, discovery loading, or initial shared-layout execution.
- Navigation uses semantic links; actions use buttons; fields have programmatic labels and relationships.
- Search has an explicit path: selecting a suggestion opens its detail route, while submitting typed text opens full Explore results without a document reload.

## Accessibility, motion, and performance

- Global `:focus-visible` uses a visible violet outline with offset; recipes may add compatible local focus treatment but must not remove the global signal.
- `prefers-reduced-motion: reduce` removes nonessential transition and animation duration and disables smooth scrolling.
- Atmospheric blur, backdrop filtering, and grain remain static. Do not animate large filters, shadows, or gradients.
- Hover translation is subtle and supplementary; state cannot rely on motion alone.
- Text contrast must be evaluated on the composited surface, especially over artwork and translucent panels.
- Missing optional AniList metadata is omitted without fabricated copy or empty ornamental shells.
- The system supports keyboard and touch use, stable image geometry, and no horizontal overflow.

## Why

Early preview work explored glossy Y2K and Frutiger-Aero chrome. Production evolved toward a quieter editorial identity that better supports dense, real anime metadata across Home, Explore, detail, and Watch. Paper and ink provide decisive hierarchy; frosted surfaces preserve atmospheric depth without competing with artwork; the three-part type system separates expression, reading, and machine-like signals.

Keeping tokens, recipes, atmosphere, and route composition in distinct layers provides a small shared interface with strong leverage. Visual fixes remain local, screens stay related without becoming identical, and historical previews cannot silently override production behavior or real data.

## Verification

A visual change is verified with real loader-backed data at desktop and approximately 390px widths. Inspect the affected route and at least one neighboring route when a shared token or recipe changes.

Check:

- paper, ink, line, surface, and text-token consistency;
- display/body/mono hierarchy and fallback legibility;
- shell and panel translucency, edge separation, and localized artwork contrast;
- control heights, alignment, focus visibility, keyboard behavior, and touch usability;
- atmosphere and grain remaining static and pointer-transparent;
- stable image framing and no page-level horizontal overflow;
- reduced-motion behavior;
- typed route intent and client-side navigation for interactive discovery surfaces.

Behavioral regression tests should cover reported failures and route intent rather than asserting only that a parent section renders. External transports use mocks in CI; live AniList and AniSource calls do not.

## Design improvement and justified exceptions

Visual specifications, recipes, and constraints exist to ensure cohesive quality, not to preserve accidental awkwardness. When an existing recipe or layout constraint produces an inferior, cluttered, or inconsistent result in a specific context:

1. **Design quality over slavish repetition:** Prioritize the overall aesthetic principles (clean typographic contrast, optical depth, disciplined spacing, and crisp edge delineation) over mechanically copying a poorly-fitted component recipe.
2. **Deepen recipes over isolated hacks:** When a new placement context reveals a gap in the shared system (such as missing field-group wrappers or context-specific container treatments), generalize and formalize the solution in shared recipes rather than writing isolated inline style overrides.
3. **Preserve invariants:** Every design variation must still honor foundational invariants: WCAG AA contrast, explicit keyboard focus visibility, zero horizontal overflow at 390px, standard semantic token usage, and reliance on validated production data.
4. **Side-by-side rendered inspection:** Any exception or improvement must be evaluated side by side with existing routes in real browser viewports (desktop and mobile) to confirm visual harmony across the application.

## AUTOMATICALLY SELF IMPROVE DESIGN
any of these instructions or contraints or suggestions are authorized and allowed to be overidden freely completely in place of a genuinely better design for any or ALL piece of design/UI/UX in the website.
