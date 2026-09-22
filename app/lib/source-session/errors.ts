import { AniSourceError } from '../../data/anisource/client'

/** Catalog-level failure classification shared by the watch and reader sessions. */
export type SourceFailureKind = 'network' | 'timeout' | 'invalid' | 'unavailable' | 'expired' | 'cancelled'

export interface SourceFailure {
  readonly kind: SourceFailureKind
  readonly retryable: boolean
  readonly message: string
}

/**
 * Maps an AniSource transport error to a user-facing failure description.
 * Sessions translate the generic kind into their own error vocabulary.
 */
export function describeSourceFailure(cause: unknown, operation: string): SourceFailure {
  if (cause instanceof AniSourceError) {
    if (cause.kind === 'cancelled') {
      return { kind: 'cancelled', retryable: false, message: 'The request was cancelled.' }
    }
    if (cause.kind === 'timeout') {
      return {
        kind: 'timeout',
        retryable: true,
        message: `The source is taking too long to respond (${operation}). It may be waking up — retry in a few seconds.`,
      }
    }
    if (cause.kind === 'network') {
      return {
        kind: 'network',
        retryable: true,
        message: `Network error while ${operation}. Check your connection and retry.`,
      }
    }
    if (cause.kind === 'http' && cause.status !== undefined && [502, 503, 504].includes(cause.status)) {
      return {
        kind: 'unavailable',
        retryable: true,
        message: `The selected source is unavailable while ${operation}. Choose another source.`,
      }
    }
    if (
      cause.kind === 'http' &&
      operation === 'streams' &&
      cause.status !== undefined &&
      [401, 403, 410].includes(cause.status)
    ) {
      return {
        kind: 'expired',
        retryable: true,
        message: 'The stream links expired. Refresh the stream list.',
      }
    }
    if (
      cause.kind === 'http' &&
      operation === 'streams' &&
      /expired|unauthori[sz]ed/i.test(cause.message)
    ) {
      return {
        kind: 'expired',
        retryable: true,
        message: 'The stream links expired. Refresh the stream list.',
      }
    }
    if (cause.kind === 'invalid') {
      return {
        kind: 'invalid',
        retryable: false,
        message: `The source returned an unexpected response while ${operation}.`,
      }
    }
    return { kind: 'network', retryable: true, message: `The source request failed while ${operation}.` }
  }
  return { kind: 'network', retryable: true, message: `Unexpected error while ${operation}.` }
}
