import { z } from 'zod'
import { appendFileSync } from 'node:fs'

const ANILIST_URL = process.env.LIVE_ANILIST_URL || 'https://graphql.anilist.co'
const ANISOURCE_BASE = (process.env.LIVE_ANISOURCE_BASE || 'https://anisource-api.onrender.com').replace(/\/+$/, '')
const STEP_SUMMARY_FILE = process.env.GITHUB_STEP_SUMMARY

// ---- Zod Boundary Schemas (matching production contracts) ----
const nullableString = z.string().nullable().nullish()
const nullableInt = z.number().int().nullable().nullish()

const titleShape = z
  .object({
    romaji: nullableString,
    english: nullableString,
    native: nullableString,
  })
  .nullish()

const coverImageShape = z
  .object({
    extraLarge: nullableString,
    large: nullableString,
    medium: nullableString,
    color: nullableString,
  })
  .nullish()

const nextAiringEpisodeShape = z
  .object({
    episode: z.number(),
    airingAt: z.number(),
    timeUntilAiring: z.number(),
  })
  .nullish()

export const mediaShape = z.object({
  id: z.number(),
  type: nullableString,
  siteUrl: nullableString,
  title: titleShape,
  coverImage: coverImageShape,
  bannerImage: nullableString,
  averageScore: nullableInt,
  meanScore: nullableInt,
  popularity: nullableInt,
  favourites: nullableInt,
  trending: nullableInt,
  format: nullableString,
  status: nullableString,
  episodes: nullableInt,
  season: nullableString,
  seasonYear: nullableInt,
  genres: z.array(nullableString).nullish(),
  countryOfOrigin: nullableString,
  isAdult: z.boolean().nullish(),
  nextAiringEpisode: nextAiringEpisodeShape,
})

export const homeShape = z.object({
  trending: z.object({ media: z.array(mediaShape) }),
  season: z.object({ media: z.array(mediaShape) }),
  allTime: z.object({ media: z.array(mediaShape) }),
  topRated: z.object({ media: z.array(mediaShape) }),
  upcoming: z.object({ media: z.array(mediaShape) }),
})

export const healthResponseSchema = z.object({
  status: z.string().default('ok'),
  version: z.string(),
  uptime_seconds: z.number(),
  memory_usage_mb: z.number(),
  active_sources: z.number().int(),
  cache_stats: z.record(z.string(), z.unknown()),
})

export const sourceInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  base_url: z.string(),
})

export const sourceListResponseSchema = z.object({
  sources: z.array(sourceInfoSchema),
  count: z.number(),
})

export const anisourceAnimeSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  thumbnail: z.string().default(''),
  description: z.string().default(''),
  genres: z.array(z.string()).default([]),
  studios: z.array(z.string()).default([]),
  producers: z.array(z.string()).default([]),
  alternative_titles: z.array(z.string()).default([]),
  status: z.string().default('unknown'),
  score: z.number().nullable().optional(),
  tags: z.array(z.string()).default([]),
})

export const searchResponseSchema = z.object({
  items: z.array(anisourceAnimeSchema),
  page: z.number(),
  has_next: z.boolean(),
  total_returned: z.number(),
})

// ---- Helpers ----
export function currentSeason(date = new Date()) {
  const m = date.getMonth() + 1
  const y = date.getFullYear()
  if (m <= 2) return { season: 'WINTER', year: y }
  if (m <= 5) return { season: 'SPRING', year: y }
  if (m <= 8) return { season: 'SUMMER', year: y }
  return { season: 'FALL', year: y }
}

export function nextSeasonOf(date = new Date()) {
  const cur = currentSeason(date)
  const order = ['WINTER', 'SPRING', 'SUMMER', 'FALL']
  const idx = order.indexOf(cur.season)
  if (idx === 3) return { season: 'WINTER', year: cur.year + 1 }
  const next = order[idx + 1]
  if (!next) return { season: 'WINTER', year: cur.year + 1 }
  return { season: next, year: cur.year }
}

export const MEDIA_FRAGMENT = `
  fragment media on Media {
    id
    type
    siteUrl
    title { romaji english native }
    coverImage { extraLarge large medium color }
    bannerImage
    averageScore
    meanScore
    popularity
    favourites
    trending
    format
    status
    episodes
    season
    seasonYear
    genres
    countryOfOrigin
    isAdult
    nextAiringEpisode { episode airingAt timeUntilAiring }
  }
`

