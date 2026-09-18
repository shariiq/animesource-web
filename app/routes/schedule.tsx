import { createFileRoute } from '@tanstack/solid-router'
import { SchedulePage } from '../components/schedule/SchedulePage'
import { scheduleQuery } from '../data/options'
import { scheduleRequestRange, scheduleSearchSchema } from '../lib/schedule'

export const Route = createFileRoute('/schedule')({
  validateSearch: (search) => scheduleSearchSchema.parse(search),
  loaderDeps: ({ search }) => {
    const range = scheduleRequestRange(search.date, search.view)
    return { start: range.start, end: range.end }
  },
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(scheduleQuery(deps.start, deps.end)),
  head: () => ({
    meta: [
      { title: 'Airing schedule — AniSource' },
      { name: 'description', content: 'Browse upcoming anime episode releases in your local timezone.' },
    ],
  }),
  component: ScheduleRoute,
})

function ScheduleRoute() {
  const search = Route.useSearch()
  return <SchedulePage search={search} />
}
