import { createQuery, keepPreviousData } from '@tanstack/solid-query'
import { Link, useNavigate } from '@tanstack/solid-router'
import { createEffect, createMemo, For, on, Show, type Accessor } from 'solid-js'
import { browseQuery, genresQuery } from '../../data/options'
import { AnimeCard } from '../home/AnimeCard'
import { useOptionalCatalogMode } from '../layout/CatalogModeSwitch'
import {
  BROWSE_FILTER_KEYS,
  BROWSE_COUNTRIES,
  BROWSE_MAX_PAGE,
  BROWSE_PER_PAGE,
  BROWSE_SEASONS,
  BROWSE_SORTS,
  BROWSE_STATUSES,
  type BrowseFilterKey,
  type BrowseSearch,
  browseSearchSchema,
  browseFormats,
  makeBrowseSearch,
  pageWindow,
  searchAtPage,
  searchWithoutFilter,
  toBrowseParams,
} from '../../lib/browse'
import { formatEnum, formatSeason, formatStatus } from '../../lib/format'
import { normalizeSearchQuery } from '../../lib/search'

const SORT_LABELS: Record<(typeof BROWSE_SORTS)[number], string> = {
  TRENDING_DESC: 'Trending now',
  POPULARITY_DESC: 'Most popular',
  SCORE_DESC: 'Top rated',
  START_DATE_DESC: 'Recently released',
  UPDATED_AT_DESC: 'Recently updated',
}

const FILTER_LABELS: Record<BrowseFilterKey, string> = {
  query: 'Title',
  genre: 'Genre',
  format: 'Format',
  status: 'Status',
  countryOfOrigin: 'Country of origin',
  season: 'Season',
  year: 'Year',
}

