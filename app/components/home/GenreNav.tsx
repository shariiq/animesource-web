import { createQuery } from '@tanstack/solid-query'
import { For, Show } from 'solid-js'
import { Link } from '@tanstack/solid-router'
import { genresQuery } from '../../data/options'
import { makeBrowseSearch } from '../../lib/browse'
import type { CatalogMode } from '../../lib/catalog'
import { IconArrowUpRight } from '../ui/icons'

const ACCENTS = ['#6a5af9', '#00c853', '#ff6a4d'] as const

function accentFor(index: number) {
  return ACCENTS[index % ACCENTS.length]!
}

export function GenreNav(props: { mode?: CatalogMode } = {}) {
  const mode = () => props.mode ?? 'ANIME'
  const genres = createQuery(() => ({
    ...genresQuery(),
    enabled: typeof window !== 'undefined',
  }))

  return (
    <Show when={!genres.isPending} fallback={<p class="mono-signal">Loading genres…</p>}>
      <Show when={!genres.isError} fallback={<p class="mono-signal" role="alert">Couldn't load genres.</p>}>
        <Show when={genres.data} fallback={<p class="mono-signal">No genres available.</p>}>
          <div class="genre-grid material-panel grid grid-cols-2 overflow-hidden lg:grid-cols-3">
            <For each={genres.data}>
              {(genre, index) => {
                const accent = () => accentFor(index())
                return (
                    <GenreTile mode={mode()} genre={genre} index={index()} accent={accent()} />
                  )
              }}
            </For>
          </div>
        </Show>
      </Show>
    </Show>
  )
}

function GenreTile(props: { mode: CatalogMode; genre: string; index: number; accent: (typeof ACCENTS)[number] }) {
  const content = () => <>
    <span class="relative z-10 flex items-start justify-between gap-4">
      <span class="block text-[17px] font-bold tracking-[-.035em]">{props.genre}</span>
      <IconArrowUpRight class="size-[18px] shrink-0 text-text-muted transition-all duration-300 group-hover:translate-x-0.5 group-hover:text-ink" />
    </span>
    <span class="relative z-10 mt-2 block font-mono text-[8px] uppercase tracking-[.14em] text-text-muted transition-colors group-hover:text-ink">{props.mode === 'ANIME' ? 'Browse anime' : 'Manga genres'}</span>
  </>
  const className = () => `genre-tile group p-4 sm:p-5 ${props.index < 3 ? 'lg:min-h-[128px]' : ''}`
  return (
    <Show
      when={props.mode === 'ANIME'}
      fallback={<div class={className()} style={{ '--genre-accent': props.accent }}>{content()}</div>}
    >
      <Link class={className()} style={{ '--genre-accent': props.accent }} to="/explore" search={makeBrowseSearch({ genre: props.genre })}>{content()}</Link>
    </Show>
  )
}
