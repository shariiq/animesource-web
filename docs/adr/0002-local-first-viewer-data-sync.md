# ADR 0002: Keep viewer data local-first behind a synchronized adapter

## Status

Accepted for Phase 3 preparation. Authentication and the concrete account transport remain deferred.

## Context

AnimeSource already has validated, browser-only IndexedDB implementations for favorites, Continue Watching, playback progress, source matches, playback preferences, and manga reading progress. Phase 3 needs account-backed data without making offline playback or reading depend on a network request or coupling route components to a provider SDK.

The application also needs an honest conflict policy. A remote write can fail after a local mutation, and a deletion made offline must not be resurrected by an older copy on another device.

## Decision

- Routes consume the `ViewerData` interface through the active adapter in `app/lib/persistence/active.ts`.
- IndexedDB remains the local cache and offline adapter.
- Viewer data can be represented as a versioned, Zod-validated snapshot for export, import, migration, or transport.
- Future account implementations satisfy `RemoteViewerAdapter` in `app/lib/sync/viewerSync.ts`; route components do not call a provider SDK directly.
- Record conflicts use last-write-wins timestamps. Equal timestamps prefer local data.
- Deletions create bounded tombstones. A tombstone at or after a record timestamp wins, preventing an offline deletion from silently reappearing.
- Sync failures are visible as an error with pending data; local data is never discarded because a remote write failed.
- Profile and content preferences are modeled now and stored locally. They become account-scoped when authentication is added.
- Manga reading progress remains behind `MangaReaderPersistence`, so chapter position and reader preferences can be synchronized later without coupling the Reader to account transport.

## Consequences

This gives the account milestone a narrow seam and a testable migration path. The tradeoff is that a concrete remote adapter, authentication, server-side authorization, and account deletion endpoint are still required before cross-device sync can be enabled for users.
