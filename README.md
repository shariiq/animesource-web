# AniSource Web

A SolidJS anime and manga discovery platform with anime playback and manga reading, built with TanStack Start, TanStack Router, Solid Query, AniList, and AniSource.

## Requirements

- Node.js 22.12.0 or newer
- Bun 1.4+

## Development

```bash
bun install --frozen-lockfile
bun run dev
```

The development server runs at `http://localhost:3000`.

Copy `.env.example` to `.env` only when local endpoint overrides are needed. The checked-in defaults live in `config/api-urls.json`:

```dotenv
# VITE_ANILIST_API_URL=https://graphql.anilist.co
```

AniSource is reached through the same-origin server gateway. Its base URL and credentials are server-only; never use a `VITE_` prefix for them. See [AniSource access control](docs/deployment/anisource-access-control.md) before configuring a deployment.

## Verification

The repository uses two separate CI tracks:

- **Deterministic merge gate** — `bun run verify` runs ESLint with zero warnings, strict TypeScript checking, the Nitro/Vercel build, Vitest, and mocked Playwright E2E tests. CI uses `tests/e2e/mock-api.mjs` and never calls live AniList or AniSource services.
- **Live operational smoke** — `bun run test:live` checks the real AniList service, AniSource health, and verifies that an unauthenticated catalog request is denied. It never sends an API credential. GitHub runs it twice daily and on manual dispatch; it is operational only and does not block merges.

Run the complete local gate with:

```bash
bun run verify
```

Run the real-service smoke checks when service health needs verification:

```bash
bun run test:live
```

## Production build

```bash
bun run build
bun start
```

The Nitro Vercel preset emits `.vercel/output/`. This generated directory is not committed. See [`docs/deployment/vercel.md`](docs/deployment/vercel.md) for deployment and rollback guidance.

## Documentation

- [`docs/ci.md`](docs/ci.md) — deterministic CI and live operational smoke tracks
- [`docs/release-checklist.md`](docs/release-checklist.md) — release verification checklist
- [`docs/deployment/vercel.md`](docs/deployment/vercel.md) — Vercel build and deployment contract
- [`ROADMAP.md`](ROADMAP.md) — product milestones and delivery plan
