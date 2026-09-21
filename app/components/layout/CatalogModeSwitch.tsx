import { createContext, createEffect, createSignal, For, onMount, useContext, type Accessor, type JSX } from 'solid-js'
import { type CatalogMode } from '../../lib/catalog'
import type { ViewerPreferences } from '../../lib/persistence/viewer'
import { viewerData } from '../../lib/persistence/active'

const MODES: CatalogMode[] = ['ANIME', 'MANGA']

interface CatalogModeState {
  mode: Accessor<CatalogMode>
  changeMode: (next: CatalogMode) => Promise<void>
}

const CatalogModeContext = createContext<CatalogModeState>()

/** Internal catalog state shared by the shell and the home page. */
export function CatalogModeProvider(props: { children: JSX.Element }) {
  const [mode, setMode] = createSignal<CatalogMode>('ANIME')

  const writePreference = async (preferences: ViewerPreferences, next: CatalogMode) => {
    await viewerData.setViewerPreferences({
      adultContent: preferences.adultContent,
      language: preferences.language,
      timezone: preferences.timezone,
      notifications: preferences.notifications,
      catalogMode: next,
    })
  }

  onMount(() => {
    const params = new URLSearchParams(window.location.search)
    const legacyMode = params.get('mode')
    void viewerData.getViewerPreferences().then(async (preferences) => {
      const next = legacyMode === 'MANGA' || legacyMode === 'ANIME' ? legacyMode : preferences.catalogMode
      setMode(next)
      if (legacyMode && legacyMode !== preferences.catalogMode) await writePreference(preferences, next)
      if (legacyMode) {
        params.delete('mode')
        const search = params.toString()
        window.history.replaceState(null, '', `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`)
      }
    }).catch((cause) => {
      console.error('Failed to load the catalog preference.', cause)
    })
  })

  createEffect(() => {
    if (typeof document !== 'undefined') document.title = mode() === 'MANGA' ? 'Discover Manga — AniSource' : 'Discover Anime — AniSource'
  })

  const changeMode = async (next: CatalogMode) => {
    if (next === mode()) return
    setMode(next)
    try {
      await writePreference(await viewerData.getViewerPreferences(), next)
    } catch (cause) {
      console.error('Failed to save the catalog preference.', cause)
    }
  }

  return <CatalogModeContext.Provider value={{ mode, changeMode }}>{props.children}</CatalogModeContext.Provider>
}

export function useCatalogMode(): CatalogModeState {
  const state = useContext(CatalogModeContext)
  if (!state) throw new Error('Catalog mode is only available inside CatalogModeProvider.')
  return state
}

export function useOptionalCatalogMode(): CatalogModeState | undefined {
  return useContext(CatalogModeContext)
}

export function CatalogModeSwitch() {
  const { mode, changeMode } = useCatalogMode()

  return (
    <div class="catalog-mode-switch" role="group" aria-label="Catalog mode">
      <For each={MODES}>{(value) => (
        <button
          type="button"
          aria-pressed={mode() === value}
          classList={{ active: mode() === value }}
          onClick={() => { void changeMode(value) }}
        >
          <span aria-hidden="true">{value === 'ANIME' ? '✦' : '▤'}</span>
          {value}
        </button>
      )}</For>
    </div>
  )
}
