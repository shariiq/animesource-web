import { indexedDbStore } from '../persistence/indexedDb'
import { mergeViewerSnapshots } from '../persistence/snapshot'
import {
  viewerSyncStatusDoc,
  type ViewerExport,
  type ViewerSyncStatus,
} from '../persistence/schema'
import type { ViewerData } from '../persistence/viewer'

const SYNC_STATUS_KEY = 'viewerSyncStatus'

const LOCAL_ONLY_STATUS: ViewerSyncStatus = {
  state: 'local-only',
  lastSyncedAt: null,
  pendingChanges: 0,
  lastError: null,
}

export interface RemoteViewerState {
  revision: string | null
  snapshot: ViewerExport | null
}

export interface RemoteViewerWrite {
  baseRevision: string | null
  snapshot: ViewerExport
}

export interface RemoteViewerWriteResult {
  revision: string
  snapshot?: ViewerExport
  partialFailures?: string[]
}

/**
 * The account transport seam. A Supabase adapter can implement this later;
 * routes and local persistence do not need to know how identity is supplied.
 */
export interface RemoteViewerAdapter {
  read(): Promise<RemoteViewerState>
  write(input: RemoteViewerWrite): Promise<RemoteViewerWriteResult>
  delete(): Promise<void>
}

export interface ViewerSyncResult {
  revision: string
  conflictsResolved: number
  pendingChanges: number
  partialFailures: string[]
}

export interface ViewerSync {
  getStatus(): Promise<ViewerSyncStatus>
  sync(): Promise<ViewerSyncResult>
  migrateLocalViewer(): Promise<ViewerSyncResult>
  deleteRemoteViewer(): Promise<void>
}

async function saveStatus(status: ViewerSyncStatus): Promise<void> {
  await indexedDbStore.write(SYNC_STATUS_KEY, 1, status, viewerSyncStatusDoc)
}

export async function getViewerSyncStatus(): Promise<ViewerSyncStatus> {
  return (await indexedDbStore.read(SYNC_STATUS_KEY, viewerSyncStatusDoc)) ?? LOCAL_ONLY_STATUS
}

function pendingChangeCount(snapshot: ViewerExport): number {
  return snapshot.favorites.length
    + snapshot.continue.length
    + snapshot.playback.length
    + snapshot.matches.length
    + snapshot.tombstones.length
    + 1
}

function countConflicts(local: ViewerExport, remote: ViewerExport): number {
  const localByKey = new Map([
    ...local.favorites.map((item) => [`favorites:${item.id}`, item.ts] as const),
    ...local.continue.map((item) => [`continue:${item.id}`, item.ts] as const),
    ...local.playback.map((item) => [`playback:${item.id}:${item.episodeId}`, item.ts] as const),
    ...local.matches.map((item) => [`matches:${item.anilistId}`, item.updatedAt] as const),
  ])
  const remoteByKey = new Map([
    ...remote.favorites.map((item) => [`favorites:${item.id}`, item.ts] as const),
    ...remote.continue.map((item) => [`continue:${item.id}`, item.ts] as const),
    ...remote.playback.map((item) => [`playback:${item.id}:${item.episodeId}`, item.ts] as const),
    ...remote.matches.map((item) => [`matches:${item.anilistId}`, item.updatedAt] as const),
  ])
  let count = 0
  for (const [key, ts] of localByKey) {
    const remoteTs = remoteByKey.get(key)
    if (remoteTs !== undefined && remoteTs !== ts) count += 1
  }
  return count
}

export function createViewerSync(viewerData: ViewerData, remote: RemoteViewerAdapter): ViewerSync {
  const runSync = async (): Promise<ViewerSyncResult> => {
    const local = await viewerData.exportViewerData()
    await saveStatus({
      state: 'syncing',
      lastSyncedAt: (await getViewerSyncStatus()).lastSyncedAt,
      pendingChanges: pendingChangeCount(local),
      lastError: null,
    })

    try {
      const current = await remote.read()
      const merged = current.snapshot ? mergeViewerSnapshots(local, current.snapshot) : local
      const conflictsResolved = current.snapshot ? countConflicts(local, current.snapshot) : 0
      const result = await remote.write({ baseRevision: current.revision, snapshot: merged })
      const partialFailures = result.partialFailures ?? []
      const savedSnapshot = result.snapshot ?? merged
      await viewerData.importViewerData(savedSnapshot, 'replace')
      const pendingChanges = partialFailures.length > 0 ? pendingChangeCount(savedSnapshot) : 0
      await saveStatus({
        state: partialFailures.length > 0 ? 'error' : 'idle',
        lastSyncedAt: partialFailures.length > 0 ? (await getViewerSyncStatus()).lastSyncedAt : Date.now(),
        pendingChanges,
        lastError: partialFailures.length > 0 ? `Some viewer data could not be saved: ${partialFailures.join(', ')}.` : null,
      })
      return { revision: result.revision, conflictsResolved, pendingChanges, partialFailures }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Viewer synchronization failed.'
      await saveStatus({
        state: 'error',
        lastSyncedAt: (await getViewerSyncStatus()).lastSyncedAt,
        pendingChanges: pendingChangeCount(local),
        lastError: message,
      })
      throw cause
    }
  }

  return {
    getStatus: getViewerSyncStatus,
    sync: runSync,
    migrateLocalViewer: runSync,
    async deleteRemoteViewer() {
      await remote.delete()
      await saveStatus(LOCAL_ONLY_STATUS)
    },
  }
}
