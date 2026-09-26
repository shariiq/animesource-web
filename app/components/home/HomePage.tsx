import { createQuery } from '@tanstack/solid-query'
import { createMemo, createSignal, For, Show } from 'solid-js'
import { Link } from '@tanstack/solid-router'
import { homeQuery } from '../../data/options'
import type { AniListMedia } from '../../data/anilist/types'
import { HeroCarousel } from './HeroCarousel'
import { AnimeCard } from './AnimeCard'
import { Rail } from './Rail'
import { currentSeason, nextSeasonOf } from '../../lib/format'
import { makeBrowseSearch } from '../../lib/browse'
import { catalogCopy, type CatalogMode } from '../../lib/catalog'
import { useOptionalCatalogMode } from '../layout/CatalogModeSwitch'
import { PageShell } from '../ui/PageShell'
import { SectionHeading } from '../ui/SectionHeading'
import { HomeLoadingSkeleton } from '../ui/LoadingSkeleton'

type CollectionFilter = 'all' | 'airing' | 'rated'

export function HomePage(props: { mode?: CatalogMode } = {}) {
  const catalogMode = useOptionalCatalogMode()
  const mode = () => props.mode ?? (catalogMode ? catalogMode.mode() : 'ANIME')
  const copy = () => catalogCopy[mode()]
  const home = createQuery(() => ({
    ...homeQuery(mode()),
    // The route loader owns the server fetch. Keeping this observer disabled
    // during SSR prevents a failed request from being serialized as an error
    // tree that disagrees with the server's loading markup during hydration.
    enabled: typeof window !== 'undefined',
  }))
  const season = currentSeason()
  const nextSeason = nextSeasonOf()
  const [collectionFilter, setCollectionFilter] = createSignal<CollectionFilter>('all')
  const collectionItems = createMemo<AniListMedia[]>(() => {
    // Keep the last good payload visible through background refetches:
    // TanStack keeps `data` defined while `isFetching` is true, so gating on
    // `!isFetching` would flash the full loading state on every stale refetch
    // (focus, remount, 10-minute staleTime expiry).
    const data = home.isSuccess ? home.data : undefined
    if (!data) return []
    if (collectionFilter() === 'airing') return data.season.media.filter((anime) => anime.status === 'RELEASING')
    if (collectionFilter() === 'rated') return data.topRated.media
    return data.trending.media
  })

  return (
    <PageShell>
      <Show
        when={home.isSuccess ? home.data : undefined}
        fallback={
          <Show
            when={!home.isError}
            fallback={<State title="Couldn't reach AniList" copy="Discovery is temporarily unavailable." action={() => void home.refetch()} />}
          >
            <HomeLoading mode={mode()} />
          </Show>
        }
        keyed
      >
            {(data) => <>
              <Show when={home.isFetching}>
                <p class="mono-signal" role="status" aria-live="polite">Refreshing discovery…</p>
              </Show>
              <HeroCarousel items={data.trending.media} mode={mode()} />
              <Rail
                title={copy().freshRailTitle}
                items={data.season.media}
                mode={mode()}
                explore={mode() === 'ANIME' ? makeBrowseSearch({ sort: 'POPULARITY_DESC', season: season.season, year: season.year }) : makeBrowseSearch({ sort: 'UPDATED_AT_DESC' })}
              />
              <section class="section" aria-labelledby="collection-heading">
                <SectionHeading id="collection-heading" title={copy().collectionTitle} />
                <div class="material-panel overflow-hidden">
                  <div class="flex min-h-[58px] flex-wrap items-center justify-between gap-4 border-b border-line px-5 py-3 sm:px-6">
                    <strong class="text-[13px] tracking-[-.02em]"><span class="font-mono text-[9px] font-normal uppercase tracking-[.08em] text-quiet">{collectionItems().length} {copy().collectionItemsLabel}</span></strong>
                    <div class="flex gap-[6px]" aria-label={`${copy().singular} collection filter`}>
                      <CollectionFilterButton current={collectionFilter} setCurrent={setCollectionFilter} value="all" label="All" />
                      <CollectionFilterButton current={collectionFilter} setCurrent={setCollectionFilter} value="airing" label={copy().activeFilter} />
                      <CollectionFilterButton current={collectionFilter} setCurrent={setCollectionFilter} value="rated" label="Top rated" />
                    </div>
                  </div>
                  <div class="grid grid-cols-1 divide-y divide-line md:grid-cols-2 md:[&>*:nth-child(odd)]:border-r md:[&>*:nth-child(odd)]:border-line">
                    <For each={collectionItems().slice(0, 12)}>{(anime, index) => <AnimeCard anime={anime} mode={mode()} rank={index() + 1} />}</For>
                  </div>
                  <div class="border-t border-line px-6 py-4 text-right font-mono text-[9px] uppercase tracking-[.1em]">
                    <Link
                      to="/explore"
                      search={makeBrowseSearch(
                        mode() === 'MANGA'
                          ? {
                              sort: collectionFilter() === 'rated' ? 'SCORE_DESC' : collectionFilter() === 'airing' ? 'UPDATED_AT_DESC' : 'TRENDING_DESC',
                              status: collectionFilter() === 'airing' ? 'RELEASING' : undefined,
                            }
                          : {
                              sort: collectionFilter() === 'rated' ? 'SCORE_DESC' : collectionFilter() === 'airing' ? 'POPULARITY_DESC' : 'TRENDING_DESC',
                              season: collectionFilter() === 'airing' ? season.season : undefined,
                              year: collectionFilter() === 'airing' ? season.year : undefined,
                            },
                      )}
                    >View all {copy().plural} →</Link>
                  </div>
                </div>
              </section>
              <section class="home-deferred-section section" aria-labelledby="season-heading">
                <SectionHeading id="season-heading" title={copy().seasonalTitle} />
                <div class="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                  <AnimeColumn mode={mode()} title={copy().columnTrending} items={data.trending.media} search={makeBrowseSearch({ sort: 'TRENDING_DESC' })} />
                  <AnimeColumn mode={mode()} title={copy().columnSecond} items={data.season.media} search={makeBrowseSearch(mode() === 'ANIME' ? { sort: 'POPULARITY_DESC', season: season.season, year: season.year } : { sort: 'UPDATED_AT_DESC' })} />
                  <AnimeColumn mode={mode()} title={copy().columnThird} items={data.allTime.media} search={makeBrowseSearch({ sort: 'POPULARITY_DESC' })} />
                </div>
                <div class="mt-5"><AnimeColumn mode={mode()} title={copy().columnFourth} items={data.upcoming.media} search={makeBrowseSearch(mode() === 'ANIME' ? { sort: 'POPULARITY_DESC', status: 'NOT_YET_RELEASED', season: nextSeason.season, year: nextSeason.year } : { sort: 'START_DATE_DESC', status: 'NOT_YET_RELEASED' })} /></div>
              </section>
            </>}
      </Show>
    </PageShell>
  )
}