const HEALTH_ATTEMPTS = 4
const HEALTH_ATTEMPT_TIMEOUT_MS = 8_000
const HEALTH_RETRY_DELAY_MS = 1_000
const TRANSIENT_HEALTH_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])
const results = []

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function recordResult({ service, target, ok, durationMs, details, error }) {
  results.push({ service, target, ok, durationMs, details, error })
  const icon = ok ? '✅ PASS' : '❌ FAIL'
  const time = `${(durationMs / 1000).toFixed(2)}s`
  console.log(`[${icon}] ${service.padEnd(9)} | ${target.padEnd(24)} | ${time.padStart(6)} | ${details || error || ''}`)
}

async function runAniListChecks() {
  console.log(`\n--- 1. Testing Live AniList GraphQL (${ANILIST_URL}) ---`)

  // Check 1: GenreCollection
  const t0 = performance.now()
  try {
    const res = await fetch(ANILIST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: 'query { GenreCollection }' }),
      signal: AbortSignal.timeout(15_000),
    })

    if (res.status === 429) {
      const retryAfter = res.headers.get('retry-after')
      recordResult({
        service: 'AniList',
        target: 'GenreCollection',
        ok: false,
        durationMs: Math.round(performance.now() - t0),
        error: `Rate limit exceeded (HTTP 429)${retryAfter ? `, Retry-After: ${retryAfter}s` : ''}`,
      })
    } else if (!res.ok) {
      recordResult({
        service: 'AniList',
        target: 'GenreCollection',
        ok: false,
        durationMs: Math.round(performance.now() - t0),
        error: `HTTP ${res.status} (${res.statusText})`,
      })
    } else {
      const json = await res.json()
      const durationMs = Math.round(performance.now() - t0)
      if (json.errors?.length) {
        recordResult({
          service: 'AniList',
          target: 'GenreCollection',
          ok: false,
          durationMs,
          error: `GraphQL error: ${json.errors[0]?.message}`,
        })
      } else {
        const parsed = z.array(z.string()).safeParse(json.data?.GenreCollection)
        if (!parsed.success) {
          recordResult({
            service: 'AniList',
            target: 'GenreCollection',
            ok: false,
            durationMs,
            error: 'Payload failed Zod genre schema validation',
          })
        } else {
          recordResult({
            service: 'AniList',
            target: 'GenreCollection',
            ok: true,
            durationMs,
            details: `Validated ${parsed.data.length} genres`,
          })
        }
      }
    }
  } catch (err) {
    recordResult({
      service: 'AniList',
      target: 'GenreCollection',
      ok: false,
      durationMs: Math.round(performance.now() - t0),
      error: errorMessage(err),
    })
  }

  // Check 2: Home Rails (mirrors production alHome() query with perPage:14)
  const t1 = performance.now()
  try {
    const s = currentSeason()
    const n = nextSeasonOf()
    const query = `
      query($season:MediaSeason,$year:Int,$nseason:MediaSeason,$nyear:Int){
        trending: Page(perPage:14){ media(sort:TRENDING_DESC, type:ANIME, isAdult:false){ ...media } }
        season: Page(perPage:14){ media(sort:POPULARITY_DESC, type:ANIME, isAdult:false, season:$season, seasonYear:$year){ ...media } }
        allTime: Page(perPage:14){ media(sort:POPULARITY_DESC, type:ANIME, isAdult:false){ ...media } }
        topRated: Page(perPage:14){ media(sort:SCORE_DESC, type:ANIME, isAdult:false){ ...media } }
        upcoming: Page(perPage:14){ media(sort:POPULARITY_DESC, type:ANIME, isAdult:false, status:NOT_YET_RELEASED, season:$nseason, seasonYear:$nyear){ ...media } }
      }
      ${MEDIA_FRAGMENT}
    `
    const variables = { season: s.season, year: s.year, nseason: n.season, nyear: n.year }

    const res = await fetch(ANILIST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15_000),
    })

    if (res.status === 429) {
      const retryAfter = res.headers.get('retry-after')
      recordResult({
        service: 'AniList',
        target: 'Home Rails',
        ok: false,
        durationMs: Math.round(performance.now() - t1),
        error: `Rate limit exceeded (HTTP 429)${retryAfter ? `, Retry-After: ${retryAfter}s` : ''}`,
      })
    } else if (!res.ok) {
      recordResult({
        service: 'AniList',
        target: 'Home Rails',
        ok: false,
        durationMs: Math.round(performance.now() - t1),
        error: `HTTP ${res.status} (${res.statusText})`,
      })
    } else {
      const json = await res.json()
      const durationMs = Math.round(performance.now() - t1)
      if (json.errors?.length) {
        recordResult({
          service: 'AniList',
          target: 'Home Rails',
          ok: false,
          durationMs,
          error: `GraphQL error: ${json.errors[0]?.message}`,
        })
      } else {
        const parsed = homeShape.safeParse(json.data)
        if (!parsed.success) {
          recordResult({
            service: 'AniList',
            target: 'Home Rails',
            ok: false,
            durationMs,
            error: 'Payload failed Zod home rails schema validation',
          })
        } else {
          const totalItems =
            parsed.data.trending.media.length +
            parsed.data.season.media.length +
            parsed.data.allTime.media.length +
            parsed.data.topRated.media.length +
            parsed.data.upcoming.media.length
          recordResult({
            service: 'AniList',
            target: 'Home Rails',
            ok: true,
            durationMs,
            details: `Validated 5 rails (${totalItems} total media items)`,
          })
        }
      }
    }
  } catch (err) {
    recordResult({
      service: 'AniList',
      target: 'Home Rails',
      ok: false,
      durationMs: Math.round(performance.now() - t1),
      error: errorMessage(err),
    })
  }
}

