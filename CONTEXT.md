# AnimeSource

A web platform combining AniList discovery and catalog metadata with on-demand anime streaming playback via AniSource providers.

## Language

### Discovery & Catalog

**Anime**:
An animated production cataloged on AniList, carrying canonical metadata, titles, and release schedules.
_Avoid_: Show, series, title, media item

**Discovery**:
The browsing, filtering, and recommendation surfaces that help viewers find anime.
_Avoid_: Feed, catalog, explore feed

**Rail**:
A curated or categorized list of anime cards on discovery pages. A rail may use a horizontal track or a responsive wrapping grid depending on the route and available width.
_Avoid_: Carousel, shelf, row, slider

**Hero**:
The featured broadcast billboard presenting trending or spotlighted anime at the top of discovery.
_Avoid_: Banner, spotlight, slider

### Playback & Sources

**Source**:
An external anime streaming provider that indexes video servers and episode manifests.
_Avoid_: Provider, site, scraper, backend

**Candidate**:
A prospective anime record returned by a Source search to be evaluated for title matching.
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
_Avoid_: Chapter, part, video

### Persistence & Library

**Favorite**:
An anime saved to the viewer's local library for quick access.
_Avoid_: Bookmark, watchlisted, saved anime

**Continue Watching**:
The record of a viewer's most recent playback progress, episode selection, and source pairing for an anime.
_Avoid_: History, watch log, resume state

## Architecture ownership

Discovery and metadata are owned by AniList route loaders and query options. `/` owns Home composition, `/explore` owns typed browse intent, and `/anime/$animeId` owns metadata presentation and favorite actions. The nested Watch route owns only the mounted playback experience; its source → Match → Episode → Server → Stream state is isolated in `createWatchSession`.

AniSource is client-only and interaction-triggered. IndexedDB is browser-only and is accessed through the `ViewerData` and `SearchHistory` interfaces in `app/lib/persistence/`, with the IndexedDB adapter responsible for version and Zod validation. Query keys and freshness/failure rules are documented in [docs/architecture/cache-policy.md](docs/architecture/cache-policy.md); the route/data ownership matrix is in [docs/architecture/ownership.md](docs/architecture/ownership.md).
