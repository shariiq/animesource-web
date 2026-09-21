# Vercel deployment

## Build contract

The repository uses the official Nitro Vite integration with the `vercel` preset in `vite.config.ts`. Run:

```bash
bun install --frozen-lockfile
bun run build
```

The build emits the Vercel Build Output API directory at `.vercel/output/`, including static assets, the `__server` function, and `config.json`. `.vercel/` is generated output and must never be committed. Vercel can deploy the prebuilt output with `bunx vercel deploy --prebuilt`; normal Vercel builds should use the repository's `bun run build` command and detect the generated output.

For local production inspection after a build, run `bun start` and open the printed Vite preview URL (or use `bunx vite preview --host 127.0.0.1 --port 4173`). This serves the generated `.vercel/output/static` assets and SSR application produced by the Nitro Vercel build. Do not execute `.vercel/output/functions/__server.func/index.mjs` directly: it is a Vercel function entrypoint, not a standalone local HTTP server. Do not use the old `.output/server/index.mjs` path; this project targets the Vercel output contract.

## Environment

Copy `.env.example` to `.env` for local development only when overrides are needed. `config/api-urls.json` is the checked-in source of truth for public defaults; `VITE_ANILIST_API_URL` and `VITE_ANISOURCE_BASE` are optional build-time overrides, not credentials. Configure overrides in Vercel's Preview and Production environments only when a deployment needs values different from that file.

Playwright and CI override both values with `tests/e2e/mock-api.mjs`. CI must never call either live external service.

The merge-gate workflow (`verify.yml`) is deterministic and mock-only. A separate scheduled workflow, `live-smoke.yml`, exercises the real services (`bun run test:live`) twice daily and on manual dispatch. It is operational only: its failures open an issue for the deploy owner and never block a merge, preview, or production promotion. See `docs/ci.md`.

## Preview and release procedure

1. Run `bun install --frozen-lockfile` and `bun run verify` from a clean checkout.
2. Open a Vercel Preview deployment and inspect `/`, `/explore`, `/anime/<id>`, and `/anime/<id>/watch/next` with representative real AniList data. Confirm the Watch route does not contact AniSource until it mounts in the browser.
3. Exercise header search, keyboard controls, favorite persistence, source matching, episode/server selection, and the player at desktop and approximately 390px. Check there is no horizontal overflow.
4. Promote only the verified commit to Production.
5. If a production regression appears, the release owner rolls back to the previous known-good Vercel deployment. Record the incident and follow-up issue; do not patch by weakening checks or by introducing fixture data into the production path.

Deployment and rollback are intentionally documented here but not executed by the local Phase 0 work.
