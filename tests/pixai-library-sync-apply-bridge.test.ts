/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LibrarySyncApplyBridge } from '../src/main/pixai/library-sync-apply-bridge'
import { makeLibrary } from '../src/shared/pixai/library'
import { projectSyncLibrary } from '../src/shared/pixai/library-sync'
import type { LibrarySyncApplyRequest } from '../src/shared/pixai/execution'

afterEach(() => vi.useRealTimers())
const library = () => projectSyncLibrary(makeLibrary())

describe('renderer apply ownership', () => {
  it('keeps an in-flight save pending beyond its start deadline until the renderer acknowledges', async () => {
    vi.useFakeTimers()
    const send = vi.fn<(request: LibrarySyncApplyRequest) => void>()
    const bridge = new LibrarySyncApplyBridge({ send })
    let settled = false
    const work = bridge.apply(library(), library()).then(() => {
      settled = true
    })
    const request = send.mock.calls[0][0]
    expect(request.expiresAt).toBe(Date.now() + 10_000)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(settled).toBe(false)
    expect(bridge.pendingCount).toBe(1)
    expect(bridge.reply({ id: request.id, ok: true })).toEqual({ accepted: true })
    await work
    expect(settled).toBe(true)
    expect(bridge.pendingCount).toBe(0)
    expect(bridge.reply({ id: request.id, ok: true })).toEqual({ accepted: false })
  })

  it('ignores malformed/stale replies and releases only the matching explicit failure', async () => {
    const send = vi.fn<(request: LibrarySyncApplyRequest) => void>()
    const bridge = new LibrarySyncApplyBridge({ send })
    const work = bridge.apply(library(), library())
    const rejected = expect(work).rejects.toThrow('미저장 입력')
    const id = send.mock.calls[0][0].id
    for (const invalid of [null, [], {}, { id: 'old', ok: true }, { id, ok: 'true' }])
      expect(bridge.reply(invalid)).toEqual({ accepted: false })
    expect(bridge.pendingCount).toBe(1)
    expect(bridge.reply({ id, ok: false, error: '미저장 입력' })).toEqual({ accepted: true })
    await rejected
    expect(bridge.pendingCount).toBe(0)
  })

  it('releases on definite renderer termination and rejects all old reply IDs', async () => {
    const send = vi.fn<(request: LibrarySyncApplyRequest) => void>()
    const bridge = new LibrarySyncApplyBridge({ send })
    const first = bridge.apply(library(), library())
    const second = bridge.apply(library(), library())
    const rejected = Promise.all([
      expect(first).rejects.toThrow('종료'),
      expect(second).rejects.toThrow('종료')
    ])
    expect(bridge.pendingCount).toBe(2)
    bridge.rendererGone()
    await rejected
    expect(bridge.pendingCount).toBe(0)
    for (const [request] of send.mock.calls)
      expect(bridge.reply({ id: request.id, ok: true })).toEqual({ accepted: false })
  })

  it('releases a request that could not be sent without exposing internal error details', async () => {
    const bridge = new LibrarySyncApplyBridge({
      send: () => {
        throw new Error('internal send details')
      }
    })
    await expect(bridge.apply(library(), library())).rejects.toThrow('보내지 못했습니다')
    expect(bridge.pendingCount).toBe(0)
  })
})
