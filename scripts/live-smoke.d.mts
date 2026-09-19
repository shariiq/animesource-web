export interface FetchWithRetryOptions {
  attempts?: number
  timeoutMs: number
  headers?: Record<string, string>
  retryStatuses?: Set<number>
  fetchImpl?: typeof fetch
  sleep?: (delayMs: number) => Promise<void>
}

export interface FetchWithRetryResult {
  response?: Response
  error?: unknown
  attempt: number
}

export function fetchWithRetry(url: string, options: FetchWithRetryOptions): Promise<FetchWithRetryResult>
