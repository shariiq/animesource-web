import { createFileRoute } from '@tanstack/solid-router'
import { ProfilePage } from '../components/account/ProfilePage'

export const Route = createFileRoute('/profile')({
  head: () => ({
    meta: [
      { title: 'Your profile — AniSource' },
      { name: 'description', content: 'Manage the local viewer profile and account-ready preferences.' },
    ],
  }),
  component: ProfilePage,
})
