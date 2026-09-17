import { createFileRoute, Link, useRouter } from '@tanstack/solid-router'
import { Show } from 'solid-js'
import { AnimeDetailPage } from '../../components/anime/AnimeDetailPage'
import { detailQuery } from '../../data/options'

export const Route = createFileRoute('/anime/$animeId/')({
  loader: ({ context, params }) => {
    const id = Number(params.animeId)
    if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid anime id.')
    return context.queryClient.ensureQueryData(detailQuery(id))
  },
  component: DetailRoute,
  pendingComponent: DetailPending,
  errorComponent: DetailError,
})

function DetailRoute() {
  const anime = Route.useLoaderData()
  return (
    <Show when={anime()} fallback={<DetailPending />} keyed>
      {(data) => <AnimeDetailPage anime={data} />}
    </Show>
  )
}

function DetailPending() {
  return <section class="detail-head" aria-busy="true"><div class="detail-inner"><div class="skeleton" style={{ height: '420px' }} /><p>Loading anime details…</p></div></section>
}

function DetailError() {
  const router = useRouter()
  return (
    <section class="state">
      <h2>Couldn’t reach AniList</h2>
      <p>Anime details are temporarily unavailable.</p>
      <div class="actions">
        <button class="btn" type="button" onClick={() => { void router.invalidate() }}>Retry</button>
        <Link class="btn ghost" to="/">Back to discovery</Link>
      </div>
    </section>
  )
}
