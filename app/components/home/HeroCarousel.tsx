import { createMemo, createSignal, onCleanup, onMount, For, Show } from 'solid-js'
import { Link } from '@tanstack/solid-router'
import type { AniListMedia } from '../../data/anilist/types'
import { formatCompactNumber, formatEnum, formatScore, formatStatus, titleOf } from '../../lib/format'
import { SectionHeading } from '../ui/SectionHeading'

const SLIDE_INTERVAL_MS = 7000
const MAX_SLIDES = 6

export function HeroCarousel(props: { items: AniListMedia[] }) {
  const slides = () => props.items.filter((media) => media.bannerImage || media.coverImage?.extraLarge).slice(0, MAX_SLIDES)
  const [activeIndex, setActiveIndex] = createSignal(0)
  const [paused, setPaused] = createSignal(false)
  const active = createMemo(() => {
    const list = slides()
    return list.length ? list[activeIndex() % list.length] : undefined
  })
  const titleParts = createMemo(() => {
    const title = titleOf(active())
    const match = title.match(/^(.+?)(\s*[:—-]\s*)(.+)$/)
    return match ? { lead: match[1], separator: match[2], accent: match[3] } : { lead: title, separator: '', accent: '' }
  })
  const metaLine = createMemo(() => [
    active()?.seasonYear,
    active()?.format ? formatEnum(active()?.format) : null,
    active()?.status ? formatStatus(active()?.status) : null,
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
      media.episodes ? { label: 'Episodes', value: `${media.episodes} episodes` } : null,
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
      <section class="featured-section" aria-labelledby="featured-heading">
        <SectionHeading
          id="featured-heading"
          title="Featured Anime"
          description="Trending series / episode access / anime details"
        />
        <article
          class="featured-shell relative isolate overflow-hidden rounded-shell border border-white/82 bg-white/62 shadow-glass backdrop-blur-[54px] backdrop-saturate-[180%]"
          aria-roledescription="carousel"
          aria-label="Featured anime"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <div class="featured-artwork absolute inset-0 overflow-hidden bg-paper" aria-hidden="true">
            <For each={slides()}>
              {(media, index) => (
                <img
                  class="featured-artwork-image absolute inset-0 h-full w-full object-cover object-[70%_25%] transition-[opacity,transform] duration-700 ease-fluid"
                  classList={{ 'opacity-100': index() === activeIndex(), 'opacity-0': index() !== activeIndex() }}
                  src={image(media)}
                  alt=""
                />
              )}
            </For>
            <div class="featured-contrast" />
          </div>

          <div class="relative z-10 flex min-h-[54px] items-center justify-between gap-4 border-b border-black/8 bg-white/32 px-6 font-mono text-[9px] uppercase tracking-[.12em] text-text-muted backdrop-blur-[16px] sm:px-8">
            <div class="flex items-center gap-[10px]">
              <i class="size-[6px] rounded-full bg-emerald shadow-[0_0_8px_rgb(37_143_100_/_0.5)]" />
              <span>Trending now</span>
            </div>
            <div class="flex items-center gap-[6px]" role="tablist" aria-label="Featured anime">
              <span class="hidden sm:inline">Featured:</span>
              <For each={slides()}>
                {(media, index) => (
                  <button
                    type="button"
                    class="paper-control grid h-[28px] min-w-[32px] place-items-center rounded-[8px] border-black/8 bg-white/68 px-[8px] font-semibold text-text-secondary hover:-translate-y-px hover:bg-white"
                    classList={{ 'border-ink bg-ink text-white shadow-[0_4px_12px_rgb(0_0_0_/_0.15)] hover:bg-ink': index() === activeIndex() }}
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

          <div class="relative z-10 grid min-h-[530px] gap-6 px-6 pb-9 pt-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,.85fr)] lg:px-8">
            <div class="flex min-w-0 flex-col justify-end pb-3 lg:pr-3">
              <p class="mb-3 flex flex-wrap items-center gap-x-[10px] gap-y-[7px] font-mono text-[10px] font-semibold uppercase tracking-[.12em] text-text-secondary">
                <span class="rounded-[5px] bg-violet/12 px-[8px] py-[3px] text-violet">
                  #{String(activeIndex() + 1).padStart(2, '0')} trending
                </span>
                <Show when={metaLine()}><span>{metaLine()}</span></Show>
              </p>
              <h2 class="max-w-[960px] text-balance font-display text-[clamp(48px,6vw,92px)] leading-[.86] tracking-[-.055em] text-ink" aria-label={titleOf(active())}>
                <span>{titleParts().lead}</span>
                <Show when={titleParts().accent}>
                  <span class="italic text-violet">{titleParts().separator}{titleParts().accent}</span>
                </Show>
              </h2>
              <Show when={active()?.title?.native && active()?.title?.native !== titleOf(active())}>
                <p class="mt-[10px] text-[11.5px] tracking-[.02em] text-quiet">{active()?.title?.native}</p>
              </Show>
              <Show when={(active()?.genres ?? []).filter(Boolean).length}>
                <p class="mt-[22px] max-w-[62ch] text-[13.5px] leading-[1.7] text-text-secondary">
                  {(active()?.genres ?? []).filter(Boolean).slice(0, 3).join(' · ')}
                </p>
              </Show>
              <div class="mt-8 flex flex-wrap items-center gap-3">
                <Show when={active()} keyed>
                  {(media) => (
                    <Link
                      class="ink-control inline-flex min-h-[46px] items-center justify-center gap-[10px] rounded-[10px] px-[26px] shadow-[0_8px_24px_rgb(0_0_0_/_0.16)] transition-[background,box-shadow,transform] duration-200 hover:-translate-y-[2px] hover:bg-ink hover:text-white hover:shadow-[0_12px_30px_rgb(0_0_0_/_0.22)]"
                      to="/anime/$animeId/watch/$episodeId"
                      params={{ animeId: String(media.id), episodeId: 'next' }}
                    >
                      ▶ Stream next episode
                    </Link>
                  )}
                </Show>
                <Show when={active()} keyed>
                  {(media) => (
                    <Link
                      class="paper-control inline-flex min-h-[46px] items-center justify-center rounded-[10px] px-5 text-[11px] font-bold normal-case tracking-normal shadow-[0_4px_14px_rgb(0_0_0_/_0.04)] transition-[background,border-color,transform] duration-200 hover:-translate-y-[2px] hover:border-black/18 hover:bg-white"
                      to="/anime/$animeId"
                      params={{ animeId: String(media.id) }}
                    >
                      View details
                    </Link>
                  )}
                </Show>
              </div>
            </div>

            <aside
              class="material-panel self-end rounded-[18px] border-white/80 bg-white/52 p-6"
              aria-label="Featured anime details"
            >
              <div class="flex items-center justify-between font-mono text-[9.5px] font-semibold uppercase tracking-[.1em] text-text-secondary">
                <span>Anime details</span>
                <Show when={formatScore(active()?.averageScore ?? active()?.meanScore)}>
                  {(score) => <b class="rounded-[6px] bg-[rgb(18_101_71_/_0.12)] px-[10px] py-[4px] text-[11px] text-emerald">★ {score()}</b>}
                </Show>
              </div>
              <Show when={facts().length}>
                <div class="mt-5 grid grid-cols-2 gap-3">
                  <For each={facts()}>{(fact) => <FactNode label={fact.label} value={fact.value} />}</For>
                </div>
              </Show>
              <div class="mt-5 flex justify-between gap-4 border-t border-black/6 pt-[10px] font-mono text-[9px] uppercase tracking-[.08em] text-text-muted">
                <Show when={active()?.status}>{(status) => <span>Status: {formatStatus(status())}</span>}</Show>
                <span>{active()?.nextAiringEpisode ? `Next: ep ${active()?.nextAiringEpisode?.episode}` : 'Finished'}</span>
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
    <div class="rounded-[12px] border border-line bg-white/64 px-4 py-3">
      <small class="block font-mono text-[8px] uppercase tracking-[.12em] text-text-muted">{props.label}</small>
      <strong class="mt-1 block text-[13.5px] leading-5 text-ink">{props.value}</strong>
    </div>
  )
}
