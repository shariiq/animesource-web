import { notifySearchHistoryChanged } from '../search'
import { indexedDbStore } from './indexedDb'
import {
  searchHistoryDoc,
  type SearchHistoryItem,
} from './schema'

const SEARCH_HISTORY = 'searchHistory'
const SEARCH_HISTORY_LIMIT = 8

export type { SearchHistoryItem }

export interface SearchHistory {
  get(): Promise<SearchHistoryItem[]>
  record(query: string): Promise<void>
  clear(): Promise<void>
  replace(items: SearchHistoryItem[]): Promise<void>
}

async function get(): Promise<SearchHistoryItem[]> {
  return (await indexedDbStore.read(SEARCH_HISTORY, searchHistoryDoc)) ?? []
}

async function record(query: string): Promise<void> {
  const normalized = query.trim()
  if (!normalized || normalized.length > 100) return
  const key = normalized.toLocaleLowerCase()
  const items = (await get()).filter((item) => item.query.toLocaleLowerCase() !== key)
  items.unshift({ query: normalized, ts: Date.now() })
  await indexedDbStore.write(SEARCH_HISTORY, 1, items.slice(0, SEARCH_HISTORY_LIMIT), searchHistoryDoc)
  notifySearchHistoryChanged()
}

async function clear(): Promise<void> {
  await indexedDbStore.remove(SEARCH_HISTORY)
  notifySearchHistoryChanged()
}

async function replace(items: SearchHistoryItem[]): Promise<void> {
  await indexedDbStore.write(SEARCH_HISTORY, 1, items.slice(0, SEARCH_HISTORY_LIMIT), searchHistoryDoc)
  notifySearchHistoryChanged()
}

export const browserSearchHistory: SearchHistory = { get, record, clear, replace }
