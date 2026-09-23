import { createFileRoute } from '@tanstack/solid-router'
import { handleAniSourceRequest } from '../../../data/anisource/proxy.server'

export const Route = createFileRoute('/api/anisource/$')({
  server: {
    handlers: {
      GET: ({ request }) => handleAniSourceRequest(request),
      HEAD: ({ request }) => handleAniSourceRequest(request),
    },
  },
})
