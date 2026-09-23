import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { URL } from 'node:url'

const staticRoot = resolve('.vercel/output/static')
const forbiddenHosts = new Set(['anisource-api.vercel.app'])
const configuredBase = process.env.ANISOURCE_BASE

if (configuredBase) {
  try {
    const url = new URL(configuredBase)
    if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
      forbiddenHosts.add(url.host.toLowerCase())
    }
  } catch {
    throw new Error('ANISOURCE_BASE must be a valid absolute URL.')
  }
}

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? filesIn(path) : [path]
  }))
  return nested.flat()
}

const files = await filesIn(staticRoot)
if (files.length === 0) throw new Error(`No built static assets found in ${staticRoot}`)

const leaks = []
for (const file of files) {
  const contents = await readFile(file, 'utf8')
  for (const host of forbiddenHosts) {
    if (host && contents.toLowerCase().includes(host)) leaks.push({ file, host })
  }
}

if (leaks.length) {
  throw new Error(`AniSource host leaked into browser assets: ${leaks.map(({ file, host }) => `${file} (${host})`).join(', ')}`)
}

console.log(`Verified ${files.length} static assets contain no AniSource API host.`)
