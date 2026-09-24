import { createFileRoute } from '@tanstack/solid-router'
import { Show } from 'solid-js'
import { z } from 'zod'
import { WatchPage } from '../../components/anime/WatchPage'
import { PlayerLoadingSkeleton } from '../../components/ui/LoadingSkeleton'
import { detailQuery } from '../../data/options'

const watchSearchSchema = z.object({
  source: z.string().min(1).optional(),
})

export const Route = createFileRoute('/anime/$animeId/watch/$episodeId')({
  validateSearch: (search) => watchSearchSchema.parse(search),
  loader: ({ context, params }) => {
    const id = Number(params.animeId)
    if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid anime id.')
    if (!params.episodeId) throw new Error('Missing episode id.')
    return context.queryClient.ensureQueryData(detailQuery(id))
  },
  component: WatchRoute,
})

function WatchRoute() {
  const anime = Route.useLoaderData()
  return (
    <Show when={anime()} fallback={<PlayerLoadingSkeleton message="Loading anime details…" />} keyed>
      {(data) => <WatchPage anime={data} />}
    </Show>
  )
}
