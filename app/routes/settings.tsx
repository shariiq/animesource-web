import { createFileRoute } from '@tanstack/solid-router'
import { SettingsPage } from '../components/account/SettingsPage'

export const Route = createFileRoute('/settings')({
  head: () => ({
    meta: [
      { title: 'Settings — AniSource' },
      { name: 'description', content: 'Manage viewer preferences, portability, imports, and local data.' },
    ],
  }),
  component: SettingsPage,
})
