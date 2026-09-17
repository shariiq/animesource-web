import { createFileRoute, Outlet } from '@tanstack/solid-router'

/**
 * Layout route for a single anime: `/anime/$animeId` (detail) and
 * `/anime/$animeId/watch/$episodeId` (streaming) render through this Outlet.
 * Data loading lives on the child routes so each owns its own loader state.
 */
export const Route = createFileRoute('/anime/$animeId')({
  component: () => <Outlet />,
})
