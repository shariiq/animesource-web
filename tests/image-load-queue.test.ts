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

  it('loads the viewer current page next after a far scroll jump', () => {
    const queue = createImageLoadQueue(1)
    const started: number[] = []
    const complete: Array<() => void> = []

    queue.enqueue((done) => {
      started.push(0)
      complete.push(done)
    }, { index: 0 })
    queue.enqueue((done) => {
      started.push(2)
      complete.push(done)
    }, { index: 2 })
    queue.enqueue((done) => {
      started.push(150)
      complete.push(done)
    }, { index: 150 })

    // Viewport still at 0: page 2 outranks page 150.
    expect(started).toEqual([0])
    // The viewer jumps to page 150: pending work re-sorts so 150 starts next.
    queue.setViewportIndex(150)
    complete[0]!()
    expect(started).toEqual([0, 150])
    complete[1]!()
    expect(started).toEqual([0, 150, 2])
    complete[2]!()
  })

  it('keeps opportunistic preloads behind real page loads', () => {
    const queue = createImageLoadQueue(1)
    const started: string[] = []
    const complete: Array<() => void> = []

    queue.enqueue((done) => {
      started.push('page-0')
      complete.push(done)
    }, { index: 0 })
    queue.enqueue((done) => {
      started.push('preload')
      complete.push(done)
    })
    queue.setViewportIndex(5)
    queue.enqueue((done) => {
      started.push('page-5')
      complete.push(done)
    }, { index: 5 })

    expect(started).toEqual(['page-0'])
    complete[0]!()
    expect(started).toEqual(['page-0', 'page-5'])
    complete[1]!()
    expect(started).toEqual(['page-0', 'page-5', 'preload'])
    complete[2]!()
  })
})
