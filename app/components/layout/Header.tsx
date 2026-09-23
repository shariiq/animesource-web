import { Link } from '@tanstack/solid-router'
import { Show } from 'solid-js'
import { GlobalSearch } from './GlobalSearch'
import { CatalogModeSwitch, useCatalogMode } from './CatalogModeSwitch'
import { makeBrowseSearch } from '../../lib/browse'
import { localDateKey } from '../../lib/schedule'

const NAV_LINK_CLASS =
  'rounded-full px-3 py-1.5 transition-[background,color,box-shadow] duration-200 hover:bg-white/70 hover:text-black hover:shadow-[inset_0_1px_rgb(255_255_255/.9),0_6px_14px_-10px_rgb(6_6_9/.4)]'
const NAV_LINK_ACTIVE_CLASS = 'bg-ink text-white shadow-[0_8px_18px_-10px_rgb(6_6_9/.6),inset_0_1px_rgb(255_255_255/.22)] hover:bg-ink hover:text-white hover:shadow-[0_8px_18px_-10px_rgb(6_6_9/.6),inset_0_1px_rgb(255_255_255/.22)]'

export function Header() {
  const catalogMode = useCatalogMode()
  const mode = () => catalogMode.mode()
  return (
    <header class="editorial-page site-header pb-0" aria-label="Site header">
      <div class="frosted-shell header-shell relative flex min-h-[58px] min-w-0 flex-wrap items-center justify-between gap-x-5 gap-y-2 px-4 sm:px-5">
        <Link to="/" preload="intent" class="flex items-center gap-[11px] text-sm font-extrabold tracking-[-.03em]" aria-label="AniSource home">
          <span class="grid size-6 grid-cols-3 gap-0.5" aria-hidden="true"><i class="rounded-full bg-black" /><i class="rounded-full bg-black" /><i class="rounded-full bg-black" /><i class="rounded-full bg-black" /><i class="rounded-full bg-signal shadow-[0_0_8px_rgb(255_46_31/.55)]" /><i class="rounded-full bg-black" /><i class="rounded-full bg-black" /><i class="rounded-full bg-black" /><i class="rounded-full bg-black" /></span>
          <span>ANIMESOURCE</span>
        </Link>
        <div class="header-actions">
          <CatalogModeSwitch />
          <nav class="header-primary-nav flex min-w-0 gap-1 overflow-x-auto rounded-full border border-white/70 bg-white/40 p-1 font-mono text-[10px] uppercase tracking-[.1em] text-text-muted shadow-[0_10px_24px_-16px_rgb(6_6_9/.5),inset_0_1px_rgb(255_255_255/.85)] backdrop-blur-[20px] backdrop-saturate-[180%]" aria-label="Primary navigation">
            <Link to="/" preload="intent" activeOptions={{ exact: true }} class={NAV_LINK_CLASS} activeProps={{ class: NAV_LINK_ACTIVE_CLASS }}>Home</Link>
            <Link to="/explore" preload="intent" search={makeBrowseSearch()} activeOptions={{ includeSearch: false }} class={NAV_LINK_CLASS} activeProps={{ class: NAV_LINK_ACTIVE_CLASS }}>Explore</Link>
            <Link to="/library" preload="intent" class={NAV_LINK_CLASS} activeProps={{ class: NAV_LINK_ACTIVE_CLASS }}>Library</Link>
            <Show when={mode() === 'ANIME'}>
              <Link to="/schedule" search={{ date: localDateKey(new Date()), view: 'week', saved: false }} class={NAV_LINK_CLASS} activeProps={{ class: NAV_LINK_ACTIVE_CLASS }}>Schedule</Link>
            </Show>
            <Link to="/profile" preload="intent" class={NAV_LINK_CLASS} activeProps={{ class: NAV_LINK_ACTIVE_CLASS }}>Profile</Link>
          </nav>
          <span class="header-status hidden items-center gap-[7px] font-mono text-[10px] uppercase tracking-[.13em] text-text-muted md:inline-flex"><i class="inline-block size-[5px] animate-pulse rounded-full bg-emerald shadow-[0_0_8px_rgb(0_200_83/.6)]" />{mode() === 'MANGA' ? 'Manga catalog' : 'Anime catalog'}</span>
          <GlobalSearch mode={mode()} />
        </div>
      </div>
    </header>
  )
}
