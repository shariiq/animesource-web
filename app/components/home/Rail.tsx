import { createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { Link } from '@tanstack/solid-router'
import type { AniListMedia } from '../../data/anilist/types'
import type { BrowseSearch } from '../../lib/browse'
import type { CatalogMode } from '../../lib/catalog'
import { PosterCard } from './PosterCard'
import { IconArrowLeft, IconArrowRight } from '../ui/icons'

export function Rail(props: { title: string; items: AniListMedia[]; mode?: CatalogMode; explore?: BrowseSearch }) {
  let track: HTMLDivElement | undefined
  const [canScroll, setCanScroll] = createSignal(false)
  const updateScrollState = () => {
    if (track) setCanScroll(track.scrollWidth > track.clientWidth + 1)
  }
  const scroll = (direction: 1 | -1) => track?.scrollBy({ left: direction * track.clientWidth * 0.85, behavior: 'smooth' })

  createEffect(() => {
    props.items.length
    if (typeof window !== 'undefined') queueMicrotask(updateScrollState)
  })

  onMount(() => {
    updateScrollState()
    const observer = typeof ResizeObserver !== 'undefined' && track ? new ResizeObserver(updateScrollState) : undefined
    if (track) observer?.observe(track)
    window.addEventListener('resize', updateScrollState)
    onCleanup(() => {
      observer?.disconnect()
      window.removeEventListener('resize', updateScrollState)
    })
  })
  return (
    <section class="section" aria-labelledby={`rail-${props.title}`}>
      <div class="section-head">
        <h2 id={`rail-${props.title}`} class="section-title">{props.title}</h2>
        <Show when={props.explore} keyed>{(search) => <Link class="section-link" to="/explore" search={search}>See all →</Link>}</Show>
      </div>
      <Show when={props.items.length} fallback={<p class="mono-signal mt-4">No titles available.</p>}>
        <div class="rail">
          <Show when={canScroll()}>
            <button type="button" class="rail-arrow prev" aria-label={`Scroll ${props.title} left`} onClick={() => scroll(-1)}><IconArrowLeft /></button>
          </Show>
          <div class="poster-rail" ref={track}>
            <For each={props.items}>{(anime, index) => <PosterCard anime={anime} mode={props.mode} rank={index() + 1} />}</For>
          </div>
          <Show when={canScroll()}>
            <button type="button" class="rail-arrow next" aria-label={`Scroll ${props.title} right`} onClick={() => scroll(1)}><IconArrowRight /></button>
          </Show>
        </div>
      </Show>
    </section>
  )
}
