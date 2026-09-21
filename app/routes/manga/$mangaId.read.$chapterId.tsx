import { createFileRoute, useNavigate, useParams, useSearch } from '@tanstack/solid-router'
import { Show } from 'solid-js'
import { z } from 'zod'
import { MangaReaderPage } from '../../components/manga/MangaReaderPage'
import { detailQuery } from '../../data/options'

const readerSearchSchema = z.object({
  source: z.string().min(1).optional(),
})

export const Route = createFileRoute('/manga/$mangaId/read/$chapterId')({
  validateSearch: (search) => readerSearchSchema.parse(search),
  loader: ({ context, params }) => {
    const id = Number(params.mangaId)
    if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid manga id.')
    if (!params.chapterId) throw new Error('Missing chapter id.')
    return context.queryClient.ensureQueryData(detailQuery(id, 'MANGA'))
  },
  head: () => ({
    meta: [
      { title: 'Manga reader — AniSource' },
      { name: 'description', content: 'Read manga chapters with a fast, resumable AniSource reader.' },
    ],
  }),
  component: MangaReaderRoute,
  pendingComponent: MangaReaderPending,
  errorComponent: MangaReaderError,
})

function MangaReaderRoute() {
  const manga = Route.useLoaderData()
  const params = useParams({ from: '/manga/$mangaId/read/$chapterId' })
  const search = useSearch({ from: '/manga/$mangaId/read/$chapterId' })
  const navigate = useNavigate()
  const navigateToChapter = async (chapterId: string, sourceId: string, replace = false) => {
    await navigate({
      to: '/manga/$mangaId/read/$chapterId',
      params: { mangaId: params().mangaId, chapterId },
      search: sourceId ? { source: sourceId } : {},
      replace,
    })
  }
  return (
    <Show when={manga()} fallback={<MangaReaderPending />} keyed>
      {(data) => (
        <MangaReaderPage
          manga={data}
          routeChapterId={() => params().chapterId}
          sourceSearchParam={() => search().source}
          navigateToChapter={navigateToChapter}
        />
      )}
    </Show>
  )
}

function MangaReaderPending() {
  return <section class="manga-reader-route-state" aria-busy="true"><div class="manga-reader-route-mark">MANGA</div><p>Loading manga reader…</p></section>
}

function MangaReaderError() {
  return <section class="manga-reader-route-state"><div class="manga-reader-route-mark">!</div><h1>Manga reader unavailable.</h1><p>AniList could not load this manga record.</p></section>
}