function CollectionFilterButton(props: { current: () => CollectionFilter; setCurrent: (value: CollectionFilter) => void; value: CollectionFilter; label: string }) {
  return <button type="button" class="paper-control min-h-[40px] rounded-[6px] px-3 text-[8.5px] sm:min-h-[30px]" classList={{ 'border-ink bg-ink text-white': props.current() === props.value }} aria-pressed={props.current() === props.value} onClick={() => props.setCurrent(props.value)}>{props.label}</button>
}

function AnimeColumn(props: { mode: CatalogMode; title: string; items: AniListMedia[]; search?: ReturnType<typeof makeBrowseSearch> }) {
  return (
    <section class="material-panel flex flex-col overflow-hidden">
      <div class="flex items-center justify-between border-b border-line px-4 py-3">
        <h3 class="text-sm font-bold">{props.title}</h3>
        <Show when={props.search} keyed>{(search) => <Link class="font-mono text-[8px] uppercase tracking-[.1em]" to="/explore" search={search}>View all →</Link>}</Show>
      </div>
      {/* Rows stretch evenly to fill the stretched grid panel so every column's
          last row lands flush on the panel's bottom border. */}
      <div class="flex flex-1 flex-col divide-y divide-line [&>*]:flex-1 [&>*:last-child]:border-b-0">
        <Show when={props.items.length} fallback={<p class="px-4 py-6 text-sm text-text-secondary">No {props.mode === 'MANGA' ? 'manga' : 'anime'} available right now.</p>}>
          <For each={props.items.slice(0, 3)}>{(anime, index) => <AnimeCard anime={anime} mode={props.mode} rank={index() + 1} />}</For>
        </Show>
      </div>
    </section>
  )
}

function HomeLoading(props: { mode: CatalogMode }) {
  return <HomeLoadingSkeleton message={catalogCopy[props.mode].loading} />
}

function State(props: { title: string; copy?: string; action?: () => void }) {
  return <section class="material-panel mx-auto my-24 max-w-xl p-10 text-center"><h2 class="font-display text-4xl">{props.title}</h2><Show when={props.copy}><p class="mt-3 text-sm text-text-secondary">{props.copy}</p></Show><Show when={props.action}><button class="ink-control mt-6 px-5 py-3" type="button" onClick={() => props.action?.()}>Retry</button></Show></section>
}
