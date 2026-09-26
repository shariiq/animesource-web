import { createFileRoute } from '@tanstack/solid-router'
import { handleAniSourceRequest } from '../../../data/anisource/proxy.server'

export const Route = createFileRoute('/api/anisource/$')({
  server: {
    handlers: {
      GET: ({ request }) => handleAniSourceRequest(request),
      HEAD: ({ request }) => handleAniSourceRequest(request),
      // POST exists solely for the proof-of-work session exchange; the
      // handler answers 405 for POST anywhere else.
      POST: ({ request }) => handleAniSourceRequest(request),
    },
  },
})
