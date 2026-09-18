import { createQuery } from '@tanstack/solid-query'
import { Link, useNavigate } from '@tanstack/solid-router'
import { createMemo, createSignal, For, onCleanup, onMount, Show, type Accessor } from 'solid-js'
import { scheduleQuery } from '../../data/options'
import type { AniListScheduleItem } from '../../data/anilist/types'
import { formatEnum } from '../../lib/format'
import { browserViewerData } from '../../lib/persistence/viewer'
import {
  countdownLabel,
  dateFromKey,
  extractScheduleGenres,
  groupScheduleByDay,
  itemsInRange,
  localDateKey,
  scheduleRange,
  scheduleRequestRange,
  shiftedDateKey,
  type ScheduleSearch,
} from '../../lib/schedule'
import { PageShell } from '../ui/PageShell'

const STATUS_LABELS: Record<string, string> = {
  RELEASING: 'Releasing',
  NOT_YET_RELEASED: 'Not Yet Released',
  FINISHED: 'Finished',
  CANCELLED: 'Cancelled',
  HIATUS: 'On Hiatus',
}

export function SchedulePage(props: { search: Accessor<ScheduleSearch> }) {
  const navigate = useNavigate()
  const [savedIds, setSavedIds] = createSignal<ReadonlySet<number>>(new Set())
  const [savedIdsError, setSavedIdsError] = createSignal(false)
  const [now, setNow] = createSignal(Date.now())
  const search = () => props.search()
  const dateKey = () => search().date ?? localDateKey(new Date())
  const range = createMemo(() => scheduleRange(dateKey(), search().view))
  const request = createMemo(() => scheduleRequestRange(dateKey(), search().view))
  const schedule = createQuery(() => scheduleQuery(request().start, request().end))

  const rawItems = createMemo(() => itemsInRange(schedule.data ?? [], range().start, range().end))
  const availableGenres = createMemo(() => extractScheduleGenres(rawItems()))

  const items = createMemo(() => rawItems().filter((item) => {
    if (search().saved && (item.media?.id === undefined || !savedIds().has(item.media.id))) return false
    if (search().genre && !(item.media?.genres ?? []).some((g) => g === search().genre)) return false
    if (search().status && item.media?.status !== search().status) return false
    return true
  }))
  const grouped = createMemo(() => groupScheduleByDay(items()))

  onMount(() => {
    browserViewerData.getFavorites()
      .then((favorites) => setSavedIds(new Set(favorites.map((item) => item.id))))
      .catch((cause) => {
        console.error('Failed to load saved anime for schedule filtering.', cause)
        setSavedIdsError(true)
      })
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    onCleanup(() => window.clearInterval(timer))
  })

  const updateSearch = (changes: Partial<ScheduleSearch>) => {
    void navigate({ to: '/schedule', search: { ...search(), ...changes } })
  }
  const move = (direction: -1 | 1) => updateSearch({ date: shiftedDateKey(dateKey(), search().view, direction) })
  const dateLabel = () => new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' }).format(dateFromKey(dateKey()))
  const weekLabel = () => {
    const first = range().start
    const last = new Date(range().end)
    last.setDate(last.getDate() - 1)
    return `${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(first)} – ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(last)}`
  }

  return (
    <PageShell class="schedule-page">
      <header class="schedule-masthead">
        <div class="schedule-masthead-copy">
          <p class="schedule-kicker">Release calendar / AniList airing data</p>
          <h1>What’s airing.</h1>
          <p>Track upcoming episodes in your local time, then narrow the signal to anime already saved on this device.</p>
        </div>
        <nav class="schedule-period-nav" aria-label="Schedule period">
          <button class="schedule-period-button" type="button" onClick={() => move(-1)} aria-label="Previous period">← Previous</button>
          <button class="schedule-period-button schedule-period-today" type="button" onClick={() => updateSearch({ date: localDateKey(new Date()) })}>Today</button>
          <button class="schedule-period-button" type="button" onClick={() => move(1)} aria-label="Next period">Next →</button>
        </nav>
      </header>

      <Show when={savedIdsError()}>
        <p class="schedule-alert material-panel" role="status">
          Saved anime could not be read from your device. The “Saved only” filter may be incomplete.
        </p>
      </Show>

      <section class="schedule-calendar material-panel" aria-labelledby="schedule-title">
        <header class="schedule-calendar-header">
          <div class="schedule-calendar-heading">
            <p class="schedule-kicker">{search().view === 'week' ? 'Week view' : 'Day view'} / local time</p>
            <h2 id="schedule-title">{search().view === 'week' ? weekLabel() : dateLabel()}</h2>
          </div>
          <div class="schedule-view-toggle" role="group" aria-label="Schedule view">
            <button class="schedule-view-button" classList={{ active: search().view === 'day' }} type="button" aria-pressed={search().view === 'day'} onClick={() => updateSearch({ view: 'day' })}>Day</button>
            <button class="schedule-view-button" classList={{ active: search().view === 'week' }} type="button" aria-pressed={search().view === 'week'} onClick={() => updateSearch({ view: 'week' })}>Week</button>
          </div>
        </header>

        <div class="schedule-filter-deck" aria-label="Schedule filters">
          <label class="editorial-field-group schedule-filter-field">
            <span class="editorial-label">Genre</span>
            <select class="editorial-field" value={search().genre ?? ''} onChange={(event) => updateSearch({ genre: event.currentTarget.value || undefined })}>
              <option value="">All genres</option>
              <For each={availableGenres()}>{(g) => <option value={g}>{g}</option>}</For>
            </select>
          </label>
          <label class="editorial-field-group schedule-filter-field">
            <span class="editorial-label">Status</span>
            <select class="editorial-field" value={search().status ?? ''} onChange={(event) => updateSearch({ status: event.currentTarget.value || undefined })}>
              <option value="">All statuses</option>
              <For each={['RELEASING', 'NOT_YET_RELEASED', 'FINISHED']}>{(st) => <option value={st}>{STATUS_LABELS[st] ?? st}</option>}</For>
            </select>
          </label>
          <label class="schedule-saved-toggle">
            <input type="checkbox" checked={search().saved} onChange={(event) => updateSearch({ saved: event.currentTarget.checked })} />
            <span>Saved only</span>
          </label>
        </div>

        <Show when={!schedule.isPending} fallback={<div class="schedule-state schedule-loading"><p class="mono-signal">Reading the release calendar…</p></div>}>
          <Show when={!schedule.isError} fallback={<div class="schedule-state" role="alert"><p class="schedule-kicker">Connection issue</p><h3>The schedule is unavailable.</h3><p>AniList could not return airing times right now.</p><button class="ink-control schedule-state-action" type="button" onClick={() => { void schedule.refetch() }}>Retry schedule</button></div>}>
            <Show when={items().length > 0} fallback={<div class="schedule-state"><p class="schedule-kicker">No releases in this view</p><h3>A quiet stretch.</h3><p>Try another date, genre, or turn off filters to see the full AniList calendar.</p></div>}>
              <div class="schedule-days">
                <For each={[...grouped().entries()]}>{([day, dayItems]) => <section class="schedule-day" aria-labelledby={`schedule-${day}`}>
                  <div class="schedule-day-heading"><h3 id={`schedule-${day}`}>{new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(dateFromKey(day))}</h3><span class="mono-signal">{dayItems.length} {dayItems.length === 1 ? 'release' : 'releases'}</span></div>
                  <div class="schedule-day-items">
                    <For each={dayItems}>{(item) => <ScheduleRow item={item} now={now()} saved={item.media?.id !== undefined && savedIds().has(item.media.id)} />}</For>
                  </div>
                </section>}</For>
              </div>
            </Show>
          </Show>
        </Show>

        <footer class="schedule-footnote">
          Times shown reflect confirmed AniList broadcast schedules in your local timezone. Delayed or unannounced episodes remain unlisted.
        </footer>
      </section>
    </PageShell>
  )
}

