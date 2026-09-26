import { createFileRoute } from '@tanstack/solid-router'
import { createEffect, Show } from 'solid-js'
import { HomePage } from '../components/home/HomePage'
import { useCatalogMode } from '../components/layout/CatalogModeSwitch'
import { homeQuery } from '../data/options'

export const Route = createFileRoute('/')({
  loader: async ({ context }) => {
    // Keep route rendering alive when the discovery query fails. Remove a
    // failed server query before hydration so the server and client both begin
    // in the loading state; the client can then render the query's retry state
    // without hydrating a different error tree over the loading markup.
    const query = homeQuery('ANIME')
    try {
      await context.queryClient.ensureQueryData(query)
    } catch {
      context.queryClient.removeQueries({ queryKey: query.queryKey })
    }
  },
  head: () => ({
    meta: [
      { title: 'Discover Anime — AniSource' },
      {
        name: 'description',
        content: 'Browse trending, seasonal and top-rated anime with rich AniList metadata, then watch instantly through live-resolved streams.',
      },
    ],
  }),
  component: HomeRoute,
})

function HomeRoute() {
  const catalogMode = useCatalogMode()
  createEffect(() => {
    if (typeof document !== 'undefined') document.title = catalogMode.mode() === 'MANGA' ? 'Discover Manga — AniSource' : 'Discover Anime — AniSource'
  })
  return <Show when={catalogMode.mode()} keyed>{(mode) => <HomePage mode={mode} />}</Show>
}
