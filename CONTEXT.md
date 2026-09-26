# AnimeSource

A web platform combining AniList discovery and catalog metadata with on-demand anime streaming and manga reading through AniSource providers.

## Language

### Discovery & Catalog

**Anime**:
An animated production cataloged on AniList, carrying canonical metadata, titles, and release schedules.
_Avoid_: Show, series, title, media item

**Manga**:
A comic or light-novel publication cataloged on AniList, carrying canonical metadata and a source-specific chapter list.
_Avoid_: series, title, media item

**Discovery**:
The browsing, filtering, and recommendation surfaces that help viewers find anime and manga.
_Avoid_: Feed, catalog, explore feed

**Rail**:
A curated or categorized list of anime or manga cards on discovery pages. A rail may use a horizontal track or a responsive wrapping grid depending on the route and available width.
_Avoid_: Carousel, shelf, row, slider

**Hero**:
The featured broadcast billboard presenting trending or spotlighted anime at the top of discovery.
_Avoid_: Banner, spotlight, slider

### Playback & Sources

**Source**:
An external media provider that indexes anime episodes or manga chapters and pages.
_Avoid_: Provider, site, scraper, backend

**Candidate**:
A prospective anime or manga record returned by a Source search to be evaluated for title matching.
_Avoid_: Search result, matched item, hit

**Match**:
The established association between an AniList Anime and a specific Source entity.
_Avoid_: Mapping, pairing, link

**Server**:
A video host within a Source that delivers streaming links for an episode.
_Avoid_: Host, mirror, embed, video provider

**Stream**:
A playable video stream manifest (such as HLS or direct MP4) with associated quality and subtitle tracks.
_Avoid_: Video, source file, feed, link

**Episode**:
A single numbered installment of an anime available for playback.
_Avoid_: Part, video

**Chapter**:
A numbered manga installment returned by a Source and opened in the Reader.
_Avoid_: Part, episode

**Page**:
An ordered manga image in a Chapter, loaded by the Reader from the AniSource page endpoint.
_Avoid_: Panel, frame

**Capability**:
A short-lived, session-bound signed token minted by the website and verified by the AniSource gateway and API. It authorizes one playback by binding an exact media URL to the website session that requested it.
_Avoid_: Password, shared key, bearer URL

**Session**:
An anonymous browser session issued only for a solved proof-of-work challenge, carried in an HttpOnly cookie. Every gateway route but health requires a live one; sessions expire after 2 hours and carry the issuing-network fingerprint, which media resolution enforces (drift re-verifies transparently).
_Avoid_: Account, login, user

**Challenge**:
A single-use, server-signed computational puzzle binding a difficulty and the requesting network. Solving it proves a JavaScript engine spent real time; it prices bulk automation without identifying anyone. Issuance and exchange carry tight per-network budgets with difficulty escalation under pressure.
_Avoid_: CAPTCHA, puzzle page, bot check

**Attestation**:
Coarse environment signals (automation flag, counts, viewport) plus a required schema version and client week shipped with a proof-of-work exchange. Missing values are malformed; stale versions or weeks answer upgrade-and-reload. Scored to price automation with shorter sessions and hotter puzzles; never blocks, because client-asserted signals are forgeable.
_Avoid_: Fingerprint, tracking, bot score

**Reader**:
The client-only route that loads manga chapters and pages, records local position, and provides reading controls.
_Avoid_: Viewer, document viewer

### Persistence & Library

**Favorite**:
An anime or manga saved to the viewer's local library for quick access.
_Avoid_: Bookmark, watchlisted, saved anime

**Continue Watching**:
The record of a viewer's most recent playback progress, episode selection, and source pairing for an anime.
_Avoid_: History, watch log, resume state

**Reading Progress**:
The record of a viewer's current manga chapter, page position, source match, layout, and direction.
_Avoid_: Bookmark, reading history

## Architecture ownership

Discovery and metadata are owned by AniList route loaders and query options. `/` owns Home composition, `/explore` owns typed browse intent, `/anime/$animeId` owns anime metadata and favorite actions, and `/manga/$mangaId` owns manga metadata and reading actions. The nested Watch route owns mounted anime playback; its source → Match → Episode → Server → Stream state is isolated in `createWatchSession`. The nested Manga Reader route owns mounted chapter reading; its source → Match → Chapter → Page state is isolated in `createMangaReaderSession`.

AniSource is browser-triggered only from mounted Watch and Manga Reader sessions, through the same-origin server gateway at `/api/anisource/*`; discovery loaders never call it. The gateway owns the upstream URL and service credential, validates same-origin traffic, and protects signed media links with session-bound tickets and shared rate limits. IndexedDB is browser-only and is accessed through the `ViewerData`, `SearchHistory`, and manga-reader persistence interfaces in `app/lib/persistence/`, with the IndexedDB adapter responsible for version and Zod validation. Query keys and freshness/failure rules are documented in [docs/architecture/cache-policy.md](docs/architecture/cache-policy.md); the route/data ownership matrix is in [docs/architecture/ownership.md](docs/architecture/ownership.md).
