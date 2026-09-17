import { For, Show } from 'solid-js'
import { Link } from '@tanstack/solid-router'
import type { AniListMedia } from '../../data/anilist/types'
import type { BrowseSearch } from '../../lib/browse'
import { AnimeCard } from './AnimeCard'

export function Rail(props: { title: string; items: AniListMedia[]; explore?: BrowseSearch }) {
  let track: HTMLDivElement | undefined
  return (
    <section class="section" aria-labelledby={`rail-${props.title}`}>
      <div class="section-head">
        <h2 id={`rail-${props.title}`} class="section-title">{props.title}</h2>
        <Show when={props.explore} keyed>{(search) => <Link class="section-link" to="/explore" search={search}>See all →</Link>}</Show>
      </div>
      <Show when={props.items.length} fallback={<p class="state">Nothing to show here right now.</p>}>
        <div class="rail">
          <button type="button" class="rail-arrow prev" aria-label={`Scroll ${props.title} left`} onClick={() => track?.scrollBy({ left: -(track.clientWidth * 0.85), behavior: 'smooth' })}>‹</button>
          <div class="rail-track" ref={track}>
            <For each={props.items}>{(anime, index) => <AnimeCard anime={anime} rank={index() + 1} />}</For>
          </div>
          <button type="button" class="rail-arrow next" aria-label={`Scroll ${props.title} right`} onClick={() => track?.scrollBy({ left: track.clientWidth * 0.85, behavior: 'smooth' })}>›</button>
        </div>
      </Show>
    </section>
  )
}
