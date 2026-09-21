import { Show } from 'solid-js'
import type { AniListMedia } from '../../data/anilist/types'
import { formatScore, titleOf } from '../../lib/format'
import { catalogFormat, catalogStatus, type CatalogMode } from '../../lib/catalog'
import { CatalogLink } from './CatalogLink'

/** Poster-led catalog card for horizontal discovery rails. */
export function PosterCard(props: { anime: AniListMedia; mode?: CatalogMode; rank?: number }) {
  const mode = () => props.mode ?? 'ANIME'
  const title = () => titleOf(props.anime)
  const cover = () => props.anime.coverImage?.large || props.anime.coverImage?.extraLarge || ''
  const accent = () => props.anime.coverImage?.color || '#6a5af9'
  const score = () => formatScore(props.anime.averageScore ?? props.anime.meanScore)
  const meta = () => catalogFormat(mode(), props.anime)
  const status = () => (props.anime.status ? catalogStatus(mode(), props.anime.status) : null)

  return (
    <CatalogLink
      media={props.anime}
      mode={mode()}
      class="poster-card group"
      style={{ '--accent': accent() }}
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
    </CatalogLink>
  )
}
