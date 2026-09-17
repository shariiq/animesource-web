import { Link } from '@tanstack/solid-router'
import { Show } from 'solid-js'
import type { AniListMedia } from '../../data/anilist/types'
import { formatEnum, formatScore, formatStatus, titleOf, timeUntil } from '../../lib/format'

export function AnimeCard(props: { anime: AniListMedia; rank?: number }) {
  const title = () => titleOf(props.anime)
  const nativeTitle = () => props.anime.title?.native || props.anime.title?.romaji || ''
  const cover = () => props.anime.coverImage?.large || props.anime.coverImage?.extraLarge || ''
  const accent = () => props.anime.coverImage?.color || '#7665e8'
  const score = () => formatScore(props.anime.averageScore ?? props.anime.meanScore)
  const genres = () => (props.anime.genres ?? []).filter((genre): genre is string => Boolean(genre)).slice(0, 3)

  return (
    <Link
      class="group editorial-row grid min-h-[196px] min-w-0 grid-cols-[108px_minmax(0,1fr)_36px] text-inherit no-underline sm:grid-cols-[126px_minmax(0,1fr)_42px]"
      style={{ '--accent': accent() }}
      to="/anime/$animeId"
      params={{ animeId: String(props.anime.id) }}
    >
      <div class="relative min-h-[196px] overflow-hidden bg-[var(--accent)] after:pointer-events-none after:absolute after:inset-0 after:shadow-cover-inset">
        <Show when={props.rank !== undefined}>
          <span class="absolute left-[9px] top-[9px] z-[2] grid h-[27px] min-w-[27px] place-items-center rounded-[6px] border border-[rgb(255_255_255_/_0.3)] bg-[rgb(8_8_12_/_0.78)] px-1 font-mono text-[9px] font-medium text-white backdrop-blur-[8px]">
            {String(props.rank).padStart(2, '0')}
          </span>
        </Show>
        <Show when={cover()}>
          <img
            class="h-full w-full object-cover transition-transform duration-[550ms] ease-fluid group-hover:scale-[1.055]"
            src={cover()}
            alt={`${title()} cover`}
            loading="lazy"
            decoding="async"
          />
        </Show>
      </div>

      <div class="flex min-w-0 flex-col px-[18px] pb-[17px] pt-[19px]">
        <div class="flex items-center gap-[8px] font-mono text-[9px] font-medium uppercase tracking-[.08em] text-text-muted">
          <Show when={props.anime.status}>
            <span class="font-medium text-emerald">● {formatStatus(props.anime.status)}</span>
          </Show>
          <Show when={props.anime.format || props.anime.seasonYear}>
            <span>
              {[props.anime.format ? formatEnum(props.anime.format) : null, props.anime.seasonYear].filter(Boolean).join(' · ')}
            </span>
          </Show>
        </div>

        <h3 class="mb-[5px] mt-[9px] overflow-hidden text-ellipsis whitespace-nowrap text-[16px] font-bold leading-[1.2] tracking-[-.035em]">
          {title()}
        </h3>
        <Show when={nativeTitle() && nativeTitle() !== title()}>
          <span class="overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-text-quiet">{nativeTitle()}</span>
        </Show>

        <Show when={score() || props.anime.episodes}>
          <div class="mt-auto flex flex-wrap gap-x-[13px] gap-y-[7px] pt-[16px] font-mono text-[10px] font-medium text-text-muted">
            <Show when={score()}>{(value) => <span><b class="font-medium text-ink">{value()}</b> score</span>}</Show>
            <Show when={props.anime.episodes}>{(episodes) => <span><b class="font-medium text-ink">{episodes()}</b> episodes</span>}</Show>
          </div>
        </Show>

        <Show when={genres().length}>
          <div class="mt-[9px] overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-text-quiet">
            {genres().join(' · ')}
          </div>
        </Show>
        <Show when={props.anime.nextAiringEpisode}>
          {(airing) => (
            <span class="mt-[9px] overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[9px] uppercase tracking-[.08em] text-text-quiet">
              Next ep {airing().episode} · {timeUntil(airing().timeUntilAiring)}
            </span>
          )}
        </Show>
      </div>

      <span
        class="flex items-center justify-center border-l border-line text-[18px] text-text-quiet transition-[background,color] duration-200 group-hover:bg-[var(--accent)] group-hover:text-white"
        aria-hidden="true"
      >
        ↗
      </span>
    </Link>
  )
}
