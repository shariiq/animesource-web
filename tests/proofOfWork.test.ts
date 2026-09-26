import { describe, expect, it, vi } from 'vitest'
import {
  attestationDigest,
  collectEnvironmentAttestation,
  countLeadingZeroBits,
  fromBase64Url,
  hmacSha256,
  powAttemptHash,
  powSolutionPreimage,
  powStrideStart,
  scoreAttestation,
  scoreRequestFingerprint,
  solvePowChallenge,
  SUSPICIOUS_ATTESTATION_SCORE,
  toBase64Url,
  workerAttemptCap,
  type PowAttestation,
  type PowWorkerPort,
  type PowWorkerTask,
} from '../app/lib/proofOfWork'

const hex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
const ascii = (text: string): Uint8Array => new TextEncoder().encode(text)

const TEST_ATTESTATION: PowAttestation = {
  webdriver: false,
  userAgent: 'test-agent',
  plugins: 1,
  languages: 1,
  hardwareConcurrency: 2,
  screenWidth: 100,
  screenHeight: 100,
  touchPoints: 0,
  mobile: false,
}

describe('proof-of-work primitives', () => {
  type WorkerEvent = { type: 'found'; nonce: number } | { type: 'exhausted' }

  class FakeWorker implements PowWorkerPort {
    terminated = false
    private handler: ((event: { data: WorkerEvent }) => void) | null = null
    private failer: (() => void) | null = null
    constructor(
      private readonly matches: (nonce: number) => boolean,
      private readonly bound: number,
      private readonly failsOnPost = false,
    ) {}
    set onmessage(handler: ((event: { data: WorkerEvent }) => void) | null) {
      this.handler = handler
    }
    set onerror(handler: (() => void) | null) {
      this.failer = handler
    }
    postMessage(task: PowWorkerTask): void {
      if (this.failsOnPost) {
        this.failer?.()
        return
      }
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

  it('binds solutions to an attestation digest', async () => {
    const binding = attestationDigest(TEST_ATTESTATION)
    const { nonce } = await solvePowChallenge('bound-unit', 10, { binding })
    expect(countLeadingZeroBits(powSolutionPreimage('bound-unit', nonce, binding))).toBeGreaterThanOrEqual(10)
    // A different attestation digests differently, so the same nonce answers
    // a different preimage: solves do not transplant.
    expect(attestationDigest({ ...TEST_ATTESTATION, plugins: 0 })).not.toBe(binding)
  })

  it('canonicalizes attestations deterministically', () => {
    expect(attestationDigest(TEST_ATTESTATION)).toBe(attestationDigest({ ...TEST_ATTESTATION }))
    expect(attestationDigest(TEST_ATTESTATION)).toMatch(/^[0-9a-f]{32}$/)
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

  it('scores stock browsers clean and default automation suspicious', () => {
    const desktop: PowAttestation = {
      webdriver: false,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      plugins: 5,
      languages: 2,
      hardwareConcurrency: 8,
      screenWidth: 1920,
      screenHeight: 1080,
      touchPoints: 0,
      mobile: false,
    }
    expect(scoreAttestation(desktop).score).toBe(0)

    const iphone: PowAttestation = {
      webdriver: false,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      plugins: 0,
      languages: 2,
      hardwareConcurrency: 6,
      screenWidth: 393,
      screenHeight: 852,
      touchPoints: 5,
      mobile: true,
    }
    expect(scoreAttestation(iphone).score).toBe(0)

    const firefox: PowAttestation = { ...desktop, plugins: 0 }
    expect(scoreAttestation(firefox).score).toBe(1)

    const headless: PowAttestation = {
      webdriver: true,
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0 Safari/537.36',
      plugins: 0,
      languages: 1,
      hardwareConcurrency: 4,
      screenWidth: 800,
      screenHeight: 600,
      touchPoints: 0,
      mobile: false,
    }
    const flagged = scoreAttestation(headless)
    expect(flagged.score).toBeGreaterThanOrEqual(SUSPICIOUS_ATTESTATION_SCORE)
    expect(flagged.reasons.length).toBeGreaterThan(0)

    // Stealth passes by construction: forgery defeats client-asserted
    // signals, which is why the score prices but never blocks.
    const stealth: PowAttestation = {
      webdriver: null,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      plugins: 3,
      languages: 2,
      hardwareConcurrency: 8,
      screenWidth: 1280,
      screenHeight: 720,
      touchPoints: 0,
      mobile: false,
    }
    expect(scoreAttestation(stealth).score).toBe(0)
  })

  it('collects attestation without throwing on sparse environments', () => {
    const attestation = collectEnvironmentAttestation()
    expect(Object.keys(attestation).sort()).toEqual(
      ['hardwareConcurrency', 'languages', 'mobile', 'plugins', 'screenHeight', 'screenWidth', 'touchPoints', 'userAgent', 'webdriver'].sort(),
    )
  })

  it('scores server-observed header stacks without order dependence', () => {
    const headers = (entries: Record<string, string>) => new Headers(entries)
    const chrome = {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      'sec-ch-ua': '"Chromium";v="126"',
    }
    expect(scoreRequestFingerprint(headers(chrome)).score).toBe(0)
    const firefox = {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
    }
    expect(scoreRequestFingerprint(headers(firefox)).score).toBe(0)
    // Safari omits fetch metadata: suspicious-looking alone, never bannable alone.
    const safari = {
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    }
    expect(scoreRequestFingerprint(headers(safari)).score).toBe(2)
    expect(scoreRequestFingerprint(headers({ 'user-agent': 'curl/8.0' })).score).toBe(5)
    expect(scoreRequestFingerprint(headers({ 'user-agent': 'okhttp/4.12.0' })).score).toBe(5)
    expect(scoreRequestFingerprint(headers({ 'user-agent': 'Go-http-client/2.0' })).score).toBe(5)
    expect(scoreRequestFingerprint(headers({ 'user-agent': 'Mozilla/5.0 Chrome/126 Safari/537.36' })).score).toBe(4)
    const wrongMode = { ...chrome, 'sec-fetch-mode': 'navigate' }
    expect(scoreRequestFingerprint(headers(wrongMode)).score).toBe(1)
  })

  it('deals attempt caps exactly across workers', () => {
    expect([0, 1, 2, 3].map((index) => workerAttemptCap(10, 4, index))).toEqual([3, 3, 2, 2])
    expect([0, 1, 2, 3].map((index) => workerAttemptCap(8, 4, index))).toEqual([2, 2, 2, 2])
    expect(workerAttemptCap(1, 4, 0) + workerAttemptCap(1, 4, 1) + workerAttemptCap(1, 4, 2) + workerAttemptCap(1, 4, 3)).toBe(1)
  })

  it('races worker strides and terminates the losers', async () => {
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

  it('drops one flaky worker and lets the rest finish', async () => {
    const workers: FakeWorker[] = []
    let created = 0
    const { nonce } = await solvePowChallenge('flaky', 8, {
      workers: 4,
      maxAttempts: 100_000,
      createWorker: () => {
        created += 1
        const worker = new FakeWorker((value) => value % 13 === 7, 5000, created === 1)
        workers.push(worker)
        return worker
      },
    })
    // The dead worker's stride (multiples of 4) never produces the winner.
    expect(nonce % 13).toBe(7)
    expect(nonce % 4).not.toBe(0)
    expect(workers).toHaveLength(4)
    expect(workers.every((worker) => worker.terminated)).toBe(true)
  })

  it('falls back to sequential search when every worker errors', async () => {
    const { nonce } = await solvePowChallenge('all-dead', 8, {
      workers: 4,
      maxAttempts: 100_000,
      createWorker: () => new FakeWorker(() => false, 10, true),
    })
    expect(countLeadingZeroBits(powAttemptHash('all-dead', nonce))).toBeGreaterThanOrEqual(8)
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
