/* eslint-disable solid/no-innerhtml -- renderDescription sanitizes and escapes AniList text before this component renders it. */
import { createMemo, createSignal, For, onMount, Show } from 'solid-js'
import type { JSX } from 'solid-js'
import { Link, useNavigate } from '@tanstack/solid-router'
import type { AniListDetail } from '../../data/anilist/types'
import { formatAniDate, formatCompactNumber, formatEnum, formatRank, formatScore, formatSeason, formatStatus, renderDescription, titleOf } from '../../lib/format'
import { BROWSE_SEASONS, makeBrowseSearch, type BrowseSeason } from '../../lib/browse'
import { FAVORITE_STATUSES } from '../../lib/library'
import type { FavoriteStatus } from '../../lib/persistence/schema'
import { viewerData } from '../../lib/persistence/active'
import { CharacterRail } from './detail/CharacterRail'
import { getDetailLinks, getDetailTags, getDetailTitles, getOrderedRelations, getSingleMangaSourceRelation, getStaffMembers, getStudios, isSafeExternalUrl } from './detail/model'
import { MediaRail, toRailItem } from './detail/MediaRail'
import { StaffRail } from './detail/StaffRail'
import { Trailer } from './detail/Trailer'
import { PageShell } from '../ui/PageShell'
import { SectionHeading } from '../ui/SectionHeading'
import { followCatalogModeRelation } from '../layout/followCatalogMode'

function MetadataPill(props: { children: JSX.Element; accent?: boolean }) {
  return <span class={props.accent ? 'rounded-lg bg-emerald/12 px-3 py-2 text-emerald' : 'rounded-lg border border-black/12 bg-white/60 px-3 py-2'}>{props.children}</span>
}

function TagGroup(props: { heading: string; tags: ReturnType<typeof getDetailTags>['themes'] }) {
  return <div>
    <h3 class="detail-subheading mt-1">{props.heading}</h3>
    <div class="mt-4 flex flex-wrap gap-2">
      <For each={props.tags}>
        {(tag) => <span class="detail-tag" title={tag.description ?? undefined}>
          {tag.name}
          <Show when={tag.rank != null}><small>{tag.rank}%</small></Show>
        </span>}
      </For>
    </div>
  </div>
}

