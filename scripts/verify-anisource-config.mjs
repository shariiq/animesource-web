// Fails loudly when the AniSource server environment cannot serve Watch and
// Manga Reader, naming the exact variable. Run before promoting a deployment
// (CI never has production secrets, so this stays out of `bun run verify`):
//   node scripts/verify-anisource-config.mjs --env production
import { Buffer } from 'node:buffer'
import { URL } from 'node:url'

const argv = process.argv.slice(2)
const flagIndex = argv.findIndex((arg) => arg === '--env' || arg.startsWith('--env='))
const flagValue = flagIndex < 0
  ? null
  : argv[flagIndex].includes('=')
    ? argv[flagIndex].slice('--env='.length)
    : argv[flagIndex + 1] ?? null
const env = (flagValue ?? process.env.NODE_ENV ?? 'development').toLowerCase()
const enforced = env === 'production' || env === 'preview'

const problems = []
const byteLength = (value) => Buffer.byteLength(value, 'utf8')

const base = process.env.ANISOURCE_BASE
if (base) {
  let parsed = null
  try {
    parsed = new URL(base)
  } catch {
    problems.push('ANISOURCE_BASE must be a valid absolute URL.')
  }
  if (parsed && !['http:', 'https:'].includes(parsed.protocol)) {
    problems.push('ANISOURCE_BASE must use http(s).')
  }
  if (parsed && env === 'production' && parsed.protocol !== 'https:') {
    problems.push('ANISOURCE_BASE must use https in production.')
  }
}

const serviceToken = process.env.ANISOURCE_SERVICE_TOKEN
if (!serviceToken && enforced) {
  problems.push('ANISOURCE_SERVICE_TOKEN is required: it must match the API MEDIA_API_SERVICE_TOKEN.')
} else if (serviceToken && byteLength(serviceToken) < 32) {
  problems.push('ANISOURCE_SERVICE_TOKEN must contain at least 32 bytes.')
}

const sessionSecret = process.env.ANISOURCE_SESSION_SECRET
if (!sessionSecret && enforced) {
  problems.push('ANISOURCE_SESSION_SECRET is required: sessions and media tickets cannot be signed without it.')
} else if (sessionSecret && byteLength(sessionSecret) < 32) {
  problems.push('ANISOURCE_SESSION_SECRET must contain at least 32 bytes.')
}

const redisUrl = process.env.UPSTASH_REDIS_REST_URL
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN
if ((!redisUrl || !redisToken) && enforced) {
  problems.push('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must both be set: the gateway fails closed without rate limiting.')
} else if ((redisUrl && !redisToken) || (!redisUrl && redisToken)) {
  problems.push('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set together.')
} else if (redisUrl) {
  try {
    if (new URL(redisUrl).protocol !== 'https:') throw new Error('insecure')
  } catch {
    problems.push('UPSTASH_REDIS_REST_URL must be a valid https URL.')
  }
}

const directMedia = process.env.ANISOURCE_DIRECT_MEDIA
const directEnabled = directMedia === '1' || directMedia?.toLowerCase() === 'true' || directMedia?.toLowerCase() === 'yes'
const playbackSecrets = (process.env.ANISOURCE_PLAYBACK_SECRETS ?? '')
  .split(',')
  .map((entry) => entry.trim())
  .filter((entry) => Buffer.byteLength(entry, 'utf8') >= 32)
if (directEnabled && enforced && playbackSecrets.length === 0) {
  problems.push('ANISOURCE_PLAYBACK_SECRETS is required when ANISOURCE_DIRECT_MEDIA is on: direct media URLs must be session-bound (ADR 0006).')
}

for (const [name] of Object.entries(process.env)) {
  if (/^VITE_(ANISOURCE|UPSTASH)_/i.test(name)) {
    problems.push(`${name} ships its value to every visitor: server secrets must never use the VITE_ prefix.`)
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`access-config: ${problem}`)
  process.exit(1)
}

console.log(`access-config: AniSource server environment is complete for '${env}'.`)
