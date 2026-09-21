import { createMemo, createSignal, onCleanup, onMount, For, Show } from 'solid-js'
import { Link } from '@tanstack/solid-router'
import type { AniListMedia } from '../../data/anilist/types'
import { formatCompactNumber, formatEnum, formatScore, titleOf } from '../../lib/format'
import { catalogCopy, catalogCountLabel, catalogFormat, catalogStatus, type CatalogMode } from '../../lib/catalog'
import { SectionHeading } from '../ui/SectionHeading'
import { CatalogLink } from './CatalogLink'

const SLIDE_INTERVAL_MS = 7000
const MAX_SLIDES = 6

export function HeroCarousel(props: { items: AniListMedia[]; mode?: CatalogMode }) {
  const mode = () => props.mode ?? 'ANIME'
  const copy = () => catalogCopy[mode()]
  const slides = () => props.items.filter((media) => media.bannerImage || media.coverImage?.extraLarge).slice(0, MAX_SLIDES)
  const [activeIndex, setActiveIndex] = createSignal(0)
  const [paused, setPaused] = createSignal(false)
  const active = createMemo(() => {
    const list = slides()
    return list.length ? list[activeIndex() % list.length] : undefined
  })
  const accent = () => active()?.coverImage?.color ?? '#6a5af9'
  const titleParts = createMemo(() => {
    const title = titleOf(active())
    const match = title.match(/^(.+?)(\s*[:—-]\s*)(.+)$/)
    return match ? { lead: match[1], separator: match[2], accent: match[3] } : { lead: title, separator: '', accent: '' }
  })
  const metaLine = createMemo(() => [
    catalogFormat(mode(), active() ?? null),
    active()?.status ? catalogStatus(mode(), active()?.status) : null,
  ].filter(Boolean).join(' · '))
  const facts = createMemo(() => {
    const media = active()
    if (!media) return []

    return [
      media.popularity ? { label: 'Popularity', value: `${formatCompactNumber(media.popularity)} viewers` } : null,
      media.favourites ? { label: 'Favorites', value: formatCompactNumber(media.favourites) } : null,
      media.countryOfOrigin || media.format
        ? { label: 'Origin', value: [media.countryOfOrigin, media.format ? formatEnum(media.format) : null].filter(Boolean).join(' · ') }
        : null,
      catalogCountLabel(mode(), media) ? { label: copy().countFactLabel, value: catalogCountLabel(mode(), media) } : null,
    ].filter((fact): fact is { label: string; value: string } => fact !== null)
  })
  let timer: ReturnType<typeof setInterval> | undefined

  const restart = () => {
    clearInterval(timer)
    timer = setInterval(() => {
      if (!paused() && slides().length > 1) setActiveIndex((index) => (index + 1) % slides().length)
    }, SLIDE_INTERVAL_MS)
  }
  const image = (media: AniListMedia) => media.bannerImage || media.coverImage?.extraLarge || ''
  const go = (index: number) => {
    if (slides().length) setActiveIndex(index % slides().length)
  }

  onMount(restart)
  onCleanup(() => clearInterval(timer))

  return (
    <Show when={slides().length > 0}>
      <section class="featured-section relative" aria-labelledby="featured-heading" style={{ '--accent': accent() }}>
        <SectionHeading
          id="featured-heading"
          title={copy().featuredTitle}
          description={copy().featuredDescription}
        />
        <div class="hero-ambient" aria-hidden="true" />
        <article
          class="hero-shell featured-shell relative isolate"
          aria-roledescription="carousel"
          aria-label={`Featured ${mode().toLowerCase()}`}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <div class="featured-artwork absolute inset-0 overflow-hidden bg-[#0a0a0f]" aria-hidden="true">
            <For each={slides()}>
              {(media, index) => (
                <img
                  class="featured-artwork-image absolute inset-0 h-full w-full object-cover object-[70%_22%] transition-[opacity,transform] duration-700 ease-fluid"
                  classList={{ 'opacity-100': index() === activeIndex(), 'opacity-0': index() !== activeIndex() }}
                  src={image(media)}
                  alt=""
                  loading={index() === activeIndex() ? 'eager' : 'lazy'}
                  fetchpriority={index() === activeIndex() ? 'high' : 'low'}
                  decoding="async"
                />
              )}
            </For>
            <div class="featured-contrast" />
          </div>

          <div class="relative z-10 flex min-h-[54px] items-center justify-between gap-4 border-b border-white/12 bg-black/28 px-6 font-mono text-[9px] uppercase tracking-[.12em] text-white/78 backdrop-blur-[14px] sm:px-8">
            <div class="flex items-center gap-[10px]">
              <i class="size-[6px] rounded-full bg-emerald shadow-[0_0_10px_rgb(0_200_83_/_0.7)]" />
              <span>{copy().collectionPulse}</span>
            </div>
            <div class="flex items-center gap-[6px]" role="tablist" aria-label={`Featured ${mode().toLowerCase()}`}>
              <span class="hidden sm:inline">Featured:</span>
              <For each={slides()}>
                {(media, index) => (
                  <button
                    type="button"
                    class="grid h-[28px] min-w-[32px] place-items-center rounded-[8px] border border-white/18 bg-white/12 px-[8px] font-mono text-[9px] font-semibold text-white/78 backdrop-blur-[10px] transition-[background,border-color,color,transform] duration-200 hover:-translate-y-px hover:bg-white/24 hover:text-white"
                    classList={{ 'border-white bg-white text-ink shadow-[0_4px_12px_rgb(0_0_0_/_0.3)] hover:bg-white hover:text-ink': index() === activeIndex() }}
                    role="tab"
                    aria-selected={index() === activeIndex()}
                    aria-label={`Show ${titleOf(media)}`}
                    onClick={() => {
                      go(index())
                      restart()
                    }}
                  >
                    {String(index() + 1).padStart(2, '0')}
                  </button>
                )}
              </For>
            </div>
          </div>

          <div class="relative z-10 grid min-h-[460px] gap-6 px-5 pb-7 pt-5 sm:min-h-[560px] sm:px-6 sm:pb-9 sm:pt-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,.85fr)] lg:px-8">
            <div class="flex min-w-0 flex-col justify-end pb-3 lg:pr-3">
              <p class="mb-3 flex flex-wrap items-center gap-x-[10px] gap-y-[7px] font-mono text-[10px] font-semibold uppercase tracking-[.12em] text-white/82">
                <span class="rounded-[5px] bg-violet px-[8px] py-[3px] text-white shadow-[0_2px_12px_rgb(106_90_249_/_0.55)]">
                  #{String(activeIndex() + 1).padStart(2, '0')} trending
                </span>
                <Show when={metaLine()}><span>{metaLine()}</span></Show>
              </p>
              <h2 class="max-w-[1000px] text-balance font-display text-[clamp(42px,12vw,108px)] leading-[.84] tracking-[-.055em] text-white [text-shadow:0_2px_34px_rgb(0_0_0_/_0.45)] sm:text-[clamp(54px,7vw,108px)]" aria-label={titleOf(active())}>
                <span>{titleParts().lead}</span>
                <Show when={titleParts().accent}>
                  <span class="italic text-mint">{titleParts().separator}{titleParts().accent}</span>
                </Show>
              </h2>
              <Show when={active()?.title?.native && active()?.title?.native !== titleOf(active())}>
                <p class="mt-[10px] text-[11.5px] tracking-[.02em] text-white/64">{active()?.title?.native}</p>
              </Show>
              <Show when={(active()?.genres ?? []).filter(Boolean).length}>
                <p class="mt-[22px] max-w-[62ch] font-mono text-[10px] font-medium uppercase tracking-[.12em] text-white/72">
                  {(active()?.genres ?? []).filter(Boolean).slice(0, 3).join(' · ')}
                </p>
              </Show>
              <div class="mt-8 flex flex-wrap items-center gap-3">
                <Show when={active()} keyed>
                  {(media) => (
                    <Show
                      when={mode() === 'ANIME'}
                      fallback={<CatalogLink media={media} mode={mode()} class="inline-flex min-h-[48px] w-full items-center justify-center gap-[10px] rounded-[11px] border border-white/60 bg-white px-[26px] font-mono text-[11px] font-bold normal-case tracking-normal text-ink shadow-[0_14px_34px_rgb(0_0_0_/_0.34),inset_0_1px_rgb(255_255_255_/_0.9)] transition-[background,box-shadow,transform] duration-200 hover:-translate-y-[2px] hover:shadow-[0_22px_44px_rgb(0_0_0_/_0.42),inset_0_1px_white] sm:w-auto">{copy().heroPrimary}</CatalogLink>}
                    >
                      <Link
                        class="inline-flex min-h-[48px] w-full items-center justify-center gap-[10px] rounded-[11px] border border-white/60 bg-white px-[26px] font-mono text-[11px] font-bold normal-case tracking-normal text-ink shadow-[0_14px_34px_rgb(0_0_0_/_0.34),inset_0_1px_rgb(255_255_255_/_0.9)] transition-[background,box-shadow,transform] duration-200 hover:-translate-y-[2px] hover:shadow-[0_22px_44px_rgb(0_0_0_/_0.42),inset_0_1px_white] sm:w-auto"
                        to="/anime/$animeId/watch/$episodeId"
                        params={{ animeId: String(media.id), episodeId: 'next' }}
                      >
                        ▶ {copy().heroPrimary}
                      </Link>
                    </Show>
                  )}
                </Show>
                <Show when={active()} keyed>
                  {(media) => (
                    <Show when={mode() === 'ANIME'}>
                      <CatalogLink media={media} mode={mode()} class="paper-control inline-flex min-h-[48px] w-full items-center justify-center rounded-[10px] border-white/28 bg-white/10 px-5 text-[11px] font-bold normal-case tracking-normal text-white backdrop-blur-[12px] transition-[background,border-color,transform] duration-200 hover:-translate-y-[2px] hover:border-white/50 hover:bg-white/20 sm:w-auto">{copy().heroSecondary}</CatalogLink>
                    </Show>
                  )}
                </Show>
              </div>
            </div>

            <aside
              class="self-end rounded-[22px] border border-white/22 bg-black/40 p-4 shadow-[0_28px_70px_-26px_rgb(0_0_0_/_0.65),inset_0_1.5px_rgb(255_255_255_/_0.18)] backdrop-blur-[34px] backdrop-saturate-[180%] sm:p-6"
              aria-label={copy().heroFactsLabel}
            >
              <div class="flex items-center justify-between font-mono text-[9.5px] font-semibold uppercase tracking-[.1em] text-white/72">
                <span>{copy().heroFactsLabel}</span>
                <Show when={formatScore(active()?.averageScore ?? active()?.meanScore)}>
                  {(score) => <b class="rounded-[6px] border border-mint/30 bg-mint/14 px-[10px] py-[4px] text-[11px] text-mint">★ {score()}</b>}
                </Show>
              </div>
              <Show when={facts().length}>
                <div class="mt-5 grid grid-cols-2 gap-3">
                  <For each={facts()}>{(fact) => <FactNode label={fact.label} value={fact.value} />}</For>
                </div>
              </Show>
              <div class="mt-5 flex justify-between gap-4 border-t border-white/12 pt-[10px] font-mono text-[9px] uppercase tracking-[.08em] text-white/60">
                <Show when={active()?.status}>{(status) => <span>Status: {catalogStatus(mode(), status())}</span>}</Show>
                <span>{mode() === 'ANIME' ? (active()?.nextAiringEpisode ? `Next: ep ${active()?.nextAiringEpisode?.episode}` : 'Finished') : 'AniList record'}</span>
              </div>
            </aside>
          </div>
        </article>
      </section>
    </Show>
  )
}

function FactNode(props: { label: string; value: string }) {
  return (
    <div class="rounded-[12px] border border-white/14 bg-white/10 px-4 py-3 backdrop-blur-[8px]">
      <small class="block font-mono text-[8px] uppercase tracking-[.12em] text-white/58">{props.label}</small>
      <strong class="mt-1 block text-[13.5px] leading-5 text-white">{props.value}</strong>
    </div>
  )
}
