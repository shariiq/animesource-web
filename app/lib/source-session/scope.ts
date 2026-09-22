/**
 * Shared request-lifecycle machinery for source-driven sessions (watch, reader).
 * A scope tracks in-flight operations on a generation counter: invalidating the
 * scope marks every earlier operation stale so late responses are ignored, and
 * disposal aborts everything still running.
 */

export interface ScopeOperation {
  /** Generation the operation was started on. */
  readonly id: number
  readonly signal: AbortSignal
}

export interface CancellableScope {
  /** Invalidate all in-flight operations (aborting them), then begin a new one. */
  restart(): ScopeOperation
  /** Invalidate and abort every in-flight operation. */
  cancelAll(): void
  /** True while the operation belongs to the live generation and is unaborted. */
  current(operation: ScopeOperation): boolean
  /** Untrack an operation that has settled. */
  finish(operation: ScopeOperation): void
  /** Abort everything and reject all future operations. */
  dispose(): void
  readonly disposed: boolean
}

export function createCancellableScope(): CancellableScope {
  let generation = 0
  let disposed = false
  const controllers = new Set<AbortController>()

  const begin = (): ScopeOperation => {
    const controller = new AbortController()
    controllers.add(controller)
    return { id: generation, signal: controller.signal }
  }

  const cancelAll = (): void => {
    generation += 1
    for (const controller of controllers) controller.abort()
    controllers.clear()
  }

  return {
    restart(): ScopeOperation {
      cancelAll()
      return begin()
    },
    cancelAll,
    current: (operation) => !disposed && operation.id === generation && !operation.signal.aborted,
    finish(operation) {
      for (const controller of controllers) {
        if (controller.signal === operation.signal) {
          controllers.delete(controller)
          break
        }
      }
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      cancelAll()
    },
    get disposed() {
      return disposed
    },
  }
}
