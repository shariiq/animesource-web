/**
 * Latency-aware overflow routing between the primary and overflow AniSource
 * origins (Vercel and Render behind the same gateway prefixes).
 *
 * Passive only: routing learns from real request outcomes (durations via the
 * existing onSlow signal, typed failure kinds). There are no probes, no
 * background pings, and no shared state — each client instance owns its
 * routing state, which is only ever touched by browser-initiated calls.
 *
 * Two facts shape the policy. Media tickets are origin-bound, so a switch
 * must be sticky: once an operation moves to an origin, everything derived
 * from it (child URLs, scopes) already follows. And an idle origin may be
 * asleep, so a switch into an origin with no recent success is only ever
 * triggered by an actual failure — never by mere slowness, where a slow
 * origin still beats a sleeping one.
 *
 * Each policy instance has a preferred origin: catalog operations prefer
 * primary, while operations that mint media-byte URLs (streams, manga
 * pages) prefer overflow, keeping video bandwidth off the primary
 * deployment. All other mechanics are identical for both.
 */

export type RoutingOrigin = 'primary' | 'overflow'

export interface OriginCallEvent {
  origin: RoutingOrigin
  ok: boolean
  /** The existing cold-start signal fired: this call crossed AS_COLD_START_DELAY_MS. */
  slow: boolean
  /** Transport failure kind (`AniSourceError['kind']`), or null on success. */
  kind: string | null
  status?: number
  /** The caller went away: record nothing and never treat it as an origin signal. */
  aborted: boolean
}

interface OriginStats {
  slowStreak: number
  failStreak: number
  lastFailAt: number
  lastSuccessAt: number
}

export interface OriginRoutingState {
  /** Default origin for this operation class; traffic homes here on success. */
  preferred: RoutingOrigin
  active: RoutingOrigin
  primary: OriginStats
  overflow: OriginStats
}

/** Slow successes needed before leaving a warmed overflow origin behind. */
export const ROUTING_SLOW_STREAK_TO_SWITCH = 2
/** Consecutive recent failures before an origin is skipped up front. */
export const ROUTING_FAIL_STREAK_TO_FAST_PATH = 3
/** How long a failure streak steers new calls away. */
export const ROUTING_FAIL_FAST_PATH_WINDOW_MS = 60_000
/** A slow-switch requires a success on the other origin within this window. */
export const ROUTING_RECENT_SUCCESS_MS = 5 * 60_000

function emptyStats(): OriginStats {
  return { slowStreak: 0, failStreak: 0, lastFailAt: 0, lastSuccessAt: 0 }
}

export function createOriginRoutingState(preferred: RoutingOrigin = 'primary'): OriginRoutingState {
  return { preferred, active: preferred, primary: emptyStats(), overflow: emptyStats() }
}

export function otherOrigin(origin: RoutingOrigin): RoutingOrigin {
  return origin === 'primary' ? 'overflow' : 'primary'
}

/**
 * Which failures may improve by trying the other origin. Timeouts, dropped
 * connections, and 5xx responses describe the origin, not the request —
 * including 5xx the gateway labels `invalid`, which means the upstream
 * answered with garbage rather than a usable error. Expired tickets,
 * rejected routes, throttling, credential outages, and cancellations cannot
 * improve elsewhere: rate limits apply per session regardless of origin, and
 * both deployments share one service token.
 */
export function isSwitchableFailure(kind: string | null, status?: number): boolean {
  if (kind === 'timeout' || kind === 'network') return true
  if (status !== undefined && [502, 503, 504].includes(status)) {
    return kind === 'http' || kind === 'invalid'
  }
  return false
}

/**
 * Entry origin for a call. Skips an origin still inside its failure window
 * so an outage does not cost a full timeout on every operation, and probes
 * an exiled preferred origin once its window lapses so recovery is noticed.
 * Slow-switch exile never probes: nothing failed, so there is nothing to
 * re-check until the other origin itself degrades.
 */
export function pickOrigin(state: OriginRoutingState, now: number): RoutingOrigin {
  if (isFailFastPath(state, now)) return otherOrigin(state.active)
  if (state.active !== state.preferred) {
    const home = state[state.preferred]
    if (home.failStreak >= 1 && now - home.lastFailAt >= ROUTING_FAIL_FAST_PATH_WINDOW_MS) {
      return state.preferred
    }
  }
  return state.active
}

/**
 * Whether entry skipped the active origin via the failure fast-path. A
 * skipped entry that also fails must surface immediately instead of
 * alternating back: the alternate would just pay the known outage again.
 */
export function isFailFastPath(state: OriginRoutingState, now: number): boolean {
  const stats = state[state.active]
  return stats.failStreak >= ROUTING_FAIL_STREAK_TO_FAST_PATH &&
    now - stats.lastFailAt < ROUTING_FAIL_FAST_PATH_WINDOW_MS
}

/**
 * Records a settled attempt. Switches are sticky: a switchable failure moves
 * `active` immediately (the caller runs its single bounded alternate there),
 * a slow streak moves it only toward a recently-proven origin, a success on
 * the preferred origin moves traffic home, and a misconfigured failure sends
 * traffic home to primary since both deployments share one service token.
 */
export function recordOriginCall(state: OriginRoutingState, event: OriginCallEvent, now: number): void {
  if (event.aborted) return
  const stats = state[event.origin]
  if (event.ok) {
    stats.failStreak = 0
    stats.lastSuccessAt = now
    if (event.origin === state.preferred) state.active = state.preferred
    if (!event.slow) {
      stats.slowStreak = 0
      return
    }
    stats.slowStreak += 1
    if (stats.slowStreak < ROUTING_SLOW_STREAK_TO_SWITCH) return
    const other = otherOrigin(event.origin)
    if (state[other].lastSuccessAt > 0 && now - state[other].lastSuccessAt < ROUTING_RECENT_SUCCESS_MS) {
      state.active = other
      stats.slowStreak = 0
    }
    return
  }
  if (event.kind === 'misconfigured') {
    state.active = 'primary'
    return
  }
  if (!isSwitchableFailure(event.kind, event.status)) return
  stats.failStreak += 1
  stats.lastFailAt = now
  // A failure supersedes earlier slowness: the switch starts a fresh
  // measurement regime instead of inheriting a stale streak.
  stats.slowStreak = 0
  state.active = otherOrigin(event.origin)
}
