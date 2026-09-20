import { createQuery } from '@tanstack/solid-query'
import { createMemo, createSignal, For, Show } from 'solid-js'
import { Link } from '@tanstack/solid-router'
import { homeQuery } from '../../data/options'
import type { AniListMedia } from '../../data/anilist/types'
import { HeroCarousel } from './HeroCarousel'
import { AnimeCard } from './AnimeCard'
import { GenreNav } from './GenreNav'
import { currentSeason, nextSeasonOf } from '../../lib/format'
import { makeBrowseSearch } from '../../lib/browse'
import { PageShell } from '../ui/PageShell'
import { SectionHeading } from '../ui/SectionHeading'

type CollectionFilter = 'all' | 'airing' | 'rated'

export function HomePage() {
  const home = createQuery(() => ({
    ...homeQuery(),
    // The route loader owns the server fetch. Keeping this observer disabled
    // during SSR prevents a failed request from being serialized as an error
    // tree that disagrees with the server's loading markup during hydration.
    enabled: typeof window !== 'undefined',
  }))
  const season = currentSeason()
  const nextSeason = nextSeasonOf()
  const [collectionFilter, setCollectionFilter] = createSignal<CollectionFilter>('all')
  const collectionItems = createMemo<AniListMedia[]>(() => {
    const data = home.data
    if (!data) return []
    if (collectionFilter() === 'airing') return data.season.media.filter((anime) => anime.status === 'RELEASING')
    if (collectionFilter() === 'rated') return data.topRated.media
    return data.trending.media
  })

  return (
    <PageShell>
      <Show when={!home.isPending} fallback={<HomeLoading />}>
        <Show when={!home.isError} fallback={<State title="Couldn't reach AniList" copy="Discovery is temporarily unavailable." action={() => void home.refetch()} />}>
          <Show when={home.data} fallback={<State title="No anime available" />} keyed>
            {(data) => <>
              <HeroCarousel items={data.trending.media} />
              <section class="mt-[104px]" aria-labelledby="collection-heading">
                <SectionHeading id="collection-heading" title="Trending Anime" description="Popular series / real-time updates / useful details" />
                <div class="material-panel overflow-hidden">
                  <div class="flex min-h-[58px] flex-wrap items-center justify-between gap-4 border-b border-line px-5 py-3 sm:px-6">
                    <strong class="text-[13px] tracking-[-.02em]">Trending this week <span class="ml-2 font-mono text-[9px] font-normal uppercase tracking-[.08em] text-quiet">{collectionItems().length} anime</span></strong>
                    <div class="flex gap-[6px]" aria-label="Anime collection filter">
                      <CollectionFilterButton current={collectionFilter} setCurrent={setCollectionFilter} value="all" label="All" />
                      <CollectionFilterButton current={collectionFilter} setCurrent={setCollectionFilter} value="airing" label="Airing" />
                      <CollectionFilterButton current={collectionFilter} setCurrent={setCollectionFilter} value="rated" label="Top rated" />
                    </div>
                  </div>
                  <div class="grid grid-cols-1 divide-y divide-line md:grid-cols-2 md:[&>*:nth-child(odd)]:border-r md:[&>*:nth-child(odd)]:border-line">
                    <For each={collectionItems().slice(0, 12)}>{(anime, index) => <AnimeCard anime={anime} rank={index() + 1} />}</For>
                  </div>
                  <div class="border-t border-line px-6 py-4 text-right font-mono text-[9px] uppercase tracking-[.1em]">
                    <Link to="/explore" search={makeBrowseSearch({ sort: collectionFilter() === 'rated' ? 'SCORE_DESC' : collectionFilter() === 'airing' ? 'POPULARITY_DESC' : 'TRENDING_DESC', season: collectionFilter() === 'airing' ? season.season : undefined, year: collectionFilter() === 'airing' ? season.year : undefined })}>View all anime →</Link>
                  </div>
                </div>
              </section>
              <section class="home-deferred-section mt-[104px]" aria-labelledby="season-heading">
                <SectionHeading id="season-heading" title="Seasonal Anime" description="Popular now / all-time favorites / coming next" />
                <div class="grid gap-5 lg:grid-cols-3">
                  <AnimeColumn title="Trending now" items={data.trending.media} search={makeBrowseSearch({ sort: 'TRENDING_DESC' })} />
                  <AnimeColumn title="Popular this season" items={data.season.media} search={makeBrowseSearch({ sort: 'POPULARITY_DESC', season: season.season, year: season.year })} />
                  <AnimeColumn title="All-time favorites" items={data.allTime.media} search={makeBrowseSearch({ sort: 'POPULARITY_DESC' })} />
                </div>
                <div class="mt-5"><AnimeColumn title="Coming next season" items={data.upcoming.media} search={makeBrowseSearch({ sort: 'POPULARITY_DESC', status: 'NOT_YET_RELEASED', season: nextSeason.season, year: nextSeason.year })} /></div>
              </section>
              <section class="home-deferred-section mt-[104px]" aria-labelledby="genre-heading">
                <SectionHeading id="genre-heading" title="Browse by Genre" description="Find your next anime" />
                <GenreNav />
              </section>
            </>}
          </Show>
        </Show>
      </Show>
    </PageShell>
  )
}

function CollectionFilterButton(props: { current: () => CollectionFilter; setCurrent: (value: CollectionFilter) => void; value: CollectionFilter; label: string }) {
  return <button type="button" class="paper-control min-h-[30px] rounded-[6px] px-3 text-[8.5px]" classList={{ 'border-ink bg-ink text-white': props.current() === props.value }} aria-pressed={props.current() === props.value} onClick={() => props.setCurrent(props.value)}>{props.label}</button>
}

function AnimeColumn(props: { title: string; items: AniListMedia[]; search: ReturnType<typeof makeBrowseSearch> }) {
  return <section class="material-panel overflow-hidden"><div class="flex items-center justify-between border-b border-line px-4 py-3"><h3 class="text-sm font-bold">{props.title}</h3><Link class="font-mono text-[8px] uppercase tracking-[.1em]" to="/explore" search={props.search}>View all →</Link></div><div class="divide-y divide-line"><For each={props.items.slice(0, 3)}>{(anime, index) => <AnimeCard anime={anime} rank={index() + 1} />}</For></div></section>
}

function HomeLoading() {
  return <section class="grid min-h-[60vh] place-items-center" aria-busy="true"><p class="mono-signal">Loading anime discovery…</p></section>
}

function State(props: { title: string; copy?: string; action?: () => void }) {
  return <section class="material-panel mx-auto my-24 max-w-xl p-10 text-center"><h2 class="font-display text-4xl">{props.title}</h2><Show when={props.copy}><p class="mt-3 text-sm text-text-secondary">{props.copy}</p></Show><Show when={props.action}><button class="ink-control mt-6 px-5 py-3" type="button" onClick={() => props.action?.()}>Retry</button></Show></section>
}
