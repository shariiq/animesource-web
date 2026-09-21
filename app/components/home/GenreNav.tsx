import { createQuery } from '@tanstack/solid-query'
import { For, Show } from 'solid-js'
import { Link } from '@tanstack/solid-router'
import { genresQuery } from '../../data/options'
import { makeBrowseSearch } from '../../lib/browse'
import type { CatalogMode } from '../../lib/catalog'

const ACCENTS = [
  { surface: 'from-violet/35 via-white/85 to-plum/48', accent: '#6a5af9' },
  { surface: 'from-mint/75 via-white/85 to-acid/60', accent: '#00c853' },
  { surface: 'from-orange/55 via-white/85 to-plum/48', accent: '#ff6a4d' },
] as const

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
      <span class="grid size-7 place-items-center rounded-[6px] border border-black/12 bg-white/65 font-mono text-[9px] font-medium text-text-muted transition-colors group-hover:border-ink group-hover:text-ink">{String(props.index + 1).padStart(2, '0')}</span>
      <span class="font-mono text-[16px] font-normal leading-none text-text-muted transition-transform duration-300 group-hover:translate-x-1 group-hover:text-ink" aria-hidden="true">{props.mode === 'ANIME' ? '↗' : '·'}</span>
    </span>
    <span class="relative z-10 mt-8 block text-[17px] font-bold tracking-[-.035em]">{props.genre}</span>
    <span class="relative z-10 mt-2 block font-mono text-[8px] uppercase tracking-[.14em] text-text-muted transition-colors group-hover:text-ink">{props.mode === 'ANIME' ? 'Browse anime' : 'Manga genres'}</span>
  </>
  const className = () => `genre-tile group bg-gradient-to-br p-4 sm:p-5 ${props.index < 3 ? 'lg:min-h-[172px]' : ''} ${props.accent.surface}`
  return (
    <Show
      when={props.mode === 'ANIME'}
      fallback={<div class={className()} style={{ '--genre-accent': props.accent.accent }}>{content()}</div>}
    >
      <Link class={className()} style={{ '--genre-accent': props.accent.accent }} to="/explore" search={makeBrowseSearch({ genre: props.genre })}>{content()}</Link>
    </Show>
  )
}
