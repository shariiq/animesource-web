# Y2K / Frutiger-Aero chrome navigation & glossy buttons — research note

Directive: research a focused component-preview (chrome nav + glossy beveled buttons) for the AniSource UI/UX pass. This note grounds the visual direction in primary sources and gives concrete, performance-safe CSS construction recipes. It informed `design-preview-components.html`; no product application code was changed.

> **Historical / superseded direction.** This note records an early Y2K/Frutiger-Aero exploration. Its glossy chrome treatment, Quicksand/Comfortaa alternatives, and open decision gates are not current product requirements. The adopted system is the editorial paper/ink/frosted material system in `docs/adr/0001-editorial-material-system.md`, implemented by the current tokens and recipes in `app/styles/`. Keep the research and citations for historical context, but do not use this note or the preview as a production component contract.

Sources are cited inline. Where only a secondary summary was obtainable, it is labeled as such.

## 1. Source-backed visual traits (what the look actually is)

Frutiger Aero (2004–2013; Windows Vista/Aero 2006, Windows 7 2009, Wii, first-gen iPhone, Galaxy S, *The Sims 3*) is characterized by Wikipedia ([en.wikipedia.org/wiki/Frutiger_Aero](https://en.wikipedia.org/wiki/Frutiger_Aero)) as:

- **Bright optimistic colors**, especially blues, greens, yellows — "reflective of the optimistic theme."
- **Nature/swirl motifs**: blue skies, grass, aurorae, lens flares, bokeh, water, tropical fish — "the natural as intertwined with a digital future."
- **Translucency** as a hallmark — glass/acrylic panels.
- **Reflective, glossy, three-dimensional** surfaces with pronounced specular highlight bands; skeuomorphism (glossy icons). The style was also called "Web 2.0 Gloss."
- Preceded by Y2K retro-futurism (chrome, glass, iridescent gradients) and succeeded by flat design.

MDN documents the concrete material that delivers the gloss: **an inset top highlight + bottom inner shade + outer drop shadow**, and **a metallic sweep built from narrow light stops sandwiched between dark stops**:

```css
box-shadow:
  inset 0 1px 0 rgb(255 255 255 / .4),   /* top gloss highlight */
  inset 0 -2px 0 rgb(0 0 0 / .2),         /* bottom inner bevel shade */
  0 1px 3px rgb(0 0 0 / .3);              /* outer drop shadow */
```

([developer.mozilla.org/en-US/docs/Web/CSS/box-shadow](https://developer.mozilla.org/en-US/docs/Web/CSS/box-shadow))

Metallic sweep (highlight band along the gradient axis):

```css
background: linear-gradient(
  115deg,
  #4b536b 0%, #4b536b 40%,
  #f4f7ff 42%, #f4f7ff 46%,   /* specular highlight band */
  #5c6883 48%, #2b3246 100%
);
```

([developer.mozilla.org/en-US/docs/Web/CSS/gradient/linear-gradient](https://developer.mozilla.org/en-US/docs/Web/CSS/gradient/linear-gradient))

## 2. Iridescent / oil-slick chrome

The user asked to push the palette "toward iridescent lilac/ice-blue/chrome" rather than navy + one blue accent. Technique: layer several low-opacity gradients at different angles with translucent color stops (MDN: gradients are `<image>` layers; **first listed paints on top**, transparent stops let lower layers show). This creates the multi-hue sheen of iridescent chrome without going to an extreme rainbow:

```css
background:
  linear-gradient(160deg, rgb(185 162 255 / .22), transparent 42%),
  linear-gradient(15deg,  rgb(141 218 255 / .28), transparent 30%),
  linear-gradient(115deg, #41495f 0%, #6f7ba0 38%, #f2f5ff 44%, #5b6a92 50%, #2c3448 100%);
```

Base chrome reads on every accent; iridescence only in the sweep.

## 3. Grain / noise texture

Two source-backed ways to add "visible grain on the hero surface," both avoiding extra DOM:

1. **Repeating radial speckle layer** on top of a gradient ([developer.mozilla.org/en-US/docs/Web/CSS/background-image](https://developer.mozilla.org/en-US/docs/Web/CSS/background-image)):

```css
background-image:
  repeating-radial-gradient(circle at 0 0, rgb(255 255 255 / .05) 0 1px, transparent 1px 4px),
  linear-gradient(...);
background-size: 180px 180px, cover;
```

2. An **SVG turbulence data-URI** as a topmost layer (stronger, film-grain look). Both must be a *static* background — never animated (see §5).

## 4. Typeface recommendation (display)

User: replace the serif display with a "rounded/bubble sans — original iPod, PS2 dashboard, Winamp skins, Frutiger Aero."

- **Quicksand** (primary recommend). Geometric sans with rounded terminals; created 2008 by Andrew Paglinawan, redrawn 2013 with a raised x-height (500 → 515) and refined spacing — "made chiefly for display use while remaining usable at smaller sizes" ([github.com/andrew-paglinawan/QuicksandFamily](https://github.com/andrew-paglinawan/QuicksandFamily)). Weight range Light–Bold. Soft, optimistic, futuristic bubble — the closest thematic fit on Google Fonts. Pair with Inter body + DM Mono metadata (kept from the existing system).
- **Comfortaa** — alternate: geometric, circular, rounder bubble; reads more "winamp/Frutiger" but less crisp at small sizes.
- **Poppins** — alternate: clean geometric circle sans (Futura-like), more neutral/less bubbly.

For the biggest chrome label (index tabs, buttons) DM Mono stays, but button labels may switch to the rounded display for the early-2000s feel. Apply tight display tracking; comfortable type scale kept.

Family sources: [fonts.google.com/specimen/Quicksand](https://fonts.google.com/specimen/Quicksand), [fonts.google.com/specimen/Comfortaa](https://fonts.google.com/specimen/Comfortaa).

## 5. Accessibility & performance limits (non-negotiable)

- **Animate `transform` / `opacity` only.** MDN: these can run on the compositor without layout/repaint; never animate layout props (`width/height/top/margins`) or paint-heavy effects (large box-shadow, `filter`/blur, complex gradients). ([CSS_JavaScript_animation_performance](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/CSS_JavaScript_animation_performance))
- **Frosted material via `backdrop-filter`**, never `filter: blur()` on a text container (blur() blurs descendants too). Keep blur small and static; put frosted material on a background layer/pseudo-element with text above it, and give a more-opaque fallback behind text for contrast. Use `@supports not (backdrop-filter: blur(1px))` fallback. ([filter-function/blur](https://developer.mozilla.org/en-US/docs/Web/CSS/filter-function/blur))
- **`prefers-reduced-motion`**: reduce/remove nonessential motion (scaling, panning, parallax, continuous animation); keep immediate state feedback; place rules after defaults so they win the cascade. ([@media/prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion))
- **Grain/bloom are static layers** — pointer-events:none, no animation, modest opacity so text scrims still win contrast.
- Visible focus ring for every interactive element; keep the DOM semantic (buttons on buttons, links on links) so the gloss is purely cosmetic.

## Historical synthesis for the component preview

The focused preview (`design-preview-components.html`) was created to show, at a larger scale, the two early exploration surfaces:
1. **Nav / utility bar** — chrome blade using the metallic sweep + iridescent layering, an inset gloss top edge, the brand/search as frosted inset wells with a specular highlight.
2. **Buttons** — primary glossy/chrome (metallic sweep + inset top highlight + outer glow), ghost glass, and chip/server-chip variants — each with glossy bevel dimensionality and a visible focus ring, plus a reduced-motion pass that keeps state feedback but removes movement.

The old decision gates about chrome hue, iridescence strength, and alternate rounded display fonts are closed by the adopted editorial material system. Refer to ADR 0001 and the current `app/styles/` tokens and recipes for implementation guidance.
