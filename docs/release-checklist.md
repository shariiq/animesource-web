# Release checklist

Run this checklist against the commit being released. Do not mark a release ready from compilation alone.

## Automated gate

- [ ] `npm ci` succeeds from a clean checkout.
- [ ] `npm run verify` succeeds: lint, strict typecheck, Vercel/Nitro build, Vitest, and mocked Playwright.
- [ ] `git status` contains no generated output, reports, `.env` files, or local Claude settings.
- [ ] CI uses `tests/e2e/mock-api.mjs` and has no live AniList/AniSource dependency.
- [ ] The scheduled `live-smoke` workflow (see `docs/ci.md`) is understood to be operational only: its failures open an issue and never gate the release.

## Route smoke checks

- [ ] Home renders real AniList-backed hero and rails.
- [ ] Header search accepts sequential typing without a document reload, renders suggestions, and navigates client-side to detail or Explore as appropriate.
- [ ] Explore filters and query state survive typed navigation and show loading, empty, and failure states.
- [ ] Detail renders validated metadata, genre route intent, and favorite load/toggle behavior.
- [ ] Watch mounts as its own nested route, resolves a Source only after client mount, supports Match/picker/episodes/servers/streams, and mounts the player.
- [ ] Watch cold-start, error, empty-server, and empty-stream states are recoverable and understandable.

## Data and SSR checks

- [ ] AniList GraphQL errors, network failures, and malformed payloads are rejected at the schema seam.
- [ ] AniSource is not contacted by SSR, discovery loaders, route prefetch, or initial shared-layout execution.
- [ ] IndexedDB is not touched during SSR and all browser reads/writes pass the versioned Zod schemas.
- [ ] Viewer data remains behind `ViewerData`/`SearchHistory`, so future remote adapters do not require UI rewrites.

## Visual and accessibility checks

- [ ] Inspect desktop and approximately 390px layouts for Home, Explore, detail, and Watch.
- [ ] Confirm side gutters, stable image geometry, readable contrast, visible focus, keyboard search navigation, and no horizontal overflow.
- [ ] Confirm reduced-motion behavior remains honored.

## Vercel operations

- [ ] Preview output is generated under `.vercel/output/` by the Nitro Vercel preset, and `npm start` serves the built routes over HTTP.
- [ ] Preview environment values are public endpoint overrides only; no secret is exposed through `VITE_`.
- [ ] Production promotion has a named release owner.
- [ ] The previous known-good deployment is identified so the release owner can roll back if needed.
