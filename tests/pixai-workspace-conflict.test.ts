import { afterEach, expect, it, vi } from 'vitest'
import {
  createPixaiStore,
  emptyWorkspace,
  WORKSPACE_CONFLICT_MESSAGE
} from '../src/renderer/src/pixai/store'
import { emptyDraft } from '../src/renderer/src/pixai/composition'
import { pixaiLibrary } from './fixtures/pixai-workspace'

afterEach(() => vi.unstubAllGlobals())

function fixture(): {
  store: ReturnType<typeof createPixaiStore>
  invoke: ReturnType<typeof vi.fn>
  persisted(): string
  replace(text: string): void
  external(): string
  delayWrite(pending: Promise<void>): void
  delayRead(pending: Promise<void>): void
  writes(): [string, Record<string, unknown>][]
} {
  let saved = JSON.stringify({ ...emptyWorkspace(), library: pixaiLibrary() })
  let revision = 0
  let gate: Promise<void> | undefined
  let delayedRead: Promise<void> | undefined
  const invoke = vi.fn(async (channel: string, request: Record<string, unknown>) => {
    if (channel === 'pixai:workspace-read') {
      const snapshot = { value: saved, revision: String(revision) }
      if (delayedRead) {
        const pending = delayedRead
        delayedRead = undefined
        await pending
      }
      return snapshot
    }
    if (channel === 'pixai:workspace-write') {
      await gate
      if (request.expectedRevision !== String(revision)) return { saved: false }
      saved = String(request.value)
      revision++
      return { saved: true, revision: String(revision) }
    }
    throw new Error(`Unexpected channel ${channel}`)
  })
  vi.stubGlobal('window', { nais: { invoke } })
  const store = createPixaiStore()
  return {
    store,
    invoke,
    persisted: () => saved,
    replace: (text: string) => {
      saved = text
      revision++
    },
    external: () => {
      const value = JSON.parse(saved)
      value.library.common.prompt = 'external B'
      value.options.repeat = 9
      value.composeDraft = { ...emptyDraft(), count: 9 }
      saved = JSON.stringify(value)
      revision++
      return saved
    },
    delayWrite: (pending: Promise<void>) => {
      gate = pending
    },
    delayRead: (pending: Promise<void>) => {
      delayedRead = pending
    },
    writes: () => invoke.mock.calls.filter(([channel]) => channel === 'pixai:workspace-write')
  }
}

it('rejects stale regular saves and requires explicit reload before writing from the new revision', async () => {
  const f = fixture()
  await f.store.getState().hydrate()
  const old = f.store.getState().workspace
  const external = f.external()
  await expect(
    f.store.getState().commit((w) => ({ ...w, options: { ...w.options, repeat: 2 } }))
  ).rejects.toThrow('WORKSPACE_CONFLICT')
  expect(f.persisted()).toBe(external)
  expect(f.store.getState().workspace).toEqual(old)
  expect(f.store.getState().conflict).toBe(true)
  f.store.getState().clearError()
  expect(f.store.getState().error).toBe(WORKSPACE_CONFLICT_MESSAGE)
  await expect(f.store.getState().commit((w) => w)).rejects.toThrow('WORKSPACE_CONFLICT')
  await expect(f.store.getState().saveDraft(emptyDraft())).rejects.toThrow('WORKSPACE_CONFLICT')
  expect(f.writes()).toHaveLength(1)
  await f.store.getState().hydrate()
  expect(f.store.getState().conflict).toBe(true)
  expect(await f.store.getState().reload()).toBe(true)
  expect(f.store.getState().workspace.library.common.prompt).toBe('external B')
  expect(f.store.getState().revision).toBe(1)
  await f.store.getState().commit((w) => ({ ...w, options: { ...w.options, repeat: 3 } }))
  expect(JSON.parse(f.persisted()).library.common.prompt).toBe('external B')
  expect(JSON.parse(f.persisted()).options.repeat).toBe(3)
  expect(f.writes()[1][1].expectedRevision).toBe('1')
})

it('blocks queued draft writes and a waiting commit after a conflict while preserving the latest visible draft', async () => {
  const f = fixture()
  await f.store.getState().hydrate()
  let finish!: () => void
  f.delayWrite(
    new Promise<void>((resolve) => {
      finish = resolve
    })
  )
  const first = f.store.getState().saveDraft({ ...emptyDraft(), count: 2 })
  await vi.waitFor(() => expect(f.writes()).toHaveLength(1))
  const second = f.store.getState().saveDraft({ ...emptyDraft(), count: 12 })
  const commit = f.store
    .getState()
    .commit((w) => w)
    .catch((error) => error)
  const external = f.external()
  expect(await f.store.getState().reload()).toBe(false)
  finish()
  await Promise.all([first, second])
  expect((await commit).message).toContain('WORKSPACE_CONFLICT')
  expect(f.writes()).toHaveLength(1)
  expect(f.persisted()).toBe(external)
  expect(f.store.getState().workspace.composeDraft?.count).toBe(12)
  expect(f.store.getState()).toMatchObject({ conflict: true, busy: false, draftSaving: false })
  expect(await f.store.getState().reload()).toBe(true)
  await Promise.resolve()
  expect(f.store.getState()).toMatchObject({ conflict: false, error: '' })
  expect(f.store.getState().workspace.composeDraft?.count).toBe(9)
  expect(f.persisted()).toBe(external)
})

it('keeps the old visible data locked when reloading malformed external data fails', async () => {
  const f = fixture()
  await f.store.getState().hydrate()
  f.external()
  await expect(f.store.getState().verifyCurrent()).rejects.toThrow('WORKSPACE_CONFLICT')
  const visible = f.store.getState().workspace
  f.replace('{broken')
  expect(await f.store.getState().reload()).toBe(false)
  expect(f.store.getState().workspace).toEqual(visible)
  expect(f.store.getState().conflict).toBe(true)
  await expect(f.store.getState().commit((w) => w)).rejects.toThrow('WORKSPACE_CONFLICT')
  expect(f.persisted()).toBe('{broken')
  expect(f.writes()).toHaveLength(0)
})

it('does not confuse a save completing during a read-only check with an external conflict', async () => {
  const f = fixture()
  await f.store.getState().hydrate()
  let finish!: () => void
  f.delayRead(
    new Promise<void>((resolve) => {
      finish = resolve
    })
  )
  const check = f.store
    .getState()
    .verifyCurrent()
    .catch((error) => error)
  await f.store.getState().commit((w) => ({ ...w, options: { ...w.options, repeat: 3 } }))
  finish()
  expect((await check).message).toContain('저장 상태가 바뀌었습니다')
  expect(f.store.getState().conflict).toBe(false)
  expect(await f.store.getState().verifyCurrent()).toBe('1')
})
