import { closeDb } from './indexedDb'
import { browserSearchHistory } from './searchHistory'
import {
  continueDoc,
  continueItemSchema,
  favoriteItemSchema,
  favoriteStatusSchema,
  favoritesDoc,
  matchDoc,
  matchItemSchema,
  prefSourceDoc,
  searchHistoryDoc,
  searchHistoryItemSchema,
  type ContinueItem,
  type FavoriteItem,
  type FavoriteStatus,
  type MatchItem,
  type SearchHistoryItem,
} from './schema'
import { browserViewerData, type ContinueDraft, type FavoriteDraft, type PlaybackProgress } from './viewer'

export {
  closeDb,
  continueDoc,
  continueItemSchema,
  favoriteItemSchema,
  favoriteStatusSchema,
  favoritesDoc,
  matchDoc,
  matchItemSchema,
  prefSourceDoc,
  searchHistoryDoc,
  searchHistoryItemSchema,
}
export type { ContinueDraft, ContinueItem, FavoriteItem, FavoriteStatus, FavoriteDraft, MatchItem, PlaybackProgress, SearchHistoryItem }

export const getFavorites = browserViewerData.getFavorites
export const setFavorites = browserViewerData.setFavorites
export const toggleFavorite = browserViewerData.toggleFavorite
export const updateFavoriteStatus = browserViewerData.updateFavoriteStatus
export const removeFavorite = browserViewerData.removeFavorite
export const getContinue = browserViewerData.getContinue
export const recordContinue = browserViewerData.recordContinue
export const updateProgress = browserViewerData.updateProgress
export const markEpisodeComplete = browserViewerData.markEpisodeComplete
export const removeContinue = browserViewerData.removeContinue
export const clearContinue = browserViewerData.clearContinue
export const getPreferredSource = browserViewerData.getPreferredSource
export const setPreferredSource = browserViewerData.setPreferredSource
export const getSavedMatch = browserViewerData.getSavedMatch
export const saveMatch = browserViewerData.saveMatch
export const clearSavedMatch = browserViewerData.clearSavedMatch
export const getSearchHistory = browserSearchHistory.get
export const recordSearch = browserSearchHistory.record
export const clearSearchHistory = browserSearchHistory.clear
