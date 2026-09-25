import { Show } from 'solid-js'
import type { AniListMedia } from '../../data/anilist/types'
import { formatScore, titleOf, timeUntil } from '../../lib/format'
import { catalogCountLabel, catalogFormat, catalogStatus, type CatalogMode } from '../../lib/catalog'
import { CatalogLink } from './CatalogLink'
import { IconArrowUpRight } from '../ui/icons'

export function AnimeCard(props: { anime: AniListMedia; mode?: CatalogMode; rank?: number }) {
  const mode = () => props.mode ?? 'ANIME'
  const title = () => titleOf(props.anime)
  const nativeTitle = () => props.anime.title?.native || props.anime.title?.romaji || ''
  const cover = () => props.anime.coverImage?.large || props.anime.coverImage?.extraLarge || ''
  const accent = () => props.anime.coverImage?.color || '#6a5af9'
  const score = () => formatScore(props.anime.averageScore ?? props.anime.meanScore)
  const genres = () => (props.anime.genres ?? []).filter((genre): genre is string => Boolean(genre)).slice(0, 3)

  return (
    <CatalogLink
      media={props.anime}
      mode={mode()}
      class="group editorial-row grid min-w-0 grid-cols-[96px_minmax(0,1fr)_36px] items-stretch text-inherit no-underline sm:grid-cols-[112px_minmax(0,1fr)_46px]"
      style={{ '--accent': accent() }}
    >
      {/* Cover fills the row edge-to-edge: the 2/3 minimum keeps the poster
          legible, while stretch absorbs taller meta columns so no blank seam
          opens between stacked posters on narrow viewports. */}
      <div class="relative min-h-[144px] w-full self-stretch overflow-hidden bg-[var(--accent)] after:pointer-events-none after:absolute after:inset-0 after:shadow-cover-inset sm:min-h-[168px]">
        <Show when={props.rank !== undefined}>
          <span class="absolute left-[9px] top-[9px] z-[2] grid h-[27px] min-w-[27px] place-items-center rounded-[6px] border border-[rgb(255_255_255_/_0.3)] bg-[rgb(8_8_12_/_0.78)] px-1 font-mono text-[9px] font-medium text-white backdrop-blur-[8px]">
            {String(props.rank).padStart(2, '0')}
          </span>
        </Show>
        <Show when={cover()}>
          <img
            class="absolute inset-0 h-full w-full object-cover transition-transform duration-[550ms] ease-fluid group-hover:scale-[1.055]"
            src={cover()}
            alt={`${title()} cover`}
            loading="lazy"
            decoding="async"
          />
        </Show>
      </div>

      <div class="flex min-w-0 flex-col px-3 pb-3 pt-3 sm:px-[18px] sm:pb-[15px] sm:pt-[16px]">
        <div class="flex min-w-0 flex-wrap items-center gap-x-[8px] gap-y-[4px] font-mono text-[9px] font-medium uppercase tracking-[.08em] text-text-muted">
          <Show when={props.anime.status}>
            <span class="inline-flex items-center gap-[5px] font-medium text-emerald"><i class="inline-block size-[5px] rounded-full bg-emerald" />{catalogStatus(mode(), props.anime.status)}</span>
          </Show>
          <Show when={catalogFormat(mode(), props.anime)}>
            <span>
              {catalogFormat(mode(), props.anime)}
            </span>
          </Show>
        </div>

        <h3 class="mb-[4px] mt-[8px] line-clamp-2 overflow-hidden text-[15px] font-bold leading-[1.25] tracking-[-.02em] sm:text-[16px] sm:leading-[1.2] sm:tracking-[-.035em]">
          {title()}
        </h3>
        <Show when={nativeTitle() && nativeTitle() !== title()}>
          <span class="overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-text-quiet">{nativeTitle()}</span>
        </Show>

        <Show when={score() || catalogCountLabel(mode(), props.anime)}>
          <div class="mt-auto flex flex-wrap items-center gap-x-[13px] gap-y-[7px] pt-[13px] font-mono text-[10px] font-medium text-text-muted">
            <Show when={score()}>
              {(value) => <span class="inline-flex items-center gap-[5px] rounded-[6px] border border-line bg-white/55 px-[8px] py-[3px] text-[10px]"><b class="font-medium text-ink">★ {value()}</b></span>}
            </Show>
            <Show when={catalogCountLabel(mode(), props.anime)}>{(count) => <span><b class="font-medium text-ink">{count()}</b></span>}</Show>
          </div>
        </Show>

        <Show when={genres().length}>
          <div class="mt-[8px] overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-text-quiet">
            {genres().join(' · ')}
          </div>
        </Show>
        <Show when={mode() === 'ANIME' && props.anime.nextAiringEpisode}>
          {(airing) => (
            <span class="mt-[8px] overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[9px] uppercase tracking-[.08em] text-text-quiet">
              Next ep {airing().episode} · {timeUntil(airing().timeUntilAiring)}
            </span>
          )}
        </Show>
      </div>

      <span
        class="flex items-center justify-center border-l border-line text-text-quiet transition-[background,color,transform] duration-200 group-hover:bg-[var(--accent)] group-hover:text-white"
        aria-hidden="true"
      >
        <IconArrowUpRight class="size-5" />
      </span>
    </CatalogLink>
  )
}
