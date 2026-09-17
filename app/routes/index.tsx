import { createFileRoute } from '@tanstack/solid-router'
import { HomePage } from '../components/home/HomePage'
import { homeQuery } from '../data/options'

export const Route = createFileRoute('/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(homeQuery()),
  component: HomePage,
})
