export interface ImageLoadHandle {
  complete: () => void
  cancel: () => void
}

export interface ImageLoadOptions {
  /** Page index used to order visible loads around the current viewport. */
  index?: number
  /** Lower values start first for non-page work such as image preloads. */
  priority?: number
}

/** Opportunistic work must not outrank a real page load. */
export const IMAGE_PRELOAD_PRIORITY = Number.MAX_SAFE_INTEGER

type QueueEntry = {
  state: 'queued' | 'active' | 'done'
  start: (complete: () => void) => void
  index: number | undefined
  explicitPriority: number
  priority: number
  seq: number
}

/** Bounds concurrent image work while keeping pending pages viewport-first. */
export function createImageLoadQueue(limit = 2) {
  const pending: QueueEntry[] = []
  const entries = new Set<QueueEntry>()
  let active = 0
  let seq = 0
  let viewportIndex = 0

  function priorityFor(entry: QueueEntry): number {
    return entry.index === undefined ? entry.explicitPriority : Math.abs(entry.index - viewportIndex)
  }

  function sortPending(): void {
    pending.sort((left, right) => left.priority - right.priority || left.seq - right.seq)
  }

  function finish(entry: QueueEntry): void {
    if (entry.state === 'done') return
    if (entry.state === 'active') active -= 1
    entry.state = 'done'
    entries.delete(entry)
    const pendingIndex = pending.indexOf(entry)
    if (pendingIndex >= 0) pending.splice(pendingIndex, 1)
    drain()
  }

  function drain(): void {
    while (active < limit && pending.length > 0) {
      const entry = pending.shift()
      if (!entry || entry.state !== 'queued') continue
      entry.state = 'active'
      active += 1
      entry.start(() => finish(entry))
    }
  }

  function enqueue(start: QueueEntry['start'], options: ImageLoadOptions = {}): ImageLoadHandle {
    const entry: QueueEntry = {
      state: 'queued',
      start,
      index: options.index,
      explicitPriority: options.priority ?? IMAGE_PRELOAD_PRIORITY,
      priority: 0,
      seq: seq++,
    }
    entry.priority = priorityFor(entry)
    entries.add(entry)
    pending.push(entry)
    sortPending()
    drain()
    return {
      complete: () => finish(entry),
      cancel: () => finish(entry),
    }
  }

  return {
    enqueue,
    setViewportIndex(index: number): void {
      if (!Number.isFinite(index)) return
      const next = Math.max(0, Math.trunc(index))
      if (next === viewportIndex) return
      viewportIndex = next
      for (const entry of pending) {
        if (entry.index !== undefined) entry.priority = priorityFor(entry)
      }
      sortPending()
    },
    clear(): void {
      for (const entry of entries) entry.state = 'done'
      entries.clear()
      pending.length = 0
      active = 0
    },
  }
}
