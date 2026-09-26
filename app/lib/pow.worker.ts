import {
  countLeadingZeroBits,
  powSolutionPreimage,
  type PowWorkerResult,
  type PowWorkerTask,
} from './proofOfWork'

/**
 * Proof-of-work search worker: runs one nonce stride off the main thread.
 * Bundled by Vite as a separate chunk via `new Worker(new URL(...))`; it
 * imports only the pure hash primitives, so no hosts, secrets, or DOM ever
 * enter this chunk (the boundary check enforces it).
 */
const scope = self as unknown as {
  onmessage: ((event: { data: PowWorkerTask }) => void) | null
  postMessage: (message: PowWorkerResult) => void
}

scope.onmessage = (event) => {
  const task = event.data
  let nonce = task.fromNonce
  let remaining = task.attempts
  for (;;) {
    if (countLeadingZeroBits(powSolutionPreimage(task.challengeId, nonce, task.binding)) >= task.difficulty) {
      scope.postMessage({ type: 'found', nonce })
      return
    }
    if (remaining !== null) {
      remaining -= 1
      if (remaining <= 0) {
        scope.postMessage({ type: 'exhausted' })
        return
      }
    }
    nonce += task.stride
  }
}