async function runAniSourceChecks() {
  console.log(`\n--- 2. Testing Live AniSource API (${ANISOURCE_BASE}) ---`)

  // Check 1: Health with bounded cold-start wake-up polling
  const overallHealthStart = performance.now()

  for (let attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt += 1) {
    const attemptStart = performance.now()
    try {
      const res = await fetch(`${ANISOURCE_BASE}/health`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(HEALTH_ATTEMPT_TIMEOUT_MS),
      })

      const attemptDurationMs = Math.round(performance.now() - attemptStart)
      if (!res.ok) {
        const canRetry = attempt < HEALTH_ATTEMPTS && TRANSIENT_HEALTH_STATUSES.has(res.status)
        if (canRetry) {
          await new Promise((resolve) => setTimeout(resolve, HEALTH_RETRY_DELAY_MS))
          continue
        }

        recordResult({
          service: 'AniSource',
          target: '/health',
          ok: false,
          durationMs: Math.round(performance.now() - overallHealthStart),
          error: `HTTP ${res.status} (${res.statusText}) on attempt ${attempt}/${HEALTH_ATTEMPTS}`,
        })
        break
      }

      let json
      try {
        json = await res.json()
      } catch {
        recordResult({
          service: 'AniSource',
          target: '/health',
          ok: false,
          durationMs: Math.round(performance.now() - overallHealthStart),
          error: 'AniSource returned malformed JSON for /health',
        })
        break
      }

      const totalDurationMs = Math.round(performance.now() - overallHealthStart)
      const parsed = healthResponseSchema.safeParse(json)
      if (!parsed.success) {
        recordResult({
          service: 'AniSource',
          target: '/health',
          ok: false,
          durationMs: totalDurationMs,
          error: 'Payload failed Zod health response schema',
        })
      } else {
        const isProbableColdStart = attempt > 1 || attemptDurationMs >= 4_000
        const coldStartNote = isProbableColdStart
          ? ` (probable cold start wake-up, attempt ${attempt}/${HEALTH_ATTEMPTS}, attempt latency ${attemptDurationMs}ms)`
          : ''
        recordResult({
          service: 'AniSource',
          target: '/health',
          ok: true,
          durationMs: totalDurationMs,
          details: `v${parsed.data.version}, ${parsed.data.active_sources} active sources${coldStartNote}`,
        })
      }
      break
    } catch (err) {
      if (attempt < HEALTH_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, HEALTH_RETRY_DELAY_MS))
        continue
      }
      recordResult({
        service: 'AniSource',
        target: '/health',
        ok: false,
        durationMs: Math.round(performance.now() - overallHealthStart),
        error: `${errorMessage(err)} (after ${HEALTH_ATTEMPTS} attempts)`,
      })
      break
    }
  }

  // Check 2: Sources list
  let firstSourceId = null
  const t1 = performance.now()
  try {
    const res = await fetch(`${ANISOURCE_BASE}/api/v1/sources`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) {
      recordResult({
        service: 'AniSource',
        target: '/api/v1/sources',
        ok: false,
        durationMs: Math.round(performance.now() - t1),
        error: `HTTP ${res.status} (${res.statusText})`,
      })
    } else {
      const json = await res.json()
      const durationMs = Math.round(performance.now() - t1)
      const parsed = sourceListResponseSchema.safeParse(json)
      if (!parsed.success) {
        recordResult({
          service: 'AniSource',
          target: '/api/v1/sources',
          ok: false,
          durationMs,
          error: 'Payload failed Zod sources schema',
        })
      } else if (parsed.data.sources.length === 0) {
        recordResult({
          service: 'AniSource',
          target: '/api/v1/sources',
          ok: false,
          durationMs,
          error: 'Zero sources returned',
        })
      } else {
        firstSourceId = parsed.data.sources[0].id
        const names = parsed.data.sources.map((s) => s.id).join(', ')
        recordResult({
          service: 'AniSource',
          target: '/api/v1/sources',
          ok: true,
          durationMs,
          details: `${parsed.data.sources.length} sources active [${names}]`,
        })
      }
    }
  } catch (err) {
    recordResult({
      service: 'AniSource',
      target: '/api/v1/sources',
      ok: false,
      durationMs: Math.round(performance.now() - t1),
      error: errorMessage(err),
    })
  }

  // Check 3: Search test using the first source
  if (firstSourceId) {
    const t2 = performance.now()
    const query = 'Cowboy Bebop'
    try {
      const searchUrl = `${ANISOURCE_BASE}/api/v1/${encodeURIComponent(firstSourceId)}/search?q=${encodeURIComponent(query)}&page=1`
      const res = await fetch(searchUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      })

      if (!res.ok) {
        recordResult({
          service: 'AniSource',
          target: `search (${firstSourceId})`,
          ok: false,
          durationMs: Math.round(performance.now() - t2),
          error: `HTTP ${res.status} (${res.statusText})`,
        })
      } else {
        const json = await res.json()
        const durationMs = Math.round(performance.now() - t2)
        const parsed = searchResponseSchema.safeParse(json)
        if (!parsed.success) {
          recordResult({
            service: 'AniSource',
            target: `search (${firstSourceId})`,
            ok: false,
            durationMs,
            error: 'Payload failed Zod search schema',
          })
        } else {
          recordResult({
            service: 'AniSource',
            target: `search (${firstSourceId})`,
            ok: true,
            durationMs,
            details: `Found ${parsed.data.items.length} candidates for "${query}"`,
          })
        }
      }
    } catch (err) {
      recordResult({
        service: 'AniSource',
        target: `search (${firstSourceId})`,
        ok: false,
        durationMs: Math.round(performance.now() - t2),
        error: errorMessage(err),
      })
    }
  } else {
    recordResult({
      service: 'AniSource',
      target: 'search',
      ok: false,
      durationMs: 0,
      error: 'Skipped search check because no source was available',
    })
  }
}

