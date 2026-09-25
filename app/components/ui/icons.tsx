/**
 * Shared interface icon set. Stroke icons use the same 1.8 round-cap language
 * as the manga reader so every route draws affordances identically; text
 * glyphs (arrows, play triangles, magnifiers) are never used as icons.
 */
export function IconPlay(props: { class?: string }) {
  return (
    <svg class={props.class ?? 'size-3.5'} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.5v13l11-6.5-11-6.5Z" />
    </svg>
  )
}

function StrokeIcon(props: { class?: string; d: string }) {
  return (
    <svg
      class={props.class ?? 'size-4'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={props.d} />
    </svg>
  )
}

export function IconArrowLeft(props: { class?: string }) {
  return <StrokeIcon class={props.class} d="M19 12H5M12 19l-7-7 7-7" />
}

export function IconArrowRight(props: { class?: string }) {
  return <StrokeIcon class={props.class} d="M5 12h14M12 5l7 7-7 7" />
}

export function IconArrowUpRight(props: { class?: string }) {
  return <StrokeIcon class={props.class} d="M7 17 17 7M7 7h10v10" />
}

export function IconSearch(props: { class?: string }) {
  return <StrokeIcon class={props.class} d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.35-4.35" />
}