export function ExplorePage(props: { search: Accessor<BrowseSearch> }) {
  const navigate = useNavigate()
  const catalogMode = useOptionalCatalogMode()
  const mode = () => catalogMode?.mode() ?? 'ANIME'
  const catalogName = () => mode() === 'MANGA' ? 'manga' : 'anime'
  const catalogNameTitle = () => mode() === 'MANGA' ? 'Manga' : 'Anime'
  let resultsHeading: HTMLHeadingElement | undefined
  const results = createQuery(() => ({
    ...browseQuery(toBrowseParams(props.search(), mode()), mode()),
    placeholderData: keepPreviousData,
  }))
  const genres = createQuery(genresQuery)
  const resultPage = () => results.data
  const pageInfo = () => resultPage()?.pageInfo
  const title = () => {
    const search = props.search()
    if (search.query) return `Results for “${search.query}”`
    if (search.genre) return `${search.genre} ${catalogName()}`
    return `Explore ${catalogName()}`
  }
  const filters = createMemo(() => BROWSE_FILTER_KEYS.flatMap((key) => {
    if (mode() === 'MANGA' && key === 'season') return []
    const value = props.search()[key]
    return value === undefined ? [] : [{ key, value: String(value) }]
  }))
  const pages = createMemo(() => pageWindow(props.search().page, pageInfo()?.lastPage ?? null))
  const visibleRange = () => {
    const count = resultPage()?.media.length ?? 0
    if (count === 0) return `No ${catalogName()} match these filters`
    const first = (props.search().page - 1) * BROWSE_PER_PAGE + 1
    return `${first}–${first + count - 1} of ${pageInfo()?.total.toLocaleString() ?? 'many'} titles`
  }

  createEffect(on(
    () => `${props.search().page}:${results.dataUpdatedAt}`,
    (_, previous) => {
      if (previous === undefined || results.isFetching) return
      queueMicrotask(() => {
        resultsHeading?.focus({ preventScroll: true })
        resultsHeading?.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
          block: 'start',
        })
      })
    },
  ))

  createEffect(on(mode, (nextMode) => {
    const search = props.search()
    const formats = browseFormats(nextMode)
    if ((search.format && !formats.includes(search.format)) || (nextMode === 'MANGA' && search.season)) {
      void navigate({
        to: '/explore',
        search: {
          ...search,
          format: search.format && formats.includes(search.format) ? search.format : undefined,
          season: nextMode === 'MANGA' ? undefined : search.season,
          page: 1,
        },
      })
    }
  }))

  const submit = (event: SubmitEvent) => {
    event.preventDefault()
    const raw = Object.fromEntries(new FormData(event.currentTarget as HTMLFormElement).entries())
    const parsed = browseSearchSchema.parse({
      ...raw,
      query: normalizeSearchQuery(typeof raw.query === 'string' ? raw.query : undefined) ?? undefined,
      page: 1,
    })
    void navigate({ to: '/explore', search: parsed })
  }
  const reset = () => { void navigate({ to: '/explore', search: makeBrowseSearch() }) }
  const clearFilter = (key: BrowseFilterKey) => {
    void navigate({ to: '/explore', search: searchWithoutFilter(props.search(), key) })
  }

  return (
    <section class="explore-page" aria-labelledby="explore-title">
      <header class="explore-masthead">
        <div class="explore-masthead-copy">
          <p class="explore-kicker">{catalogNameTitle()} catalog / browse and filter</p>
          <h1 id="explore-title">{title()}</h1>
          <p class="explore-summary">
            <Show when={filters().length > 0} fallback={mode() === 'MANGA' ? <>Browse manga by title, genre, or status.</> : <>Browse anime by title, genre, season, or status.</>}>
              {filters().length} active {filters().length === 1 ? 'filter' : 'filters'} shape these results.
            </Show>
          </p>
        </div>
        <div class="explore-catalog-stat" aria-live="polite">
          <span>Catalog size</span>
          <strong>{pageInfo()?.total.toLocaleString() ?? '—'}</strong>
          <small>matching titles</small>
        </div>
      </header>

      <form class="explore-filter-deck" onSubmit={submit} aria-label={`${catalogNameTitle()} discovery filters`}>
        <div class="explore-search-row">
          <div class="explore-search-field">
            <label for="explore-query">Search titles</label>
            <input class="editorial-field" id="explore-query" name="query" type="search" value={props.search().query ?? ''} placeholder="Search by title" autocomplete="off" />
          </div>
          <button class="btn primary explore-search-submit" type="submit">Search {catalogName()}</button>
        </div>
        <div class="explore-filter-fields">
          <label>Type
            <select
              class="editorial-field"
              value={mode()}
              aria-label="Catalog type"
              onChange={(event) => {
                const next = event.currentTarget.value === 'MANGA' ? 'MANGA' : 'ANIME'
                if (catalogMode) void catalogMode.changeMode(next)
              }}
            >
              <option value="ANIME">Anime</option>
              <option value="MANGA">Manga</option>
            </select>
          </label>
          <label>Genre
            <select class="editorial-field" name="genre" value={props.search().genre ?? ''}>
              <option value="">All genres</option>
              <For each={genres.data ?? []}>{(genre) => <option value={genre}>{genre}</option>}</For>
            </select>
          </label>
          <label>Country of origin
            <select class="editorial-field" name="countryOfOrigin" value={props.search().countryOfOrigin ?? ''}>
              <option value="">Any country</option>
              <For each={BROWSE_COUNTRIES}>{([code, label]) => <option value={code}>{label}</option>}</For>
            </select>
          </label>
          <label>Format
            <select class="editorial-field" name="format" value={props.search().format ?? ''}>
              <option value="">Any format</option>
              <For each={browseFormats(mode())}>{(format) => <option value={format}>{formatEnum(format)}</option>}</For>
            </select>
          </label>
          <label>Status
            <select class="editorial-field" name="status" value={props.search().status ?? ''}>
              <option value="">Any status</option>
              <For each={BROWSE_STATUSES}>{(status) => <option value={status}>{formatStatus(status)}</option>}</For>
            </select>
          </label>
          <Show when={mode() === 'ANIME'}>
            <label>Season
              <select class="editorial-field" name="season" value={props.search().season ?? ''}>
                <option value="">Any season</option>
                <For each={BROWSE_SEASONS}>{(season) => <option value={season}>{formatSeason(season)}</option>}</For>
              </select>
            </label>
          </Show>
          <label>Year
            <input class="editorial-field" name="year" type="number" min="1960" max="2100" value={props.search().year ?? ''} placeholder="Any year" inputmode="numeric" />
          </label>
          <label>Sort by
            <select class="editorial-field" name="sort" value={props.search().sort}>
              <For each={BROWSE_SORTS}>{(sort) => <option value={sort}>{SORT_LABELS[sort]}</option>}</For>
            </select>
          </label>
        </div>
        <div class="explore-filter-footer">
          <div class="explore-filter-chips" aria-label="Active filters">
            <For each={filters()}>{(filter) => (
              <button type="button" class="explore-filter-chip" onClick={() => clearFilter(filter.key)} aria-label={`Remove ${FILTER_LABELS[filter.key]} filter ${filter.value}`}>
                <span>{FILTER_LABELS[filter.key]}</span>{filter.value}<b aria-hidden="true">×</b>
              </button>
            )}</For>
            <Show when={filters().length === 0}><span class="explore-no-filters">No filters applied</span></Show>
          </div>
          <button class="btn ghost small" type="button" onClick={reset} disabled={filters().length === 0 && props.search().sort === 'TRENDING_DESC'}>Reset filters</button>
        </div>
      </form>

      <Show when={!results.isPending} fallback={<ExploreLoading />}>
        <Show when={!results.isError} fallback={
          <section class="explore-state" role="alert">
            <p class="explore-kicker">Unable to load {catalogName()} results</p>
            <h2>Discovery is temporarily unavailable.</h2>
            <p>AniList could not return this collection. Try the request again.</p>
            <button class="btn primary" type="button" onClick={() => { void results.refetch() }}>Retry discovery</button>
          </section>
        }>
          <Show when={resultPage()!.media.length > 0} fallback={
            <section class="explore-state">
              <p class="explore-kicker">No results found</p>
              <Show when={props.search().page > 1} fallback={<><h2>No {catalogName()} match this combination.</h2><p>Try removing a filter or searching with a broader title.</p><button class="btn" type="button" onClick={reset}>Clear filters</button></>}>
                <h2>Page {props.search().page} is beyond this collection.</h2>
                <p>The catalog ends before this page.</p>
                <Link class="btn primary" to="/explore" search={searchAtPage(props.search(), 1)}>Return to page 1</Link>
              </Show>
            </section>
          }>
            <section class="explore-results" aria-labelledby="explore-results-title" aria-busy={results.isFetching}>
              <div class="explore-results-head">
                <div>
                  <p class="explore-kicker">Page {String(props.search().page).padStart(2, '0')}</p>
                  <h2 id="explore-results-title" ref={resultsHeading} tabindex="-1">{visibleRange()}</h2>
                </div>
                <div class="explore-results-meta">
                  <span>{SORT_LABELS[props.search().sort]}</span>
                  <Show when={results.isFetching}><span class="explore-sync"><i />Updating</span></Show>
                </div>
              </div>
              <div class="explore-grid" classList={{ 'is-retuning': results.isFetching }}>
                <For each={resultPage()!.media}>{(anime) => <AnimeCard anime={anime} mode={mode()} />}</For>
              </div>
              <nav class="explore-pagination" aria-label="Explore results pages" aria-busy={results.isFetching}>
                <span class="explore-pagination-label">Pages</span>
                <div class="explore-page-controls">
                  <Show when={props.search().page > 1} fallback={<button class="explore-page-direction" type="button" disabled>← Previous</button>}>
                    <Link preload={false} class="explore-page-direction" to="/explore" search={searchAtPage(props.search(), props.search().page - 1)}>← Previous</Link>
                  </Show>
                  <div class="explore-page-numbers">
                    <For each={pages()}>{(page) => (
                      <Show when={page !== props.search().page} fallback={<span class="explore-page-number active" aria-current="page">{String(page).padStart(2, '0')}</span>}>
                        <Link preload={false} class="explore-page-number" to="/explore" search={searchAtPage(props.search(), page)} aria-label={`Page ${page}`}>{String(page).padStart(2, '0')}</Link>
                      </Show>
                    )}</For>
                  </div>
                  <Show when={pageInfo()!.hasNextPage && props.search().page < BROWSE_MAX_PAGE} fallback={<button class="explore-page-direction" type="button" disabled>Next →</button>}>
                    <Link preload={false} class="explore-page-direction" to="/explore" search={searchAtPage(props.search(), props.search().page + 1)}>Next →</Link>
                  </Show>
                </div>
                <span class="explore-pagination-total">{pageInfo()!.lastPage.toLocaleString()} pages</span>
              </nav>
            </section>
          </Show>
        </Show>
      </Show>
    </section>
  )
}

function ExploreLoading() {
  return <section class="explore-state" aria-busy="true"><p class="explore-kicker">Loading catalog</p><h2>Loading the collection…</h2></section>
}
