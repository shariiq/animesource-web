import { createServerFn } from '@tanstack/solid-start'
import { z } from 'zod'

const subtitleUrlSchema = z.object({ url: z.url().max(2_048) })
const MAX_SUBTITLE_BYTES = 2_000_000

/**
 * Small server-side caption relay used only after a browser CORS fetch fails.
 * Caption URLs come from an AniSource stream response; credentials and caller
 * headers are never forwarded.
 */
export const fetchSubtitleText = createServerFn({ method: 'GET' })
  .validator(subtitleUrlSchema)
  .handler(async ({ data }) => {
    const target = new URL(data.url)
    if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Unsupported subtitle URL.')
    const response = await fetch(target, {
      headers: { Accept: 'text/vtt, text/plain;q=0.9, */*;q=0.1' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`Subtitle request failed (${response.status}).`)
    const length = Number(response.headers.get('content-length') ?? 0)
    if (Number.isFinite(length) && length > MAX_SUBTITLE_BYTES) throw new Error('Subtitle track is too large.')
    const text = await response.text()
    if (new Blob([text]).size > MAX_SUBTITLE_BYTES) throw new Error('Subtitle track is too large.')
    return text
  })
