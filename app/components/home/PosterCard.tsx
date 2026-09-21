import { Link } from '@tanstack/solid-router'
import { Show } from 'solid-js'
import type { AniListMedia } from '../../data/anilist/types'
import { formatEnum, formatScore, formatStatus, titleOf } from '../../lib/format'

/** Poster-led catalog card for horizontal discovery rails. */
export function PosterCard(props: { anime: AniListMedia; rank?: number }) {
  const title = () => titleOf(props.anime)
  const cover = () => props.anime.coverImage?.large || props.anime.coverImage?.extraLarge || ''
  const accent = () => props.anime.coverImage?.color || '#6a5af9'
  const score = () => formatScore(props.anime.averageScore ?? props.anime.meanScore)
  const meta = () => [
    props.anime.format ? formatEnum(props.anime.format) : null,
    props.anime.seasonYear,
  ].filter(Boolean).join(' · ')
  const status = () => (props.anime.status ? formatStatus(props.anime.status) : null)

  return (
    <Link
      class="poster-card group"
      preload={false}
      style={{ '--accent': accent() }}
      to="/anime/$animeId"
      params={{ animeId: String(props.anime.id) }}
    >
      <div class="poster-card-media">
        <Show when={cover()}>
          <img src={cover()} alt={`${title()} cover`} loading="lazy" decoding="async" />
        </Show>
        <Show when={props.rank !== undefined}>
          <span class="poster-card-rank">{String(props.rank).padStart(2, '0')}</span>
        </Show>
        <Show when={status()}>
          <span class="poster-card-status">{status()}</span>
        </Show>
      </div>
      <div class="poster-card-body">
        <h3 class="poster-card-title">{title()}</h3>
        <div class="poster-card-meta">
          <Show when={score()}>{(value) => <span class="poster-card-score">{value()}</span>}</Show>
          <Show when={meta()}><span class="poster-card-sub">{meta()}</span></Show>
        </div>
      </div>
    </Link>
  )
}
