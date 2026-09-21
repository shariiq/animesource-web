import { describe, expect, it } from 'vitest'
import { createImageLoadQueue } from '../app/components/manga/reader/imageLoadQueue'

describe('manga image load queue', () => {
  it('caps active loads and starts the next item when one completes', () => {
    const queue = createImageLoadQueue(2)
    const started: number[] = []
    const complete: Array<() => void> = []

    for (const index of [0, 1, 2]) {
      queue.enqueue((done) => {
        started.push(index)
        complete.push(done)
      })
    }

    expect(started).toEqual([0, 1])
    complete[0]!()
    expect(started).toEqual([0, 1, 2])
    complete[1]!()
    complete[2]!()
  })

  it('cancels queued work without consuming a load slot', () => {
    const queue = createImageLoadQueue(1)
    const started: number[] = []
    const first = queue.enqueue(() => started.push(0))
    const cancelled = queue.enqueue(() => started.push(1))

    cancelled.cancel()
    first.complete()

    expect(started).toEqual([0])
  })
})
