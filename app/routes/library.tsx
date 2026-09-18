import { createFileRoute } from '@tanstack/solid-router'
import { LibraryPage } from '../components/library/LibraryPage'

export const Route = createFileRoute('/library')({
  head: () => ({
    meta: [
      { title: 'Your library — AniSource' },
      { name: 'description', content: 'Organize saved anime and continue watching from this device.' },
    ],
  }),
  component: LibraryPage,
})
