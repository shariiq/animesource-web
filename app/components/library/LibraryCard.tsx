import { For, Show } from 'solid-js'
import type { CatalogMode } from '../../lib/catalog'
import { catalogCountLabel, catalogFormat, catalogLibraryStatus, catalogStatus } from '../../lib/catalog'
import type { FavoriteStatus } from '../../lib/persistence/schema'
import type { LibraryEntry } from '../../lib/library'
import { FAVORITE_STATUSES, libraryTitle } from '../../lib/library'
import { formatScore } from '../../lib/format'
import { CatalogLink } from '../home/CatalogLink'

export function LibraryCard(props: {
  entry: LibraryEntry
  mode: CatalogMode
  busy: boolean
  onStatus: (status: FavoriteStatus) => void
  onRemove: () => void
}) {
  const media = () => props.entry.media
  const title = () => libraryTitle(props.entry)
  const cover = () => media()?.coverImage?.large ?? media()?.coverImage?.extraLarge ?? props.entry.favorite.cover
  const score = () => props.entry.unavailable ? null : (media()?.averageScore ?? props.entry.favorite.averageScore)
  const count = () => props.entry.unavailable ? null : catalogCountLabel(props.mode, media())
  const metadata = () => props.entry.unavailable ? null : catalogFormat(props.mode, media())
  const mediaStatus = () => props.entry.unavailable ? null : catalogStatus(props.mode, media()?.status)
  const coverContent = () => (
    <Show when={cover()}>
      {(src) => <img class="absolute inset-0 size-full object-cover" src={src()} alt={`${title()} cover`} loading="lazy" decoding="async" classList={{ 'grayscale': props.entry.unavailable }} />}
    </Show>
  )

  return (
    <article class="editorial-row grid min-w-0 grid-cols-[104px_minmax(0,1fr)] items-stretch sm:grid-cols-[128px_minmax(0,1fr)]" classList={{ 'opacity-70': props.entry.unavailable }}>
      {/* Cover fills the row edge-to-edge: the 2/3 minimum keeps the poster
          legible, while stretch absorbs taller meta columns so no blank seam
          opens between stacked entries on narrow viewports. */}
      <Show when={media()} keyed fallback={<div class="relative min-h-[156px] w-full self-stretch overflow-hidden bg-violet/12 sm:min-h-[192px]">{coverContent()}</div>}>
        {(current) => <CatalogLink media={current} mode={props.mode} class="relative min-h-[156px] w-full self-stretch overflow-hidden bg-violet/12 sm:min-h-[192px]">{coverContent()}</CatalogLink>}
      </Show>
      <div class="flex min-w-0 flex-col gap-3 p-4 sm:p-5">
        <div>
          <Show when={props.entry.unavailable} fallback={<p class="mono-signal">{[mediaStatus(), metadata(), count()].filter(Boolean).join(' · ') || `Saved ${props.mode === 'MANGA' ? 'manga' : 'anime'}`}</p>}>
            <p class="mono-signal text-red-700">Currently unavailable on AniList</p>
          </Show>
          <Show when={media()} keyed fallback={<span class="mt-1 block overflow-hidden text-ellipsis text-lg font-bold tracking-[-.035em]">{title()}</span>}>
            {(current) => <CatalogLink media={current} mode={props.mode} class="mt-1 block overflow-hidden text-ellipsis text-lg font-bold tracking-[-.035em] hover:underline">{title()}</CatalogLink>}
          </Show>
          <Show when={props.entry.unavailable}><p class="mt-1 text-xs text-text-secondary">AniList no longer returns this title. Remove it when you are ready.</p></Show>
          <Show when={score() !== null && score() !== undefined}><p class="mt-1 text-xs text-text-muted"><strong class="text-ink">{formatScore(score()!)}</strong> AniList score</p></Show>
        </div>
        <div class="mt-auto flex flex-wrap items-end gap-2">
          <label class="min-w-[150px] flex-1 text-[9px] font-medium uppercase tracking-[.1em] text-text-muted">
            {props.mode === 'MANGA' ? 'Reading status' : 'Library status'}
            <select
              class="editorial-field mt-1 h-9 w-full px-3 text-xs"
              value={props.entry.favorite.status ?? 'PLANNING'}
              disabled={props.busy}
              onChange={(event) => props.onStatus(event.currentTarget.value as FavoriteStatus)}
            >
              <ForStatus mode={props.mode} />
            </select>
          </label>
          <button class="paper-control h-9 min-h-9 px-3" type="button" disabled={props.busy} onClick={() => props.onRemove()} aria-label={`Remove ${title()} from library`}>Remove</button>
        </div>
      </div>
    </article>
  )
}

function ForStatus(props: { mode: CatalogMode }) {
  return <For each={FAVORITE_STATUSES}>{(status) => <option value={status}>{catalogLibraryStatus(props.mode, status)}</option>}</For>
}
