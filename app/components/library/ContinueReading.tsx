import { Link } from '@tanstack/solid-router'
import { For, Show } from 'solid-js'
import type { AniListMedia } from '../../data/anilist/types'
import type { MangaReaderRecord } from '../../lib/persistence/mangaReader'
import { formatLastWatched } from '../../lib/library'

function readingPercent(record: MangaReaderRecord): number {
  if (!Number.isFinite(record.pageCount) || record.pageCount <= 0) return 0
  if (record.completed) return 100
  return Math.max(0, Math.min(100, ((record.pageIndex + 1) / record.pageCount) * 100))
}

export function ContinueReading(props: {
  items: MangaReaderRecord[]
  mediaById: ReadonlyMap<number, AniListMedia>
  busyIds: ReadonlySet<number>
  onRemove: (id: number) => void
}) {
  return (
    <section class="material-panel overflow-hidden" aria-labelledby="continue-reading-title">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
        <div>
          <p class="mono-signal">Reading / local history</p>
          <h2 id="continue-reading-title" class="mt-1 font-display text-3xl tracking-[-.03em]">Continue reading</h2>
        </div>
        <span class="mono-signal">{props.items.length} {props.items.length === 1 ? 'title' : 'titles'}</span>
      </div>
      <Show when={props.items.length > 0} fallback={<p class="px-5 py-8 text-sm text-text-secondary sm:px-6">Your reading history will appear here after a manga chapter starts.</p>}>
        <div class="divide-y divide-line">
          <For each={props.items}>{(item) => {
            const media = () => props.mediaById.get(item.anilistId)
            const title = () => media()?.title?.english ?? media()?.title?.romaji ?? item.title
            const cover = () => media()?.coverImage?.large ?? media()?.coverImage?.extraLarge ?? item.cover
            const percent = () => Math.round(readingPercent(item))
            return (
              <article class="grid grid-cols-[76px_minmax(0,1fr)] gap-4 p-4 sm:grid-cols-[92px_minmax(0,1fr)_auto] sm:items-center sm:p-5">
                <div class="relative aspect-[2/3] overflow-hidden rounded-[8px] bg-violet/12">
                  <Show when={cover()}>{(src) => <img class="size-full object-cover" src={src()} alt={`${title()} cover`} loading="lazy" decoding="async" />}</Show>
                  <span class="absolute bottom-1 left-1 rounded-[4px] bg-ink/80 px-1.5 py-1 font-mono text-[8px] uppercase text-white">Ch {item.chapterNumber}</span>
                </div>
                <div class="min-w-0">
                  <p class="mono-signal">{item.sourceName || item.sourceId} · Chapter {item.chapterNumber}</p>
                  <h3 class="mt-1 overflow-hidden text-ellipsis whitespace-nowrap text-base font-bold">{title()}</h3>
                  <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-ink/10" aria-label={`${percent()}% read`} role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent()}>
                    <span class="block h-full rounded-full bg-violet" style={{ width: `${percent()}%` }} />
                  </div>
                  <p class="mt-2 font-mono text-[9px] uppercase tracking-[.08em] text-text-muted">Page {Math.min(item.pageIndex + 1, item.pageCount || 1)} / {item.pageCount || '—'} {item.completed ? '· Completed' : ''} · {formatLastWatched(item.updatedAt)}</p>
                </div>
                <div class="col-span-2 flex flex-wrap gap-2 sm:col-span-1 sm:justify-end">
                  <Link class="ink-control inline-flex items-center px-3 py-2 no-underline" to="/manga/$mangaId/read/$chapterNumber" params={{ mangaId: String(item.anilistId), chapterNumber: String(item.chapterNumber) }} search={{ source: item.sourceId }}>{item.completed ? '↺ Read again' : '▶ Resume'}</Link>
                  <button class="paper-control px-3 py-2" type="button" disabled={props.busyIds.has(item.anilistId)} onClick={() => props.onRemove(item.anilistId)}>Remove</button>
                </div>
              </article>
            )
          }}</For>
        </div>
      </Show>
    </section>
  )
}
