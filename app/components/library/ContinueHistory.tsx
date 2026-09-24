import { For, Show } from 'solid-js'
import { Link } from '@tanstack/solid-router'
import type { AniListMedia } from '../../data/anilist/types'
import type { ContinueItem } from '../../lib/persistence/schema'
import { formatLastWatched, formatPlaybackTime, playbackPercent } from '../../lib/library'

export function ContinueHistory(props: {
  items: ContinueItem[]
  mediaById: ReadonlyMap<number, AniListMedia>
  busyIds: ReadonlySet<number>
  onRemove: (id: number) => void
}) {
  return (
    <section class="material-panel overflow-hidden" aria-labelledby="continue-history-title">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
        <div>
          <p class="mono-signal">Playback / local history</p>
          <h2 id="continue-history-title" class="mt-1 font-display text-3xl tracking-[-.03em]">Continue watching</h2>
        </div>
        <span class="mono-signal">{props.items.length} {props.items.length === 1 ? 'title' : 'titles'}</span>
      </div>
      <Show when={props.items.length > 0} fallback={<p class="px-5 py-8 text-sm text-text-secondary sm:px-6">Your watch history will appear here after a playable episode starts.</p>}>
        <div class="divide-y divide-line">
          <For each={props.items}>{(item) => {
            const media = () => props.mediaById.get(item.id)
            const title = () => media()?.title?.english ?? media()?.title?.romaji ?? item.title
            const cover = () => media()?.coverImage?.large ?? media()?.coverImage?.extraLarge ?? item.cover
            return (
              <article class="grid grid-cols-[88px_minmax(0,1fr)] gap-4 p-4 sm:grid-cols-[92px_minmax(0,1fr)_auto] sm:items-center sm:p-5">
              <div class="relative aspect-[2/3] w-full self-start overflow-hidden rounded-[8px] bg-violet/12">
                <Show when={cover()}>{(src) => <img class="size-full object-cover" src={src()} alt={`${title()} cover`} loading="lazy" decoding="async" />}</Show>
                <span class="absolute bottom-1 left-1 rounded-[4px] bg-ink/80 px-1.5 py-1 font-mono text-[8px] uppercase text-white">Ep {item.episodeNumber}</span>
              </div>
              <div class="min-w-0">
                <p class="mono-signal">{item.sourceName || item.sourceId} · Episode {item.episodeNumber}</p>
                <h3 class="mt-1 line-clamp-2 overflow-hidden text-base font-bold leading-snug">{title()}</h3>
                <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-ink/10" aria-label={`${Math.round(playbackPercent(item))}% watched`} role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(playbackPercent(item))}>
                  <span class="block h-full rounded-full bg-violet" style={{ width: `${playbackPercent(item)}%` }} />
                </div>
                <p class="mt-2 font-mono text-[9px] uppercase tracking-[.08em] text-text-muted">{formatPlaybackTime(item.position)} / {formatPlaybackTime(item.duration)} {item.completed ? '· Completed' : ''} · {formatLastWatched(item.ts)}</p>
              </div>
              <div class="col-span-2 flex flex-wrap gap-2 sm:col-span-1 sm:justify-end">
                <Link class="ink-control inline-flex items-center px-3 py-2 no-underline" to="/anime/$animeId/watch/$episodeId" params={{ animeId: String(item.id), episodeId: item.episodeId }} search={{ source: item.sourceId }}>{item.completed ? '↺ Watch again' : '▶ Resume'}</Link>
                <button class="paper-control px-3 py-2" type="button" disabled={props.busyIds.has(item.id)} onClick={() => props.onRemove(item.id)}>Remove</button>
              </div>
            </article>
            )
          }}</For>
        </div>
      </Show>
    </section>
  )
}
