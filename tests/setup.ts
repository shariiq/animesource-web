import '@testing-library/jest-dom/vitest'

// IndexedDB is not implemented in jsdom; provide a working in-memory
// implementation for persistence tests.
import 'fake-indexeddb/auto'

// jsdom deliberately leaves media loading unimplemented. Playback behavior is
// covered with mocked HLS boundaries, so suppress that environment-only noise.
Object.defineProperty(HTMLMediaElement.prototype, 'load', {
  configurable: true,
  value: () => undefined,
})

Object.defineProperty(HTMLMediaElement.prototype, 'play', {
  configurable: true,
  value: () => Promise.resolve(),
})

Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
  configurable: true,
  value: () => undefined,
})

Object.defineProperty(HTMLMediaElement.prototype, 'buffered', {
  configurable: true,
  get: () => ({ length: 0, start: () => 0, end: () => 0 }),
})

// jsdom creates <track> nodes but does not expose the browser TextTrack API.
// Give each test track its own mode so subtitle selection assertions reflect
// the browser boundary rather than silently accepting a missing API.
Object.defineProperty(HTMLTrackElement.prototype, 'track', {
  configurable: true,
  get: function (this: HTMLTrackElement) {
    const element = this as HTMLTrackElement & { _testTrack?: { mode: string } }
    return element._testTrack ??= { mode: 'disabled' }
  },
})
