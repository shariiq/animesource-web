import { describe, expect, it, vi } from 'vitest'
import {
  countLeadingZeroBits,
  fromBase64Url,
  hmacSha256,
  powAttemptHash,
  powStrideStart,
  solvePowChallenge,
  toBase64Url,
  type PowWorkerPort,
  type PowWorkerTask,
} from '../app/lib/proofOfWork'

const hex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
const ascii = (text: string): Uint8Array => new TextEncoder().encode(text)

describe('proof-of-work primitives', () => {
  it('matches RFC 4231 HMAC-SHA-256 vectors', () => {
    expect(hex(hmacSha256(new Uint8Array(20).fill(0x0b), ascii('Hi There')))).toBe(
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    )
    expect(hex(hmacSha256(ascii('Jefe'), ascii('what do ya want for nothing?')))).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    )
  })

  it('round-trips base64url without padding', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255])
    expect([...fromBase64Url(toBase64Url(bytes))]).toEqual([...bytes])
  })

  it('counts leading zero bits, not hex chars', () => {
    expect(countLeadingZeroBits(new Uint8Array([0x00, 0x00, 0x01]))).toBe(23)
    expect(countLeadingZeroBits(new Uint8Array([0x0f]))).toBe(4)
    expect(countLeadingZeroBits(new Uint8Array([0x10]))).toBe(3)
    expect(countLeadingZeroBits(new Uint8Array([0x80]))).toBe(0)
    expect(countLeadingZeroBits(new Uint8Array([0xff]))).toBe(0)
  })

  it('finds nonces whose attempt hash meets the difficulty', async () => {
    const { nonce } = await solvePowChallenge('unit-challenge', 10)
    expect(countLeadingZeroBits(powAttemptHash('unit-challenge', nonce))).toBeGreaterThanOrEqual(10)
  })

  it('solves from a pinned start without touching timing', async () => {
    const first = await solvePowChallenge('pinned', 8, { fromNonce: 0 })
    const second = await solvePowChallenge('pinned', 8, { fromNonce: first.nonce + 1 })
    expect(second.nonce).toBeGreaterThan(first.nonce)
    expect(countLeadingZeroBits(powAttemptHash('pinned', second.nonce))).toBeGreaterThanOrEqual(8)
  })

  it('fails loudly past the attempt cap instead of spinning forever', async () => {
    const { nonce } = await solvePowChallenge('capped', 8, { fromNonce: 0, maxAttempts: 50_000 })
    const needed = nonce + 1
    await expect(solvePowChallenge('capped', 8, { fromNonce: 0, maxAttempts: needed })).resolves.toMatchObject({ nonce })
    let outside = nonce + 1
    while (countLeadingZeroBits(powAttemptHash('capped', outside)) >= 8) outside += 1
    await expect(solvePowChallenge('capped', 8, { fromNonce: outside, maxAttempts: 1 })).rejects.toThrow(/exceeded/)
    await expect(solvePowChallenge('capped', 8, { maxAttempts: 0 })).rejects.toThrow(/attempt cap/)
    await expect(solvePowChallenge('capped', 8, { maxAttempts: 1.5 })).rejects.toThrow(/attempt cap/)
  })

  it('partitions nonces across strides with no overlap and no gaps', () => {
    expect([powStrideStart(0, 100), powStrideStart(1, 100), powStrideStart(3, 100)]).toEqual([100, 101, 103])
  })

  it('races worker strides and terminates the losers', async () => {
    class FakeWorker implements PowWorkerPort {
      terminated = false
      private handler: ((event: { data: { type: 'found'; nonce: number } | { type: 'exhausted' } }) => void) | null = null
      private failer: (() => void) | null = null
      constructor(private readonly matches: (nonce: number) => boolean, private readonly bound: number) {}
      set onmessage(handler: ((event: { data: { type: 'found'; nonce: number } | { type: 'exhausted' } }) => void) | null) {
        this.handler = handler
      }
      set onerror(handler: (() => void) | null) {
        this.failer = handler
      }
      postMessage(task: PowWorkerTask): void {
        let nonce = task.fromNonce
        const tries = task.attempts ?? this.bound
        for (let tried = 0; tried < Math.min(tries, this.bound); tried += 1, nonce += task.stride) {
          if (this.matches(nonce)) {
            this.handler?.({ data: { type: 'found', nonce } })
            return
          }
        }
        this.handler?.({ data: { type: 'exhausted' } })
      }
      terminate(): void {
        this.terminated = true
      }
    }

    const workers: FakeWorker[] = []
    const { nonce } = await solvePowChallenge('race', 8, {
      workers: 4,
      maxAttempts: 100_000,
      createWorker: () => {
        const worker = new FakeWorker((value) => value % 13 === 7, 5000)
        workers.push(worker)
        return worker
      },
    })
    expect(nonce % 13).toBe(7)
    expect(nonce % 4).toBe(0)
    expect(workers).toHaveLength(4)
    expect(workers.every((worker) => worker.terminated)).toBe(true)
  })

  it('rejects when every worker exhausts its cap', async () => {
    await expect(solvePowChallenge('capped', 8, {
      workers: 2,
      maxAttempts: 200,
      createWorker: () => ({
        postMessage: (task: PowWorkerTask) => {
          void task
        },
        terminate: () => undefined,
        set onmessage(handler: ((event: { data: { type: 'found'; nonce: number } | { type: 'exhausted' } }) => void) | null) {
          handler?.({ data: { type: 'exhausted' } })
        },
        set onerror(_handler: (() => void) | null) {},
      }),
    })).rejects.toThrow(/exceeded/)
  })

  it('falls back to sequential search when workers cannot be built', async () => {
    const { nonce } = await solvePowChallenge('fallback', 8, {
      workers: 4,
      createWorker: () => {
        throw new Error('no workers here')
      },
    })
    expect(countLeadingZeroBits(powAttemptHash('fallback', nonce))).toBeGreaterThanOrEqual(8)
  })

  it('rejects invalid challenges and honours aborts', async () => {
    await expect(solvePowChallenge('', 8)).rejects.toThrow()
    await expect(solvePowChallenge('x', 0)).rejects.toThrow()
    await expect(solvePowChallenge('x', 257)).rejects.toThrow()
    const controller = new AbortController()
    controller.abort()
    await expect(solvePowChallenge('x', 24, { signal: controller.signal })).rejects.toThrow(/cancelled/)
    vi.useFakeTimers()
    try {
      const running = new AbortController()
      const pending = solvePowChallenge('slow', 40, { signal: running.signal })
      const assertion = expect(pending).rejects.toThrow(/cancelled/)
      running.abort()
      await vi.advanceTimersByTimeAsync(10)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })
})
