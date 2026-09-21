import { createFileRoute, Link, useRouter } from '@tanstack/solid-router'
import { Show } from 'solid-js'
import { MangaDetailPage } from '../../components/manga/MangaDetailPage'
import { detailQuery } from '../../data/options'

export const Route = createFileRoute('/manga/$mangaId/')({
  loader: ({ context, params }) => {
    const id = Number(params.mangaId)
    if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid manga id.')
    return context.queryClient.ensureQueryData(detailQuery(id, 'MANGA'))
  },
  head: () => ({
    meta: [
      { title: 'Manga detail — AniSource' },
      { name: 'description', content: 'Read the publication record, creators, themes, and related manga from AniList.' },
    ],
  }),
  component: MangaRoute,
  pendingComponent: MangaPending,
  errorComponent: MangaError,
})

function MangaRoute() {
  const manga = Route.useLoaderData()
  return (
    <Show when={manga()} fallback={<MangaPending />} keyed>
      {(data) => <MangaDetailPage manga={data} />}
    </Show>
  )
}

function MangaPending() {
  return <section class="detail-head" aria-busy="true"><div class="detail-inner"><div class="skeleton" style={{ height: '420px' }} /><p>Loading manga details…</p></div></section>
}

function MangaError() {
  const router = useRouter()
  return (
    <section class="state">
      <h2>Couldn’t reach AniList</h2>
      <p>Manga details are temporarily unavailable.</p>
      <div class="actions">
        <button class="btn" type="button" onClick={() => { void router.invalidate() }}>Retry</button>
        <Link class="btn ghost" to="/">Back to discovery</Link>
      </div>
    </section>
  )
}
