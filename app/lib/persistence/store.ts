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
  type PlaybackPreferences as PlaybackPreferenceValues,
  type PlaybackRecord,
  type SearchHistoryItem,
} from './schema'
import { viewerData } from './active'
import type { ContinueDraft, FavoriteDraft, PlaybackDraft, PlaybackProgress } from './viewer'

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
export type { ContinueDraft, ContinueItem, FavoriteItem, FavoriteStatus, FavoriteDraft, MatchItem, PlaybackDraft, PlaybackPreferenceValues, PlaybackProgress, PlaybackRecord, SearchHistoryItem }
export type { ViewerExport, ViewerPreferences, ViewerProfile } from './schema'

export const getFavorites = viewerData.getFavorites
export const setFavorites = viewerData.setFavorites
export const toggleFavorite = viewerData.toggleFavorite
export const updateFavoriteStatus = viewerData.updateFavoriteStatus
export const removeFavorite = viewerData.removeFavorite
export const getContinue = viewerData.getContinue
export const recordContinue = viewerData.recordContinue
export const getPlaybackRecord = viewerData.getPlaybackRecord
export const recordPlayback = viewerData.recordPlayback
export const updateProgress = viewerData.updateProgress
export const markEpisodeComplete = viewerData.markEpisodeComplete
export const removeContinue = viewerData.removeContinue
export const clearContinue = viewerData.clearContinue
export const getPlaybackPreferences = viewerData.getPlaybackPreferences
export const setPlaybackPreferences = viewerData.setPlaybackPreferences
export const getPreferredSource = viewerData.getPreferredSource
export const setPreferredSource = viewerData.setPreferredSource
export const getSavedMatch = viewerData.getSavedMatch
export const saveMatch = viewerData.saveMatch
export const clearSavedMatch = viewerData.clearSavedMatch
export const getViewerProfile = viewerData.getViewerProfile
export const setViewerProfile = viewerData.setViewerProfile
export const getViewerPreferences = viewerData.getViewerPreferences
export const setViewerPreferences = viewerData.setViewerPreferences
export const exportViewerData = viewerData.exportViewerData
export const importViewerData = viewerData.importViewerData
export const clearViewerData = viewerData.clearViewerData
export const getSearchHistory = browserSearchHistory.get
export const recordSearch = browserSearchHistory.record
export const clearSearchHistory = browserSearchHistory.clear
