import { describe, expect, it } from 'vitest'
import {
  ROUTING_FAIL_FAST_PATH_WINDOW_MS,
  ROUTING_RECENT_SUCCESS_MS,
  createOriginRoutingState,
  isSwitchableFailure,
  otherOrigin,
  pickOrigin,
  recordOriginCall,
  type OriginCallEvent,
  type OriginRoutingState,
} from '../app/lib/source-session/originRouting'

function success(origin: OriginCallEvent['origin'], slow = false): OriginCallEvent {
  return { origin, ok: true, slow, kind: null, aborted: false }
}

function failure(origin: OriginCallEvent['origin'], kind: string, status?: number): OriginCallEvent {
  return { origin, ok: false, slow: false, kind, status, aborted: false }
}

describe('origin failure classification', () => {
  it.each([
    ['timeout', undefined, true],
    ['network', undefined, true],
    ['http', 502, true],
    ['http', 503, true],
    ['http', 504, true],
    ['http', 500, false],
    ['http', 404, false],
    ['http', 429, false],
    ['expired', undefined, false],
    ['invalid', undefined, false],
    ['rate-limited', undefined, false],
    ['misconfigured', undefined, false],
    ['cancelled', undefined, false],
  ])('classifies %s (%s) as switchable=%s', (kind, status, switchable) => {
    expect(isSwitchableFailure(kind, status)).toBe(switchable)
  })
})

describe('origin routing policy', () => {
  it('starts on primary and ignores healthy traffic', () => {
    const state = createOriginRoutingState()
    recordOriginCall(state, success('primary'), 1000)
    expect(pickOrigin(state, 1000)).toBe('primary')
    expect(state.active).toBe('primary')
  })

  it('switches immediately on a switchable failure and back on recovery', () => {
    const state = createOriginRoutingState()
    recordOriginCall(state, failure('primary', 'timeout'), 1000)
    expect(state.active).toBe('overflow')
    expect(pickOrigin(state, 1000)).toBe('overflow')

    recordOriginCall(state, success('overflow'), 2000)
    expect(state.active).toBe('overflow')

    recordOriginCall(state, failure('overflow', 'network'), 3000)
    expect(state.active).toBe('primary')
  })

  it('never switches for expired, invalid, throttled, or cancelled outcomes', () => {
    const state = createOriginRoutingState()
    recordOriginCall(state, failure('primary', 'expired', 410), 1000)
    recordOriginCall(state, failure('primary', 'invalid', 404), 1000)
    recordOriginCall(state, failure('primary', 'rate-limited', 429), 1000)
    recordOriginCall(state, { ...failure('primary', 'cancelled'), aborted: true }, 1000)
    expect(state.active).toBe('primary')
    expect(pickOrigin(state, 1000)).toBe('primary')
  })

  it('sends traffic home to primary on a shared-token outage', () => {
    const state = createOriginRoutingState()
    recordOriginCall(state, failure('primary', 'timeout'), 1000)
    expect(state.active).toBe('overflow')
    recordOriginCall(state, failure('overflow', 'misconfigured', 503), 2000)
    expect(state.active).toBe('primary')
  })

  it('needs two slow calls before leaving primary, and only toward a proven overflow', () => {
    const state = createOriginRoutingState()
    recordOriginCall(state, success('primary', true), 100)
    // Overflow never succeeded: a slow primary still beats a sleeping overflow.
    recordOriginCall(state, success('primary', true), 200)
    expect(state.active).toBe('primary')

    // Overflow proves itself through one ordinary alternate, then degrades.
    recordOriginCall(state, failure('primary', 'timeout'), 1000)
    recordOriginCall(state, success('overflow'), 1000)
    recordOriginCall(state, failure('overflow', 'network'), 2000)
    expect(state.active).toBe('primary')

    // Two slow primary calls now move the sticky switch while overflow is warm.
    recordOriginCall(state, success('primary', true), 3000)
    expect(state.active).toBe('primary')
    recordOriginCall(state, success('primary', true), 4000)
    expect(state.active).toBe('overflow')
  })

  it('a fast success resets the slow streak', () => {
    const state = createOriginRoutingState()
    recordOriginCall(state, success('overflow'), 1000)
    recordOriginCall(state, success('primary', true), 2000)
    recordOriginCall(state, success('primary'), 3000)
    recordOriginCall(state, success('primary', true), 4000)
    expect(state.active).toBe('primary')
  })

  it('skips a repeatedly failing origin up front until its window lapses', () => {
    const state: OriginRoutingState = {
      active: 'primary',
      primary: { slowStreak: 0, failStreak: 3, lastFailAt: 1000, lastSuccessAt: 0 },
      overflow: { slowStreak: 0, failStreak: 0, lastFailAt: 0, lastSuccessAt: 0 },
    }
    expect(pickOrigin(state, 1000)).toBe('overflow')
    expect(pickOrigin(state, 1000 + ROUTING_FAIL_FAST_PATH_WINDOW_MS)).toBe('primary')
  })

  it('probes an exiled primary again once its window lapses', () => {
    const state = createOriginRoutingState()
    recordOriginCall(state, failure('primary', 'timeout'), 1000)
    expect(state.active).toBe('overflow')

    // Inside the window there is no probing: traffic stays put.
    expect(pickOrigin(state, 2000)).toBe('overflow')
    // Past the window a single recovery probe goes out on primary.
    expect(pickOrigin(state, 1000 + ROUTING_FAIL_FAST_PATH_WINDOW_MS)).toBe('primary')
  })

  it('homes traffic on a primary success and holds slow-switched exile without probing', () => {
    const state = createOriginRoutingState()
    recordOriginCall(state, success('overflow'), 1000)
    recordOriginCall(state, success('primary', true), 2000)
    recordOriginCall(state, success('primary', true), 3000)
    expect(state.active).toBe('overflow')
    // Slow exile never probes primary: nothing failed, so the next call stays.
    expect(pickOrigin(state, 4000)).toBe('overflow')
    // Any real primary success restores the default.
    recordOriginCall(state, success('primary'), 5000)
    expect(state.active).toBe('primary')
    expect(pickOrigin(state, 5000)).toBe('primary')
  })

  it('treats an overflow success older than the window as unproven', () => {
    const state = createOriginRoutingState()
    recordOriginCall(state, success('overflow'), 1000)
    recordOriginCall(state, success('primary', true), 1000 + ROUTING_RECENT_SUCCESS_MS)
    recordOriginCall(state, success('primary', true), 2000 + ROUTING_RECENT_SUCCESS_MS)
    expect(state.active).toBe('primary')
  })

  it('resolves the other origin symmetrically', () => {
    expect(otherOrigin('primary')).toBe('overflow')
    expect(otherOrigin('overflow')).toBe('primary')
  })
})
