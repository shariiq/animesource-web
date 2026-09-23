/* eslint-disable solid/no-innerhtml -- renderDescription escapes AniList text before rendering it. */
import { createMemo, createSignal, For, onMount, Show } from 'solid-js'
import { Link, useNavigate } from '@tanstack/solid-router'
import type { AniListDetail } from '../../data/anilist/types'
import { catalogLibraryStatus, catalogStatus } from '../../lib/catalog'
import { makeBrowseSearch } from '../../lib/browse'
import { formatAniDate, formatCompactNumber, formatEnum, formatRank, formatScore, renderDescription, titleOf } from '../../lib/format'
import { FAVORITE_STATUSES } from '../../lib/library'
import type { FavoriteStatus } from '../../lib/persistence/schema'
import { viewerData } from '../../lib/persistence/active'
import { CharacterRail } from '../anime/detail/CharacterRail'
import { getDetailLinks, getDetailTags, getDetailTitles, getOrderedRelations, getSingleAnimeAdaptationRelation, getStaffMembers, isSafeExternalUrl } from '../anime/detail/model'
import { MediaRail, toRailItem } from '../anime/detail/MediaRail'
import { StaffRail } from '../anime/detail/StaffRail'
import { PageShell } from '../ui/PageShell'
import { SectionHeading } from '../ui/SectionHeading'
import { followCatalogModeRelation } from '../layout/followCatalogMode'

function formatUpdatedAt(value: number | null | undefined): string {
  if (!value) return ''
  const date = new Date(value * 1000)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
}

function MangaTagGroup(props: { heading: string; tags: ReturnType<typeof getDetailTags>['themes'] }) {
  return (
    <div>
      <p class="detail-kicker">AniList category</p>
      <h3 class="detail-subheading mt-1">{props.heading}</h3>
      <div class="mt-4 flex flex-wrap gap-2">
        <For each={props.tags}>
          {(tag) => <span class="detail-tag" title={tag.description ?? undefined}>{tag.name}<Show when={tag.rank != null}><small>{tag.rank}%</small></Show></span>}
        </For>
      </div>
    </div>
  )
}

