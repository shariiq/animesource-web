import { For, Show } from 'solid-js'
import { Link } from '@tanstack/solid-router'
import { formatEnum, titleOf } from '../../../lib/format'

export interface MediaRailItem {
  id: number
  title: string
  cover: string
  format: string | null | undefined
  score: number | null | undefined
  type: string | null | undefined
  siteUrl: string | null
  // Optional label shown as an overline (e.g. "Sequel", "Recommended").
  label?: string
}

/** Grid of related media cards with explicit continuity labels. */
export function MediaRail(props: { heading: string; items: MediaRailItem[] }) {
  return (
    <Show when={props.items.length > 0}>
      <section class="detail-section" aria-labelledby={`media-rail-${props.heading}`}>
        <div class="detail-section-heading">
          <h2 id={`media-rail-${props.heading}`}>{props.heading}</h2>
        </div>
        <div class="detail-media-grid" role="list">
          <For each={props.items}>
            {(item) => {
              const content = <>
                <div class="poster-card-media">
                  <Show when={item.cover} fallback={<div class="aspect-[2/3]" />}>
                    <img src={item.cover} alt={`${item.title} cover`} loading="lazy" />
                  </Show>
                  <Show when={item.score != null}><span class="poster-card-score poster-card-score-float">★ {(item.score! / 10).toFixed(1)}</span></Show>
                </div>
                <div class="poster-card-body">
                  <Show when={item.label}><span class="card-meta">{item.label}</span></Show>
                  <h3 class="poster-card-title">{item.title}</h3>
                  <div class="poster-card-meta">
                    <span class="poster-card-sub">{formatEnum(item.format)}</span>
                  </div>
                </div>
              </>

              if (item.type === 'ANIME') {
                return <Link class="card detail-relation-card" to="/anime/$animeId" params={{ animeId: String(item.id) }} role="listitem">{content}</Link>
              }
              if (item.type === 'MANGA') {
                return <Link class="card detail-relation-card" to="/manga/$mangaId" params={{ mangaId: String(item.id) }} role="listitem">{content}</Link>
              }
              return <a class="card detail-relation-card" href={item.siteUrl ?? `https://anilist.co/manga/${item.id}`} target="_blank" rel="noopener noreferrer" role="listitem">{content}</a>
            }}
          </For>
        </div>
      </section>
    </Show>
  )
}

/** Adapts an AniListMedia shape (relation node / recommendation) to MediaRailItem. */
export function toRailItem(
  node: { id: number; type?: string | null; title?: { romaji?: string | null; english?: string | null; native?: string | null } | null; coverImage?: { large?: string | null; extraLarge?: string | null } | null; format?: string | null | undefined; averageScore?: number | null | undefined } | null | undefined,
  label?: string,
): MediaRailItem | null {
  if (!node) return null
  return {
    id: node.id,
    title: titleOf(node as never),
    cover: node.coverImage?.large || node.coverImage?.extraLarge || '',
    format: node.format,
    score: node.averageScore,
    type: node.type,
    siteUrl: null,
    label,
  }
}
