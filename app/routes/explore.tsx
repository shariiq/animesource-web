import { createFileRoute } from '@tanstack/solid-router'
import { ExplorePage } from '../components/explore/ExplorePage'
import { browseQuery, genresQuery } from '../data/options'
import { browseSearchSchema, toBrowseParams } from '../lib/browse'

export const Route = createFileRoute('/explore')({
  validateSearch: (search) => browseSearchSchema.parse(search),
  loaderDeps: ({ search }) => toBrowseParams(search),
  loader: async ({ context, deps }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(browseQuery(deps)),
      context.queryClient.ensureQueryData(genresQuery()),
    ])
  },
  head: () => ({
    meta: [
      { title: 'Explore catalog — AniSource' },
      { name: 'description', content: 'Search, filter, and discover anime and manga with AniSource.' },
    ],
  }),
  component: ExploreRoute,
})

function ExploreRoute() {
  const search = Route.useSearch()
  return <ExplorePage search={search} />
}
