import { Link } from '@tanstack/solid-router'
import { GlobalSearch } from './GlobalSearch'
import { makeBrowseSearch } from '../../lib/browse'
import { localDateKey } from '../../lib/schedule'

export function Header() {
  return (
    <header class="editorial-page pb-0" aria-label="Site header">
      <div class="frosted-shell header-shell relative flex min-h-[58px] flex-wrap items-center justify-between gap-x-5 gap-y-2 px-4 sm:px-5">
        <Link to="/" preload="intent" class="flex items-center gap-[11px] text-sm font-extrabold tracking-[-.03em]" aria-label="AniSource home">
          <span class="grid size-6 grid-cols-3 gap-0.5" aria-hidden="true"><i class="rounded-full bg-black" /><i class="rounded-full bg-black" /><i class="rounded-full bg-black" /><i class="rounded-full bg-black" /><i class="rounded-full bg-black/15" /><i class="rounded-full bg-black" /><i class="rounded-full bg-black" /><i class="rounded-full bg-black" /><i class="rounded-full bg-black" /></span>
          <span>ANIMESOURCE</span>
        </Link>
        <div class="header-actions">
          <nav class="flex gap-4 overflow-x-auto rounded-full border border-line bg-white/45 px-3 py-2 font-mono text-[10px] uppercase tracking-[.1em] text-text-muted shadow-[0_8px_18px_-14px_rgb(0_0_0/.45)]" aria-label="Primary navigation">
            <Link to="/" preload="intent" activeOptions={{ exact: true }} class="transition-colors hover:text-black" activeProps={{ class: 'text-black font-medium' }}>Home</Link>
            <Link to="/explore" preload="intent" search={makeBrowseSearch()} class="transition-colors hover:text-black" activeProps={{ class: 'text-black font-medium' }}>Explore</Link>
            <Link to="/library" preload="intent" class="transition-colors hover:text-black" activeProps={{ class: 'text-black font-medium' }}>Library</Link>
            <Link to="/schedule" search={{ date: localDateKey(new Date()), view: 'week', saved: false }} class="transition-colors hover:text-black" activeProps={{ class: 'text-black font-medium' }}>Schedule</Link>
          </nav>
          <span class="hidden font-mono text-[10px] uppercase tracking-[.13em] text-text-muted md:inline">Anime catalog · streaming on demand</span>
          <GlobalSearch />
        </div>
      </div>
    </header>
  )
}
