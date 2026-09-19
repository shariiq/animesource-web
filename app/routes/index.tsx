import { createFileRoute } from '@tanstack/solid-router'
import { HomePage } from '../components/home/HomePage'
import { genresQuery, homeQuery } from '../data/options'

export const Route = createFileRoute('/')({
  loader: ({ context }) => Promise.all([
    context.queryClient.ensureQueryData(homeQuery()),
    context.queryClient.ensureQueryData(genresQuery()),
  ]),
  component: HomePage,
})
