import type { JSX } from 'solid-js'
import { Show } from 'solid-js'
import { Link } from '@tanstack/solid-router'
import type { AniListMedia } from '../../data/anilist/types'
import type { CatalogMode } from '../../lib/catalog'

/** Keeps both catalog detail destinations internal and mode-correct. */
export function CatalogLink(props: {
  media: AniListMedia
  mode?: CatalogMode
  class?: string
  style?: JSX.CSSProperties
  children: JSX.Element
}) {
  const mode = () => props.mode ?? 'ANIME'
  const className = () => props.class ?? ''

  return (
    <Show
      when={mode() === 'ANIME'}
      fallback={<Link class={className()} style={props.style} preload={false} to="/manga/$mangaId" params={{ mangaId: String(props.media.id) }}>{props.children}</Link>}
    >
      <Link class={className()} style={props.style} preload={false} to="/anime/$animeId" params={{ animeId: String(props.media.id) }}>
        {props.children}
      </Link>
    </Show>
  )
}
