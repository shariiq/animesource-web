import { closeDb } from './indexedDb'
import { browserSearchHistory } from './searchHistory'
import {
  continueDoc,
  continueItemSchema,
  favoriteItemSchema,
  favoritesDoc,
  matchDoc,
  matchItemSchema,
  prefSourceDoc,
  searchHistoryDoc,
  searchHistoryItemSchema,
  type ContinueItem,
  type FavoriteItem,
  type MatchItem,
  type SearchHistoryItem,
} from './schema'
import { browserViewerData } from './viewer'

export {
  closeDb,
  continueDoc,
  continueItemSchema,
  favoriteItemSchema,
  favoritesDoc,
  matchDoc,
  matchItemSchema,
  prefSourceDoc,
  searchHistoryDoc,
  searchHistoryItemSchema,
}
export type { ContinueItem, FavoriteItem, MatchItem, SearchHistoryItem }

export const getFavorites = browserViewerData.getFavorites
export const setFavorites = browserViewerData.setFavorites
export const toggleFavorite = browserViewerData.toggleFavorite
export const getContinue = browserViewerData.getContinue
export const recordContinue = browserViewerData.recordContinue
export const getPreferredSource = browserViewerData.getPreferredSource
export const setPreferredSource = browserViewerData.setPreferredSource
export const getSavedMatch = browserViewerData.getSavedMatch
export const saveMatch = browserViewerData.saveMatch
export const clearSavedMatch = browserViewerData.clearSavedMatch
export const getSearchHistory = browserSearchHistory.get
export const recordSearch = browserSearchHistory.record
export const clearSearchHistory = browserSearchHistory.clear