export function AnimeDetailPage(props: { anime: AniListDetail }) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = createSignal(false)
  const [favorite, setFavorite] = createSignal<boolean | undefined>(undefined)
  const [favoriteStatus, setFavoriteStatus] = createSignal<FavoriteStatus | undefined>(undefined)
  const [persistenceError, setPersistenceError] = createSignal<string | null>(null)
  const [savingFavorite, setSavingFavorite] = createSignal(false)
  const [savingStatus, setSavingStatus] = createSignal(false)

  onMount(() => {
    const animeId = props.anime.id
    void viewerData.getFavorites()
      .then((items) => {
        const saved = items.find((item) => item.id === animeId && (item.catalogMode ?? 'ANIME') === 'ANIME')
        setFavorite(Boolean(saved))
        setFavoriteStatus(saved?.status)
      })
      .catch(() => setPersistenceError('Your browser could not load saved favorites. Reload to try again.'))
  })

  const changeFavorite = async () => {
    if (favorite() === undefined || savingFavorite()) return
    setSavingFavorite(true)
    try {
      const anime = props.anime
      const nextFavorite = await viewerData.toggleFavorite({
        id: anime.id,
        catalogMode: 'ANIME',
        title: titleOf(anime),
        cover: anime.coverImage?.large || anime.coverImage?.extraLarge || '',
        format: anime.format ?? null,
        averageScore: anime.averageScore ?? null,
        status: 'PLANNING',
      })
      setFavorite(nextFavorite)
      setFavoriteStatus(nextFavorite ? 'PLANNING' : undefined)
      setPersistenceError(null)
    } catch {
      setPersistenceError('Your browser could not save this favorite.')
    } finally {
      setSavingFavorite(false)
    }
  }

  const changeFavoriteStatus = async (status: FavoriteStatus) => {
    if (!favorite() || savingStatus()) return
    setSavingStatus(true)
    try {
      await viewerData.updateFavoriteStatus(props.anime.id, status, 'ANIME')
      setFavoriteStatus(status)
      setPersistenceError(null)
    } catch {
      setPersistenceError('Your browser could not update the library status.')
    } finally {
      setSavingStatus(false)
    }
  }

  const description = createMemo(() => renderDescription(props.anime.description))
  const poster = createMemo(() => props.anime.coverImage?.extraLarge || props.anime.coverImage?.large || '')
  const banner = createMemo(() => props.anime.bannerImage || poster())
  const accent = createMemo(() => props.anime.coverImage?.color || '#7665e8')
  const titles = createMemo(() => getDetailTitles(props.anime))
  const studios = createMemo(() => getStudios(props.anime))
  const staff = createMemo(() => getStaffMembers(props.anime))
  const detailTags = createMemo(() => getDetailTags(props.anime))
  const detailLinks = createMemo(() => getDetailLinks(props.anime))
  const rankings = createMemo(() => (props.anime.rankings ?? []).slice(0, 3))
  const relations = createMemo(() => getOrderedRelations(props.anime))
  const mangaSourceRelation = createMemo(() => getSingleMangaSourceRelation(props.anime))
  const recommendations = createMemo(() => (props.anime.recommendations?.nodes ?? [])
    .map((node) => toRailItem(node?.mediaRecommendation, 'Recommended'))
    .filter((item): item is NonNullable<typeof item> => item !== null))
  const genres = createMemo(() => (props.anime.genres ?? []).filter((genre): genre is string => Boolean(genre)))
  const season = createMemo(() => props.anime.season && props.anime.seasonYear && BROWSE_SEASONS.includes(props.anime.season as BrowseSeason)
    ? makeBrowseSearch({ season: props.anime.season as BrowseSeason, year: props.anime.seasonYear })
    : null)
  const facts = createMemo(() => [
    { label: 'Source', value: props.anime.source ? formatEnum(props.anime.source) : null },
    { label: 'Origin', value: props.anime.countryOfOrigin },
    { label: 'Aired', value: props.anime.startDate?.year ? `${formatAniDate(props.anime.startDate)}${props.anime.endDate?.year ? ` – ${formatAniDate(props.anime.endDate)}` : ''}` : null },
    { label: 'Mean score', value: props.anime.meanScore != null ? formatScore(props.anime.meanScore) : null },
    { label: 'Audience', value: props.anime.popularity != null ? formatCompactNumber(props.anime.popularity) : null },
    { label: 'Favorites', value: props.anime.favourites != null ? formatCompactNumber(props.anime.favourites) : null },
    { label: 'Trending', value: props.anime.trending != null ? formatCompactNumber(props.anime.trending) : null },
  ].filter((fact): fact is { label: string; value: string } => Boolean(fact.value)))

  followCatalogModeRelation({
    currentMode: 'ANIME',
    currentId: () => props.anime.id,
    targetMode: 'MANGA',
    relationId: mangaSourceRelation,
    follow: (mangaId) => {
      void navigate({ to: '/manga/$mangaId', params: { mangaId: String(mangaId) } })
    },
  })

  const relationItems = createMemo(() => relations().map((relation) => ({
    id: relation.id,
    title: relation.title,
    cover: relation.cover,
    format: relation.format,
    score: relation.score,
    label: relation.label,
    type: relation.type,
    siteUrl: relation.siteUrl,
  })))

  return (
    <PageShell>
      <section aria-labelledby="anime-title">
        <SectionHeading title="Anime Details" />
        <article class="relative isolate overflow-hidden rounded-[26px] border border-black/10 bg-[#fcfcfd] shadow-glass" style={{ '--accent': accent() }}>
          <Show when={banner()}>
            <div
              class="absolute inset-x-0 top-0 h-[300px] bg-cover bg-[center_28%] opacity-80 [mask-image:linear-gradient(180deg,black_0%,black_46%,transparent_96%)] sm:h-[430px]"
              style={{ 'background-image': `url("${banner()?.replaceAll('"', '%22')}")` }}
              aria-hidden="true"
            />
          </Show>
          <div
            class="absolute inset-x-0 top-0 h-[300px] opacity-60 sm:h-[430px]"
            style={{ background: `linear-gradient(180deg, color-mix(in srgb, var(--accent) 34%, transparent), transparent 70%)` }}
            aria-hidden="true"
          />
          <div class="absolute inset-x-0 top-0 h-[300px] bg-[linear-gradient(90deg,rgb(255_255_255_/_0.92),rgb(250_250_253_/_0.5),rgb(250_250_253_/_0.1)),linear-gradient(0deg,rgb(250_250_253)_4%,transparent_100%)] sm:h-[430px]" aria-hidden="true" />
          {/* Mobile-only top wash: narrow viewports lose the horizontal fade's
              protection on the right side, so toolbar text needs its own cover. */}
          <div class="absolute inset-x-0 top-0 h-[300px] bg-[linear-gradient(180deg,rgb(250_250_253_/_0.8),transparent_55%)] sm:hidden" aria-hidden="true" />
          <div class="relative z-10 flex flex-wrap justify-between gap-x-4 gap-y-1 border-b border-white/50 px-4 py-4 font-mono text-[9px] uppercase tracking-[.1em] text-[#42404b] sm:px-6">
            <Link class="hover:text-black" to="/">← Back to discovery</Link>
            <span>{formatStatus(props.anime.status) || 'Catalog'} · {formatEnum(props.anime.format) || 'Anime'}</span>
          </div>

          <div class="anime-detail-grid relative z-10 grid gap-6 px-4 pb-9 pt-8 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)_300px] lg:px-8">
            <div class="anime-detail-poster-column mx-auto w-full max-w-[300px] lg:mx-0 lg:max-w-none">
              <div class="overflow-hidden rounded-[15px] border border-white/70 bg-black/10 shadow-[0_22px_45px_rgb(0_0_0/.18)] ring-1 ring-black/5">
                <Show when={poster()} fallback={<div class="aspect-[2/3] bg-black/10" />}>
                  <img class="aspect-[2/3] w-full object-cover transition-transform duration-500 ease-fluid hover:scale-[1.03]" src={poster()} alt={`${titleOf(props.anime)} poster`} loading="eager" fetchpriority="high" decoding="async" />
                </Show>
              </div>
              <button
                class="paper-control mt-3 w-full px-4 py-3 hover:border-black hover:bg-black hover:text-white"
                type="button"
                aria-label={favorite() ? 'Remove from favorites' : 'Add to favorites'}
                aria-pressed={favorite()}
                disabled={favorite() === undefined || savingFavorite()}
                aria-busy={savingFavorite()}
                onClick={changeFavorite}
              >
                {favorite() ? '♥ Saved to favorites' : '♡ Add to favorites'}
              </button>
              <Show when={favorite()}>
                <div class="material-panel mt-3 min-w-0 p-5" aria-busy={savingStatus()}>
                  <div class="mb-4 flex min-w-0 items-baseline justify-between gap-3">
                    <p class="mono-signal font-semibold text-text-primary">In your library</p>
                    <span class="truncate text-xs font-bold text-text-primary">{formatEnum(favoriteStatus() ?? 'PLANNING')}</span>
                  </div>
                  <label class="editorial-field-group min-w-0">
                    <span class="editorial-label">Library status</span>
                    <select
                      class="editorial-field min-w-0 w-full px-3 text-sm font-semibold"
                      value={favoriteStatus() ?? 'PLANNING'}
                      disabled={savingStatus() || savingFavorite()}
                      onChange={(e) => { void changeFavoriteStatus(e.currentTarget.value as FavoriteStatus) }}
                    >
                      <For each={FAVORITE_STATUSES}>{(s) => <option value={s}>{formatEnum(s)}</option>}</For>
                    </select>
                  </label>
                </div>
              </Show>
            </div>

            <div class="anime-detail-story pt-2">
              <Show when={season()} fallback={<p class="font-mono text-[9px] uppercase tracking-[.14em] text-[#4f4e57]">Anime catalog</p>}>
                {(browse) => <Link class="font-mono text-[9px] uppercase tracking-[.14em] text-[#4f4e57] underline decoration-black/20 underline-offset-4 hover:text-black" to="/explore" search={browse()}>{formatSeason(props.anime.season)} {props.anime.seasonYear}</Link>}
              </Show>
              <h1 id="anime-title" class="mt-3 break-words font-display text-[clamp(40px,11vw,88px)] leading-[.86] tracking-[-.055em] sm:leading-[.82]">{titleOf(props.anime)}</h1>
              <Show when={props.anime.siteUrl && isSafeExternalUrl(props.anime.siteUrl)}>
                <a class="mt-4 inline-flex font-mono text-[9px] uppercase tracking-[.1em] underline decoration-black/25 underline-offset-4 hover:text-violet" href={props.anime.siteUrl!} target="_blank" rel="noopener noreferrer">View on AniList ↗</a>
              </Show>

              <Show when={titles().length > 0}>
                <div class="mt-5 rounded-xl border border-black/8 bg-white/45 p-4">
                  <p class="font-mono text-[9px] uppercase tracking-[.12em] text-[#4f4e57]">Also known as</p>
                  <dl class="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                    <For each={titles()}>
                      {(title) => <div><dt class="font-mono text-[8px] uppercase tracking-[.08em] text-text-quiet">{title.label}</dt><dd class="mt-0.5 break-words">{title.value}</dd></div>}
                    </For>
                  </dl>
                </div>
              </Show>

              <div class="mt-6 flex flex-wrap gap-2 font-mono text-[9px] uppercase tracking-[.08em]">
                <Show when={props.anime.averageScore != null}><MetadataPill accent>★ {formatScore(props.anime.averageScore!)}</MetadataPill></Show>
                <Show when={props.anime.status}><MetadataPill>{formatStatus(props.anime.status)}</MetadataPill></Show>
                <Show when={props.anime.episodes != null}><MetadataPill>{props.anime.episodes} episodes</MetadataPill></Show>
                <Show when={props.anime.duration != null}><MetadataPill>{props.anime.duration} min</MetadataPill></Show>
              </div>

              <Show when={description()}>
                <div class="mt-7 max-w-2xl text-sm leading-7 text-[#42404b]" classList={{ 'line-clamp-5': !expanded() }} innerHTML={description()} />
                <button class="mt-3 font-mono text-[9px] uppercase tracking-[.1em] underline underline-offset-4" type="button" onClick={() => setExpanded((value) => !value)}>{expanded() ? 'Show less' : 'Read more'}</button>
              </Show>

              <div class="mt-7">
                <Link class="ink-control inline-flex min-h-[50px] items-center gap-[10px] px-6 py-3 text-[11px]" to="/anime/$animeId/watch/$episodeId" params={{ animeId: String(props.anime.id), episodeId: 'next' }}>▶ Watch now</Link>
              </div>
              <Show when={persistenceError()}>{(message) => <p class="mt-3 text-xs text-red-700" role="alert">{message()}</p>}</Show>

              <Show when={genres().length > 0}>
                <div class="mt-7 flex flex-wrap gap-2" aria-label="Genres">
                  <For each={genres()}>{(genre) => <Link class="rounded-full border border-black/12 bg-white/55 px-3 py-1.5 text-xs transition-[background,border-color,color,transform] duration-200 hover:-translate-y-px hover:border-ink hover:bg-ink hover:text-white focus-visible:border-ink focus-visible:bg-ink focus-visible:text-white" to="/explore" search={makeBrowseSearch({ genre })}>{genre}</Link>}</For>
                </div>
              </Show>
            </div>

            <aside class="anime-detail-facts self-start rounded-[18px] border border-white/70 bg-white/68 p-5 backdrop-blur-xl">
              <p class="font-mono text-[9px] uppercase tracking-[.14em] text-[#4f4e57]">Anime information</p>
              <div class="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-1">
                <Show when={studios().length > 0}>
                  <div class="rounded-xl border border-black/8 bg-white/58 p-3">
                    <small class="block font-mono text-[8px] uppercase tracking-[.1em] text-[#4f4e57]">Studios & producers</small>
                    <div class="mt-1 grid gap-1 text-xs leading-5">
                      <For each={studios()}>
                        {(studio) => <Show when={studio.siteUrl} fallback={<span>{studio.name}{studio.isAnimationStudio ? ' · Animation' : ' · Producer'}</span>} keyed>{(href) => <a class="underline decoration-black/20 underline-offset-2 hover:text-violet" href={href} target="_blank" rel="noopener noreferrer">{studio.name}{studio.isAnimationStudio ? ' · Animation' : ' · Producer'}</a>}</Show>}
                      </For>
                    </div>
                  </div>
                </Show>
                <For each={facts()}>{(fact) => <div class="rounded-xl border border-black/8 bg-white/58 p-3"><small class="block font-mono text-[8px] uppercase tracking-[.1em] text-[#4f4e57]">{fact.label}</small><strong class="mt-1 block text-xs leading-5">{fact.value}</strong></div>}</For>
              </div>
              <Show when={rankings().length > 0}>
                <div class="mt-4 border-t border-black/10 pt-4">
                  <For each={rankings()}>{(ranking) => <div class="mb-2 flex justify-between font-mono text-[9px] uppercase tracking-[.08em]"><span>{ranking.context ?? 'AniList ranking'}</span><b>{formatRank(ranking.rank)}</b></div>}</For>
                </div>
              </Show>
            </aside>
          </div>
        </article>
      </section>

      <Show when={detailTags().themes.length > 0 || detailTags().tags.length > 0}>
        <section class="detail-section" aria-labelledby="themes-tags-heading">
          <div class="detail-section-heading">
            <h2 id="themes-tags-heading">Themes & tags</h2>
          </div>
          <div class="detail-panel grid gap-5 p-5 sm:grid-cols-2">
            <Show when={detailTags().themes.length > 0}>
              <TagGroup heading="Themes" tags={detailTags().themes} />
            </Show>
            <Show when={detailTags().tags.length > 0}>
              <TagGroup heading="Tags" tags={detailTags().tags} />
            </Show>
          </div>
        </section>
      </Show>

      <Show when={detailLinks().length > 0}>
        <section class="detail-section" aria-labelledby="external-links-heading">
          <div class="detail-section-heading">
            <h2 id="external-links-heading">External links</h2>
          </div>
          <div class="detail-panel grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <For each={detailLinks()}>
              {(link) => <a class="detail-resource" href={link.url} target="_blank" rel="noopener noreferrer"><div><strong>{link.site}</strong><span>{[link.type ? formatEnum(link.type) : null, link.language].filter(Boolean).join(' · ') || 'External resource'}</span></div></a>}
            </For>
          </div>
        </section>
      </Show>

      <Trailer trailer={props.anime.trailer} />
      <StaffRail members={staff()} />
      <CharacterRail detail={props.anime} />
      <MediaRail heading="Relations" items={relationItems()} />
      <MediaRail heading="You may also like" items={recommendations()} />
    </PageShell>
  )
}
