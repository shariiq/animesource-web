import { Link } from '@tanstack/solid-router'
import { For, Show } from 'solid-js'
import type { FavoriteStatus } from '../../lib/persistence/schema'
import type { LibraryEntry } from '../../lib/library'
import { FAVORITE_STATUSES, libraryTitle } from '../../lib/library'
import { formatEnum, formatScore } from '../../lib/format'

export function LibraryCard(props: {
  entry: LibraryEntry
  busy: boolean
  onStatus: (status: FavoriteStatus) => void
  onRemove: () => void
}) {
  const media = () => props.entry.media
  const title = () => libraryTitle(props.entry)
  const cover = () => media()?.coverImage?.large ?? media()?.coverImage?.extraLarge ?? props.entry.favorite.cover
  const format = () => media()?.format ?? props.entry.favorite.format
  const score = () => props.entry.unavailable ? null : (media()?.averageScore ?? props.entry.favorite.averageScore)
  const episodes = () => props.entry.unavailable ? null : media()?.episodes

  return (
    <article class="editorial-row grid min-w-0 grid-cols-[92px_minmax(0,1fr)] sm:grid-cols-[116px_minmax(0,1fr)]" classList={{ 'opacity-70': props.entry.unavailable }}>
      <Link class="relative min-h-[168px] overflow-hidden bg-violet/12" to="/anime/$animeId" params={{ animeId: String(props.entry.favorite.id) }} aria-label={`Open ${title()}`}>
        <Show when={cover()}>
          {(src) => <img class="size-full object-cover" src={src()} alt={`${title()} cover`} loading="lazy" decoding="async" classList={{ 'grayscale': props.entry.unavailable }} />}
        </Show>
      </Link>
      <div class="flex min-w-0 flex-col gap-3 p-4 sm:p-5">
        <div>
          <Show when={props.entry.unavailable} fallback={<p class="mono-signal">{[format() ? formatEnum(format()) : null, episodes() ? `${episodes()} episodes` : null].filter(Boolean).join(' · ') || 'Saved anime'}</p>}>
            <p class="mono-signal text-red-700">Currently unavailable on AniList</p>
          </Show>
          <Link class="mt-1 block overflow-hidden text-ellipsis text-lg font-bold tracking-[-.035em] hover:underline" to="/anime/$animeId" params={{ animeId: String(props.entry.favorite.id) }}>{title()}</Link>
          <Show when={props.entry.unavailable}><p class="mt-1 text-xs text-text-secondary">AniList no longer returns this title. Remove it when you are ready.</p></Show>
          <Show when={score() !== null && score() !== undefined}><p class="mt-1 text-xs text-text-muted"><strong class="text-ink">{formatScore(score()!)}</strong> AniList score</p></Show>
        </div>
        <div class="mt-auto flex flex-wrap items-end gap-2">
          <label class="min-w-[150px] flex-1 text-[9px] font-medium uppercase tracking-[.1em] text-text-muted">
            Library status
            <select
              class="editorial-field mt-1 h-9 w-full px-3 text-xs"
              value={props.entry.favorite.status ?? 'PLANNING'}
              disabled={props.busy}
              onChange={(event) => props.onStatus(event.currentTarget.value as FavoriteStatus)}
            >
              <ForStatus />
            </select>
          </label>
          <button class="paper-control h-9 min-h-9 px-3" type="button" disabled={props.busy} onClick={() => props.onRemove()} aria-label={`Remove ${title()} from library`}>Remove</button>
        </div>
      </div>
    </article>
  )
}

function ForStatus() {
  return <For each={FAVORITE_STATUSES}>{(status) => <option value={status}>{formatEnum(status)}</option>}</For>
}