function escapeMarkdown(text) {
  if (!text) return ''
  return String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function writeSummary() {
  const allPassed = results.every((r) => r.ok)
  const total = results.length
  const passed = results.filter((r) => r.ok).length
  const failed = total - passed

  console.log(`\n========================================`)
  console.log(`Live Smoke Summary: ${passed}/${total} passed (${failed} failed)`)
  console.log(`Overall: ${allPassed ? 'PASSED ✅' : 'FAILED ❌'}`)
  console.log(`========================================\n`)

  if (STEP_SUMMARY_FILE) {
    let md = `## 🌐 Live Operational Smoke Results\n\n`
    md += `**Status:** ${allPassed ? '🟢 All endpoints operational' : '🔴 One or more live checks failed'}\n`
    md += `**Passed:** ${passed}/${total} checks\n\n`
    md += `| Service | Target / Endpoint | Status | Latency | Details / Error |\n`
    md += `|---|---|---|---|---|\n`
    for (const r of results) {
      const statusIcon = r.ok ? '✅ PASS' : '❌ FAIL'
      const time = `${(r.durationMs / 1000).toFixed(2)}s`
      const info = escapeMarkdown(r.ok ? r.details : `⚠️ ${r.error}`)
      md += `| ${escapeMarkdown(r.service)} | \`${escapeMarkdown(r.target)}\` | ${statusIcon} | ${time} | ${info} |\n`
    }
    md += `\n*Note: This operational smoke runs on a schedule and does not block PR verification gates.*\n`
    try {
      appendFileSync(STEP_SUMMARY_FILE, md, 'utf8')
    } catch (err) {
      console.error('Failed to write GitHub Step Summary:', err)
    }
  }

  return allPassed
}

async function main() {
  await runAniListChecks()
  await runAniSourceChecks()
  const success = writeSummary()
  process.exit(success ? 0 : 1)
}

main().catch((err) => {
  console.error('Fatal live smoke error:', err)
  process.exit(1)
})
