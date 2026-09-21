import { For, Show } from 'solid-js'
import { Link } from '@tanstack/solid-router'
import type { AniListMedia } from '../../data/anilist/types'
import type { BrowseSearch } from '../../lib/browse'
import { PosterCard } from './PosterCard'

export function Rail(props: { title: string; items: AniListMedia[]; explore?: BrowseSearch }) {
  let track: HTMLDivElement | undefined
  const scroll = (direction: 1 | -1) => track?.scrollBy({ left: direction * track.clientWidth * 0.85, behavior: 'smooth' })
  return (
    <section class="section" aria-labelledby={`rail-${props.title}`}>
      <div class="section-head">
        <h2 id={`rail-${props.title}`} class="section-title">{props.title}</h2>
        <Show when={props.explore} keyed>{(search) => <Link class="section-link" to="/explore" search={search}>See all →</Link>}</Show>
      </div>
      <Show when={props.items.length} fallback={<p class="mono-signal mt-4">Nothing to show here right now.</p>}>
        <div class="rail">
          <button type="button" class="rail-arrow prev" aria-label={`Scroll ${props.title} left`} onClick={() => scroll(-1)}>‹</button>
          <div class="poster-rail" ref={track}>
            <For each={props.items}>{(anime, index) => <PosterCard anime={anime} rank={index() + 1} />}</For>
          </div>
          <button type="button" class="rail-arrow next" aria-label={`Scroll ${props.title} right`} onClick={() => scroll(1)}>›</button>
        </div>
      </Show>
    </section>
  )
}