export function MangaDetailPage(props: { manga: AniListDetail }) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = createSignal(false)
  const [favorite, setFavorite] = createSignal<boolean | undefined>(undefined)
  const [favoriteStatus, setFavoriteStatus] = createSignal<FavoriteStatus | undefined>(undefined)
  const [persistenceError, setPersistenceError] = createSignal<string | null>(null)
  const [savingFavorite, setSavingFavorite] = createSignal(false)
  const [savingStatus, setSavingStatus] = createSignal(false)

  onMount(() => {
    const mangaId = props.manga.id
    void viewerData.getFavorites()
      .then((items) => {
        const saved = items.find((item) => item.id === mangaId && (item.catalogMode ?? 'ANIME') === 'MANGA')
        setFavorite(Boolean(saved))
        setFavoriteStatus(saved?.status)
      })
      .catch(() => setPersistenceError('Your browser could not load saved favorites. Reload to try again.'))
  })

  const changeFavorite = async () => {
    if (favorite() === undefined || savingFavorite()) return
    setSavingFavorite(true)
    try {
      const manga = props.manga
      const nextFavorite = await viewerData.toggleFavorite({
        id: manga.id,
        catalogMode: 'MANGA',
        title: titleOf(manga),
        cover: manga.coverImage?.large || manga.coverImage?.extraLarge || '',
        format: manga.format ?? null,
        averageScore: manga.averageScore ?? null,
        status: 'PLANNING',
      })
      setFavorite(nextFavorite)
      setFavoriteStatus(nextFavorite ? 'PLANNING' : undefined)
      setPersistenceError(null)
    } catch {
      setPersistenceError('Your browser could not save this title.')
    } finally {
      setSavingFavorite(false)
    }
  }

  const changeFavoriteStatus = async (status: FavoriteStatus) => {
    if (!favorite() || savingStatus()) return
    setSavingStatus(true)
    try {
      await viewerData.updateFavoriteStatus(props.manga.id, status, 'MANGA')
      setFavoriteStatus(status)
      setPersistenceError(null)
    } catch {
      setPersistenceError('Your browser could not update the reading status.')
    } finally {
      setSavingStatus(false)
    }
  }

  const title = createMemo(() => titleOf(props.manga))
  const description = createMemo(() => renderDescription(props.manga.description))
  const poster = createMemo(() => props.manga.coverImage?.extraLarge || props.manga.coverImage?.large || '')
  const banner = createMemo(() => props.manga.bannerImage || '')
  const accent = createMemo(() => props.manga.coverImage?.color || '#7665e8')
  const titles = createMemo(() => getDetailTitles(props.manga))
  const detailTags = createMemo(() => getDetailTags(props.manga))
  const detailLinks = createMemo(() => getDetailLinks(props.manga))
  const staff = createMemo(() => getStaffMembers(props.manga))
  const genres = createMemo(() => (props.manga.genres ?? []).filter((genre): genre is string => Boolean(genre)))
  const relations = createMemo(() => getOrderedRelations(props.manga).map((relation) => ({
    id: relation.id,
    title: relation.title,
    cover: relation.cover,
    format: relation.format,
    score: relation.score,
    label: relation.label,
    type: relation.type,
    siteUrl: relation.siteUrl,
  })))
  const animeAdaptationRelation = createMemo(() => getSingleAnimeAdaptationRelation(props.manga))
  const recommendations = createMemo(() => (props.manga.recommendations?.nodes ?? [])
    .map((node) => toRailItem(node?.mediaRecommendation, 'Recommended'))
    .filter((item): item is NonNullable<typeof item> => item !== null))
  const facts = createMemo(() => [
    { label: 'Chapters', value: props.manga.chapters ? String(props.manga.chapters) : null, tone: 'violet' },
    { label: 'Volumes', value: props.manga.volumes ? String(props.manga.volumes) : null, tone: 'plum' },
    { label: 'Published', value: props.manga.startDate?.year ? `${formatAniDate(props.manga.startDate)}${props.manga.endDate?.year ? ` – ${formatAniDate(props.manga.endDate)}` : ''}` : null, tone: 'mint' },
    { label: 'Updated', value: formatUpdatedAt(props.manga.updatedAt), tone: 'acid' },
    { label: 'Mean score', value: props.manga.meanScore != null ? formatScore(props.manga.meanScore) : null, tone: 'orange' },
    { label: 'Favorites', value: props.manga.favourites != null ? formatCompactNumber(props.manga.favourites) : null, tone: 'violet' },
    { label: 'Origin', value: props.manga.countryOfOrigin, tone: 'mint' },
    { label: 'Rank', value: props.manga.rankings?.[0]?.rank ? formatRank(props.manga.rankings[0].rank) : null, tone: 'plum' },
  ].filter((fact): fact is { label: string; value: string; tone: string } => Boolean(fact.value)))

  followCatalogModeRelation({
    currentMode: 'MANGA',
    currentId: () => props.manga.id,
    targetMode: 'ANIME',
    relationId: animeAdaptationRelation,
    follow: (animeId) => {
      void navigate({ to: '/anime/$animeId', params: { animeId: String(animeId) } })
    },
  })

  return (
    <PageShell>
      <section aria-labelledby="manga-title">
        <SectionHeading title="Manga Details" description="AniList metadata / publication history / reading status" />
        <article class="manga-detail-shell" style={{ '--manga-accent': accent() }}>
          <Show when={banner()}>
            <div class="manga-detail-banner" style={{ 'background-image': `url("${banner().replaceAll('"', '%22')}")` }} aria-hidden="true" />
          </Show>
          <div class="manga-detail-toolbar">
            <Link class="manga-back-link" to="/">← Back to manga</Link>
            <span class="manga-detail-signal"><i aria-hidden="true" />{catalogStatus('MANGA', props.manga.status) || 'Catalog'} · {formatEnum(props.manga.format) || 'Manga'}</span>
          </div>

          <div class="manga-detail-grid">
            <div class="manga-cover-column">
              <figure class="manga-book">
                <div class="manga-book-art">
                  <Show when={poster()} fallback={<div class="manga-cover-placeholder" aria-label="Cover unavailable">MANGA</div>}>
                    <img src={poster()} alt={`${title()} cover`} loading="eager" fetchpriority="high" decoding="async" />
                  </Show>
                </div>
                <figcaption class="manga-book-caption"><span>ANILIST / {props.manga.id}</span><b>{formatEnum(props.manga.format) || 'MANGA'}</b></figcaption>
              </figure>
              <button
                class="ink-control manga-save-control"
                type="button"
                aria-label={favorite() ? 'Remove manga from favorites' : 'Add manga to favorites'}
                aria-pressed={favorite()}
                disabled={favorite() === undefined || savingFavorite()}
                aria-busy={savingFavorite()}
                onClick={changeFavorite}
              >
                {favorite() ? '♥ Saved to shelf' : '♡ Save to shelf'}
              </button>
              <Show when={favorite()}>
                <div class="manga-shelf-panel" aria-busy={savingStatus()}>
                  <div class="manga-shelf-heading"><span class="detail-kicker">Your shelf</span><strong>{catalogLibraryStatus('MANGA', favoriteStatus() ?? 'PLANNING')}</strong></div>
                  <label class="editorial-field-group">
                    <span class="editorial-label">Reading status</span>
                    <select class="editorial-field w-full px-3 text-sm font-semibold" value={favoriteStatus() ?? 'PLANNING'} disabled={savingStatus() || savingFavorite()} onChange={(event) => { void changeFavoriteStatus(event.currentTarget.value as FavoriteStatus) }}>
                      <For each={FAVORITE_STATUSES}>{(status) => <option value={status}>{catalogLibraryStatus('MANGA', status)}</option>}</For>
                    </select>
                  </label>
                </div>
              </Show>
            </div>

            <div class="manga-story-column">
              <p class="manga-detail-overline">MANGA / DETAILS</p>
              <h1 id="manga-title" class="manga-detail-title">{title()}</h1>
              <Show when={props.manga.title?.native && props.manga.title.native !== title()}>
                <p class="manga-native-title">{props.manga.title?.native}</p>
              </Show>
              <div class="manga-chip-row">
                <Show when={props.manga.averageScore != null}><span class="manga-chip manga-chip-violet">★ {formatScore(props.manga.averageScore!)}</span></Show>
                <Show when={props.manga.status}><span class="manga-chip manga-chip-mint"><i aria-hidden="true" />{catalogStatus('MANGA', props.manga.status)}</span></Show>
                <Show when={props.manga.format}><span class="manga-chip">{formatEnum(props.manga.format)}</span></Show>
              </div>

              <Show when={titles().length > 0}>
                <div class="manga-alternate-titles">
                  <span class="detail-kicker">Other editions</span>
                  <For each={titles().slice(0, 4)}>{(item) => <span><b>{item.label}</b>{item.value}</span>}</For>
                </div>
              </Show>

              <Show when={description()}>
                <section class="manga-synopsis" aria-labelledby="manga-synopsis-heading">
                  <div class="manga-synopsis-heading"><p id="manga-synopsis-heading" class="detail-kicker">Synopsis</p><span>ANILIST TEXT</span></div>
                  <div class="manga-synopsis-copy" classList={{ 'line-clamp-6': !expanded() }} innerHTML={description()} />
                  <button class="manga-read-toggle" type="button" onClick={() => setExpanded((value) => !value)}>{expanded() ? 'Show less' : 'Read full synopsis'} <span aria-hidden="true">↗</span></button>
                </section>
              </Show>

              <div class="manga-detail-actions">
                <Link class="ink-control inline-flex" to="/manga/$mangaId/read/$chapterNumber" params={{ mangaId: String(props.manga.id), chapterNumber: 'start' }}>Open reader →</Link>
                <Show when={props.manga.siteUrl && isSafeExternalUrl(props.manga.siteUrl)}>
                  <a class="ink-control inline-flex" href={props.manga.siteUrl!} target="_blank" rel="noopener noreferrer">Open AniList ↗</a>
                </Show>
                <Show when={genres()[0]} keyed>
                  {(genre) => <Link class="paper-control inline-flex" to="/explore" search={makeBrowseSearch({ genre, format: 'MANGA' })}>Explore {genre} →</Link>}
                </Show>
              </div>
              <Show when={persistenceError()}>{(message) => <p class="mt-3 text-xs text-red-700" role="alert">{message()}</p>}</Show>

              <Show when={genres().length > 0}>
                <div class="manga-genre-list" aria-label="Genres">
                  <span class="detail-kicker">Genres</span>
                  <For each={genres()}>{(genre) => <Link to="/explore" search={makeBrowseSearch({ genre, format: 'MANGA' })}>{genre}</Link>}</For>
                </div>
              </Show>
            </div>

            <aside class="manga-fact-panel" aria-label="Manga information">
              <div class="manga-fact-heading"><p class="detail-kicker">Manga information</p><span>{props.manga.countryOfOrigin || 'GLOBAL'}</span></div>
              <div class="manga-fact-list">
                <For each={facts()}>{(fact) => <div class="manga-fact-row"><span><i class={`manga-fact-marker manga-fact-${fact.tone}`} aria-hidden="true" />{fact.label}</span><strong>{fact.value}</strong></div>}</For>
              </div>
              <div class="manga-fact-note"><i aria-hidden="true" /><p>Publication counts and dates are supplied by AniList and may change as chapters are catalogued.</p></div>
            </aside>
          </div>
        </article>
      </section>

      <Show when={detailTags().themes.length > 0 || detailTags().tags.length > 0}>
        <section class="detail-section" aria-labelledby="manga-themes-tags-heading">
          <div class="detail-section-heading"><h2 id="manga-themes-tags-heading">Themes & tags</h2><p>Informative AniList metadata</p></div>
          <div class="detail-panel grid gap-5 p-5 sm:grid-cols-2">
            <Show when={detailTags().themes.length > 0}><MangaTagGroup heading="Themes" tags={detailTags().themes} /></Show>
            <Show when={detailTags().tags.length > 0}><MangaTagGroup heading="Tags" tags={detailTags().tags} /></Show>
          </div>
        </section>
      </Show>

      <Show when={detailLinks().length > 0}>
        <section class="detail-section" aria-labelledby="manga-external-links-heading">
          <div class="detail-section-heading"><h2 id="manga-external-links-heading">External links</h2><p>Verified resources from AniList</p></div>
          <div class="detail-panel grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <For each={detailLinks()}>{(link) => <a class="detail-resource" href={link.url} target="_blank" rel="noopener noreferrer"><div><strong>{link.site}</strong><span>{[link.type ? formatEnum(link.type) : null, link.language].filter(Boolean).join(' · ') || 'External resource'}</span></div></a>}</For>
          </div>
        </section>
      </Show>

      <StaffRail members={staff()} heading="Creators & staff" description="Writers, artists, and contributors" />
      <CharacterRail detail={props.manga} mode="MANGA" />
      <MediaRail heading="Relations" items={relations()} />
      <MediaRail heading="You may also like" items={recommendations()} />
    </PageShell>
  )
}
