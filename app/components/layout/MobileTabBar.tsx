import { Link, useLocation } from '@tanstack/solid-router'
import { Show, type JSX } from 'solid-js'
import { useCatalogMode } from './CatalogModeSwitch'
import { makeBrowseSearch } from '../../lib/browse'
import { localDateKey } from '../../lib/schedule'

function TabIcon(props: { children: JSX.Element }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {props.children}
    </svg>
  )
}

/**
 * Thumb-reach navigation on phones. Tablets retain the header navigation row;
 * Watch and the Manga Reader keep their own immersive media chrome.
 */
export function MobileTabBar() {
  const catalogMode = useCatalogMode()
  const mode = () => catalogMode.mode()
  const location = useLocation()
  const isImmersive = () => /^\/(?:manga\/[^/]+\/read\/|anime\/[^/]+\/watch\/)/.test(location().pathname)

  return (
    <Show when={!isImmersive()}>
      <nav class="mobile-tabbar" aria-label="Primary navigation">
        <Link to="/" preload="intent" activeOptions={{ exact: true }} class="mobile-tab" activeProps={{ class: 'mobile-tab-active' }}>
          <TabIcon><path d="M4 11.2 12 4l8 7.2" /><path d="M6.2 9.4V20h11.6V9.4" /></TabIcon>
          <span>Home</span>
        </Link>
        <Link to="/explore" preload="intent" search={makeBrowseSearch()} activeOptions={{ includeSearch: false }} class="mobile-tab" activeProps={{ class: 'mobile-tab-active' }}>
          <TabIcon><path d="M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17Z" /><path d="M15.6 8.4l-2.3 4.9-4.9 2.3 2.3-4.9Z" /></TabIcon>
          <span>Explore</span>
        </Link>
        <Link to="/library" preload="intent" class="mobile-tab" activeProps={{ class: 'mobile-tab-active' }}>
          <TabIcon><path d="M6 20V5.5A1.5 1.5 0 0 1 7.5 4h9A1.5 1.5 0 0 1 18 5.5V20l-6-3.6Z" /></TabIcon>
          <span>Library</span>
        </Link>
        <Show when={mode() === 'ANIME'}>
          <Link to="/schedule" search={{ date: localDateKey(new Date()), view: 'week', saved: false }} class="mobile-tab" activeProps={{ class: 'mobile-tab-active' }}>
            <TabIcon><path d="M4.5 6.8A1.8 1.8 0 0 1 6.3 5h11.4a1.8 1.8 0 0 1 1.8 1.8v11.4a1.8 1.8 0 0 1-1.8 1.8H6.3a1.8 1.8 0 0 1-1.8-1.8Z" /><path d="M4.5 10h15" /><path d="M8.5 3.5v3.4M15.5 3.5v3.4" /></TabIcon>
            <span>Schedule</span>
          </Link>
        </Show>
        <Link to="/profile" preload="intent" class="mobile-tab" activeProps={{ class: 'mobile-tab-active' }}>
          <TabIcon><path d="M12 12.2a3.9 3.9 0 1 0 0-7.8 3.9 3.9 0 0 0 0 7.8Z" /><path d="M5 20c1.1-3.2 3.9-4.8 7-4.8s5.9 1.6 7 4.8" /></TabIcon>
          <span>Profile</span>
        </Link>
      </nav>
    </Show>
  )
}
