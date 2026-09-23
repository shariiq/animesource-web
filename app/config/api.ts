import defaults from '../../config/api-urls.json'

export const API_DEFAULTS = defaults

export function normalizeApiUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function configuredUrl(value: unknown, fallback: string): string {
  return normalizeApiUrl(typeof value === 'string' && value.trim() ? value : fallback)
}

export const API_URLS = {
  anilist: configuredUrl(import.meta.env.VITE_ANILIST_API_URL, defaults.anilist),
} as const
