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
  loader: async ({ context, deps }) => {
    // Keep navigation alive when AniList rate-limits the schedule fan-out.
    // A failed server fetch is removed before hydration so the server and the
    // client both begin from the previous (or loading) state; the client
    // query then renders its own retry state instead of a route error tree.
    const query = scheduleQuery(deps.start, deps.end)
    try {
      await context.queryClient.ensureQueryData(query)
    } catch {
      context.queryClient.removeQueries({ queryKey: query.queryKey })
    }
  },
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
