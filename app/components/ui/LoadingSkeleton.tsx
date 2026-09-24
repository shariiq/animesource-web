import { For } from 'solid-js'

/**
 * Shared loading skeletons. Every async surface renders one of these while its
 * query is pending so navigation never lands on bare text or an empty frame.
 * Skeletons reuse the real layout containers (explore-grid, schedule rows,
 * detail shells) to avoid layout shift, carry aria-busy/role=status, and honor
 * prefers-reduced-motion through the static `.skeleton` fallback in CSS.
 */
export function Skeleton(props: { height?: string; width?: string; rounded?: string; label?: string }) {
  return (
    <div
      class="skeleton"
      aria-hidden="true"
      style={{
        height: props.height ?? '14px',
        width: props.width ?? '100%',
        'border-radius': props.rounded ?? '8px',
      }}
    />
  )
}

function LoadingHeading(props: { kicker: string; title: string }) {
  return (
    <div>
      <p class="mono-signal">{props.kicker}</p>
      <h2 class="mt-2 font-display text-4xl tracking-[-.03em]">{props.title}</h2>
    </div>
  )
}

export function RouteLoadingFallback(props: { kicker?: string; title?: string }) {
  return (
    <section class="editorial-page" aria-busy="true" aria-label={props.title ?? 'Loading'}>
      <div class="material-panel grid gap-4 p-8" role="status">
        <LoadingHeading kicker={props.kicker ?? 'Loading'} title={props.title ?? 'Loading…'} />
        <Skeleton height="18px" width="62%" />
        <Skeleton height="120px" rounded="16px" />
        <div class="grid gap-2">
          <Skeleton height="14px" />
          <Skeleton height="14px" width="84%" />
          <Skeleton height="14px" width="68%" />
        </div>
      </div>
    </section>
  )
}

export function HomeLoadingSkeleton(props: { message: string }) {
  return (
    <div class="grid gap-6" aria-busy="true" role="status" aria-label={props.message}>
      <div class="hero-shell grid min-h-[380px] place-items-center p-8">
        <div class="grid w-full max-w-xl gap-3">
          <p class="mono-signal !text-white/70">{props.message}</p>
          <Skeleton height="44px" width="72%" rounded="10px" />
          <Skeleton height="16px" width="52%" />
          <div class="mt-2 flex gap-2">
            <Skeleton height="44px" width="160px" rounded="11px" />
            <Skeleton height="44px" width="160px" rounded="11px" />
          </div>
        </div>
      </div>
      <div class="grid gap-3">
        <Skeleton height="18px" width="240px" />
        <div class="poster-rail" aria-hidden="true">
          <Skeleton height="280px" rounded="18px" />
          <Skeleton height="280px" rounded="18px" />
          <Skeleton height="280px" rounded="18px" />
          <Skeleton height="280px" rounded="18px" />
        </div>
      </div>
    </div>
  )
}

export function ExploreLoadingSkeleton() {
  return (
    <section aria-busy="true" aria-label="Loading the collection">
      <div class="explore-results-head" aria-hidden="true">
        <div class="grid w-full max-w-md gap-2">
          <Skeleton height="14px" width="120px" />
          <Skeleton height="28px" width="70%" />
        </div>
      </div>
      <div class="explore-grid" role="status" aria-label="Loading the collection">
        <For each={[0, 1, 2, 3, 4, 5, 6, 7]}>{() => (
          <div class="grid gap-3 p-4" aria-hidden="true">
            <Skeleton height="220px" rounded="14px" />
            <Skeleton height="16px" width="80%" />
            <Skeleton height="12px" width="55%" />
          </div>
        )}</For>
      </div>
      <p class="mono-signal mt-4" role="status">Loading the collection…</p>
    </section>
  )
}

export function ScheduleLoadingSkeleton() {
  return (
    <div class="schedule-days" aria-busy="true" role="status" aria-label="Reading the release calendar">
      <For each={['Monday releases', 'Tuesday releases']}>{(day) => (
        <section class="schedule-day" aria-label={day}>
          <div class="schedule-day-heading" aria-hidden="true">
            <Skeleton height="30px" width="220px" />
            <Skeleton height="12px" width="90px" />
          </div>
          <div class="schedule-day-items" aria-hidden="true">
            <For each={[0, 1, 2, 3]}>{() => (
              <div class="schedule-row">
                <Skeleton height="88px" rounded="8px" />
                <div class="grid w-full gap-2">
                  <Skeleton height="10px" width="45%" />
                  <Skeleton height="16px" width="85%" />
                  <Skeleton height="12px" width="35%" />
                </div>
              </div>
            )}</For>
          </div>
        </section>
      )}</For>
      <p class="mono-signal px-6 py-4">Reading the release calendar…</p>
    </div>
  )
}

export function DetailLoadingSkeleton(props: { message: string }) {
  return (
    <section class="detail-head" aria-busy="true" role="status" aria-label={props.message}>
      <div class="detail-inner grid gap-4">
        <div class="skeleton" style={{ height: '420px', 'border-radius': '18px' }} aria-hidden="true" />
        <p class="mono-signal">{props.message}</p>
      </div>
    </section>
  )
}

export function LibraryLoadingSkeleton() {
  return (
    <section class="material-panel mt-8 grid gap-3 p-6" aria-busy="true" role="status" aria-label="Loading saved titles">
      <p class="mono-signal">Loading saved titles…</p>
      <div class="grid grid-cols-1 gap-3 lg:grid-cols-2" aria-hidden="true">
        <For each={[0, 1, 2, 3]}>{() => (
          <div class="flex gap-3 rounded-[14px] border border-line p-3">
            <Skeleton height="120px" width="84px" rounded="10px" />
            <div class="grid flex-1 content-center gap-2">
              <Skeleton height="14px" width="70%" />
              <Skeleton height="12px" width="45%" />
              <Skeleton height="32px" width="130px" rounded="10px" />
            </div>
          </div>
        )}</For>
      </div>
    </section>
  )
}

export function PlayerLoadingSkeleton(props: { message: string }) {
  return (
    <section class="grid min-h-[260px] place-items-center overflow-hidden rounded-panel border border-black/15 bg-[#121217] p-5 text-center text-white sm:aspect-video sm:p-8" aria-busy="true" role="status" aria-label={props.message}>
      <div class="grid justify-items-center gap-3">
        <div class="player-spinner" aria-hidden="true" />
        <p class="mono-signal !text-white/70">{props.message}</p>
      </div>
    </section>
  )
}
