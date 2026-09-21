export interface ImageLoadHandle {
  complete: () => void
  cancel: () => void
}

type QueueEntry = {
  state: 'queued' | 'active' | 'done'
  start: (complete: () => void) => void
}

/** Keeps image bursts small enough for source proxies while retaining parallel decode. */
export function createImageLoadQueue(limit = 2) {
  const pending: QueueEntry[] = []
  const entries = new Set<QueueEntry>()
  let active = 0

  function finish(entry: QueueEntry): void {
    if (entry.state === 'done') return
    if (entry.state === 'active') active -= 1
    entry.state = 'done'
    entries.delete(entry)
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

  function enqueue(start: QueueEntry['start']): ImageLoadHandle {
    const entry: QueueEntry = { state: 'queued', start }
    entries.add(entry)
    pending.push(entry)
    drain()
    return {
      complete: () => finish(entry),
      cancel: () => finish(entry),
    }
  }

  return {
    enqueue,
    clear(): void {
      for (const entry of entries) entry.state = 'done'
      entries.clear()
      pending.length = 0
      active = 0
    },
  }
}
