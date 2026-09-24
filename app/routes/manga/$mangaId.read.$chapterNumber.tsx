import { createFileRoute, useNavigate, useParams, useSearch } from '@tanstack/solid-router'
import { Show } from 'solid-js'
import { z } from 'zod'
import { MangaReaderPage } from '../../components/manga/MangaReaderPage'
import { RouteLoadingFallback } from '../../components/ui/LoadingSkeleton'
import { detailQuery } from '../../data/options'

const readerSearchSchema = z.object({
  source: z.string().min(1).optional(),
})

export const Route = createFileRoute('/manga/$mangaId/read/$chapterNumber')({
  validateSearch: (search) => readerSearchSchema.parse(search),
  loader: ({ context, params }) => {
    const id = Number(params.mangaId)
    if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid manga id.')
    if (!params.chapterNumber) throw new Error('Missing chapter number.')
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
  const params = useParams({ from: '/manga/$mangaId/read/$chapterNumber' })
  const search = useSearch({ from: '/manga/$mangaId/read/$chapterNumber' })
  const navigate = useNavigate()
  const navigateToChapter = async (chapterNumber: string, sourceId: string, replace = false) => {
    await navigate({
      to: '/manga/$mangaId/read/$chapterNumber',
      params: { mangaId: params().mangaId, chapterNumber },
      search: sourceId ? { source: sourceId } : {},
      replace,
    })
  }
  return (
    <Show when={manga()} fallback={<MangaReaderPending />} keyed>
      {(data) => (
        <MangaReaderPage
          manga={data}
          routeChapterNumber={() => params().chapterNumber}
          sourceSearchParam={() => search().source}
          navigateToChapter={navigateToChapter}
        />
      )}
    </Show>
  )
}

function MangaReaderPending() {
  return <RouteLoadingFallback kicker="Manga reader" title="Loading manga reader…" />
}

function MangaReaderError() {
  return <section class="manga-reader-route-state"><div class="manga-reader-route-mark">!</div><h1>Manga reader unavailable.</h1><p>AniList could not load this manga record.</p></section>
}