function ScheduleRow(props: { item: AniListScheduleItem; now: number; saved: boolean }) {
  const animeId = () => props.item.media?.id
  const title = () => props.item.media?.title?.english ?? props.item.media?.title?.romaji ?? 'Untitled release'

  return (
    <article class="schedule-row">
      <Show when={animeId()} fallback={<div class="schedule-row-cover" />}>
        {(id) => (
          <Link class="schedule-row-cover" to="/anime/$animeId" params={{ animeId: String(id()) }} aria-label={`Open ${title()}`}>
            {props.item.media?.coverImage?.large ? <img src={props.item.media.coverImage.large} alt="" loading="lazy" decoding="async" /> : null}
          </Link>
        )}
      </Show>
      <div class="schedule-row-copy">
        <p class="schedule-row-meta">Episode {props.item.episode} · {props.item.media?.format ? formatEnum(props.item.media.format) : 'Anime'}{props.saved ? ' · Saved' : ''}</p>
        <Show when={animeId()} fallback={<h4 class="schedule-row-title">{title()}</h4>}>
          {(id) => <Link class="schedule-row-title" to="/anime/$animeId" params={{ animeId: String(id()) }}>{title()}</Link>}
        </Show>
        <p class="schedule-row-time">{new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(props.item.airingAt * 1000))}</p>
      </div>
      <div class="schedule-row-action">
        <strong>{countdownLabel(props.item.airingAt, props.now)}</strong>
        <Show when={animeId() && props.item.airingAt * 1000 <= props.now + 60000}>
          {(id) => (
            <Link class="schedule-watch-button" to="/anime/$animeId/watch/$episodeId" params={{ animeId: String(id()), episodeId: props.item.episode ? `episode-${props.item.episode}` : 'next' }}>
              <span class="schedule-watch-glyph" aria-hidden="true" />
              <span>Watch now</span>
            </Link>
          )}
        </Show>
      </div>
    </article>
  )
}
