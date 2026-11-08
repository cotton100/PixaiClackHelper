// @vitest-environment happy-dom
import { act, createElement as h, useLayoutEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { LibrarySyncController, LibrarySyncSettings } from '../src/renderer/src/pixai/library-sync'
import { applyLibrarySync } from '../src/renderer/src/pixai/library-sync-apply'
import { UnsavedNavigationProvider } from '../src/renderer/src/pixai/unsaved-navigation-provider'
import { useUnsavedNavigation } from '../src/renderer/src/pixai/unsaved-navigation'
import { LibraryEditor } from '../src/renderer/src/pixai/library-editor'
import { createPixaiStore, emptyWorkspace } from '../src/renderer/src/pixai/store'
import { projectSyncLibrary, type SyncLibrary } from '../src/shared/pixai/library-sync'
import type { LibrarySyncApplyRequest, LibrarySyncStatus } from '../src/shared/pixai/execution'
import { useLanguageStore } from '../src/renderer/src/lib/i18n'
import { pixaiLibrary } from './fixtures/pixai-workspace'

let root: Root, container: HTMLDivElement
let status: LibrarySyncStatus
let applyEvent: ((request: LibrarySyncApplyRequest) => void) | undefined
const unsubscribe = vi.fn()
const invoke = vi.fn()
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  useLanguageStore.setState({ lang: 'ko' })
  status = { enabled: false, listening: false, paired: false, exchange: { state: 'idle' } }
  invoke.mockImplementation(async (channel: string) =>
    channel === 'pixai:library-sync-applied' ? { accepted: true } : status
  )
  vi.stubGlobal('nais', {
    invoke,
    on: vi.fn((channel: string, handler: (request: LibrarySyncApplyRequest) => void) => {
      if (channel === 'pixai:library-sync-apply') applyEvent = handler
      return unsubscribe
    })
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  vi.useRealTimers()
  applyEvent = undefined
})
async function fixture(): Promise<{
  store: ReturnType<typeof createPixaiStore>
  storage: { read: Mock<() => Promise<string>>; write: Mock<(value: string) => Promise<void>> }
  expected: SyncLibrary
  next: SyncLibrary
  persisted: () => string
}> {
  let persisted = JSON.stringify({ ...emptyWorkspace(), library: pixaiLibrary() })
  const storage = {
    read: vi.fn(async () => persisted),
    write: vi.fn(async (value: string) => {
      persisted = value
    })
  }
  const store = createPixaiStore(storage)
  await store.getState().hydrate()
  const expected = projectSyncLibrary(store.getState().workspace.library)
  const next = structuredClone(expected)
  next.common.prompt = 'synchronized common'
  return { store, storage, expected, next, persisted: () => persisted }
}
function button(text: string): HTMLButtonElement {
  const element = [...container.querySelectorAll('button')].find(
    (item) => item.textContent === text
  )
  expect(element, text).toBeDefined()
  return element!
}
async function click(text: string): Promise<void> {
  await act(async () => button(text).click())
}

describe('renderer sync atomic application', () => {
  it('rejects expired apply events without writing and rechecks the deadline inside commit', async () => {
    const f = await fixture()
    await act(async () =>
      root.render(h(UnsavedNavigationProvider, null, h(LibrarySyncController, { store: f.store })))
    )
    await act(async () =>
      applyEvent!({ id: 'expired', expected: f.expected, next: f.next, expiresAt: Date.now() - 1 })
    )
    expect(invoke).toHaveBeenCalledWith(
      'pixai:library-sync-applied',
      expect.objectContaining({
        id: 'expired',
        ok: false,
        error: expect.stringContaining('요청이 만료')
      })
    )
    const now = vi.spyOn(Date, 'now').mockReturnValueOnce(1).mockReturnValue(3)
    try {
      await expect(applyLibrarySync(f.store, f.expected, f.next, () => false, 2)).rejects.toThrow(
        '요청이 만료'
      )
    } finally {
      now.mockRestore()
    }
    expect(f.storage.write).not.toHaveBeenCalled()
    expect(projectSyncLibrary(f.store.getState().workspace.library)).toEqual(f.expected)
  })

  it('preserves options, queued jobs, composition draft and freezes old reservations', async () => {
    const f = await fixture()
    const plan = {
      id: 'b1',
      name: 'test',
      rows: [{ kind: 'character' as const, id: 'c1' }],
      columns: ['sc1'],
      count: 1,
      order: 'byRow' as const,
      exceptions: {}
    }
    await f.store.getState().reserve(plan)
    await f.store.getState().register()
    await f.store.getState().commit((current) => ({
      ...current,
      composeDraft: {
        presetId: 'p1',
        characterId: 'c1',
        sceneIds: ['s1'],
        count: 2,
        triggerPosition: 'end'
      },
      options: { ...current.options, filePrefix: 'keep-local', repeat: 7 },
      library: {
        ...current.library,
        reservations: [{ id: 'r2', presetId: 'p1', characterId: 'c1', sceneIds: ['s1'], count: 1 }]
      }
    }))
    const before = structuredClone(f.store.getState().workspace)
    await applyLibrarySync(f.store, f.expected, f.next, () => false)
    const after = f.store.getState().workspace
    expect(after.library.common.prompt).toBe('synchronized common')
    expect(after.jobs).toEqual(before.jobs)
    expect(after.options).toEqual(before.options)
    expect(after.composeDraft).toEqual(before.composeDraft)
    expect(after.widths).toEqual(before.widths)
    expect(after.library.reservations[0].snapshot?.common).toEqual(before.library.common)
    expect(JSON.parse(f.persisted()).jobs).toEqual(before.jobs)
    expect(f.storage.read).toHaveBeenCalledTimes(1)
  })

  it('rejects a stale projection without writes or reload', async () => {
    const f = await fixture()
    await f.store.getState().editLibrary((library) => ({
      ...library,
      common: { ...library.common, prompt: 'newer local' }
    }))
    const before = f.persisted()
    f.storage.write.mockClear()
    await expect(applyLibrarySync(f.store, f.expected, f.next, () => false)).rejects.toThrow(
      '미리보기 후'
    )
    expect(f.storage.write).not.toHaveBeenCalled()
    expect(f.persisted()).toBe(before)
    expect(f.storage.read).toHaveBeenCalledTimes(1)
  })

  it.each(['busy', 'draftSaving', 'conflict'] as const)(
    'blocks %s without mutating data',
    async (key) => {
      const f = await fixture()
      f.store.setState({ [key]: true })
      await expect(applyLibrarySync(f.store, f.expected, f.next, () => false)).rejects.toThrow(
        '저장·불러오기'
      )
      expect(f.storage.write).not.toHaveBeenCalled()
    }
  )

  it('checks dirty editors both before commit and inside the locked callback', async () => {
    const f = await fixture()
    await expect(applyLibrarySync(f.store, f.expected, f.next, () => true)).rejects.toThrow(
      '저장하지 않은'
    )
    const becameDirty = vi.fn().mockReturnValueOnce(false).mockReturnValue(true)
    await expect(applyLibrarySync(f.store, f.expected, f.next, becameDirty)).rejects.toThrow(
      '저장하지 않은'
    )
    expect(becameDirty).toHaveBeenCalledTimes(2)
    expect(f.storage.write).not.toHaveBeenCalled()
    expect(f.store.getState().busy).toBe(false)
  })

  it('reports failed persistence and keeps the previous library', async () => {
    const f = await fixture()
    f.storage.write.mockRejectedValueOnce(new Error('disk full'))
    await act(async () =>
      root.render(h(UnsavedNavigationProvider, null, h(LibrarySyncController, { store: f.store })))
    )
    await act(async () =>
      applyEvent!({
        id: 'failed',
        expected: f.expected,
        next: f.next,
        expiresAt: Date.now() + 10000
      })
    )
    expect(invoke).toHaveBeenCalledWith(
      'pixai:library-sync-applied',
      expect.objectContaining({ id: 'failed', ok: false })
    )
    expect(projectSyncLibrary(f.store.getState().workspace.library)).toEqual(f.expected)
    expect(f.storage.read).toHaveBeenCalledTimes(1)
  })

  it('acknowledges only after the save completes and unregisters the apply listener', async () => {
    const f = await fixture()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    f.storage.write.mockImplementationOnce(async () => {
      await gate
    })
    await act(async () =>
      root.render(h(UnsavedNavigationProvider, null, h(LibrarySyncController, { store: f.store })))
    )
    await act(async () =>
      applyEvent!({
        id: 'saving',
        expected: f.expected,
        next: f.next,
        expiresAt: Date.now() + 10000
      })
    )
    expect(invoke).not.toHaveBeenCalledWith('pixai:library-sync-applied', expect.anything())
    expect(f.store.getState().busy).toBe(true)
    await act(async () => {
      release()
      await gate
    })
    expect(invoke).toHaveBeenCalledWith('pixai:library-sync-applied', { id: 'saving', ok: true })
    await act(async () => root.render(null))
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('shares dirty state across mounted editors without opening a discard dialog', async () => {
    const f = await fixture()
    function Editor(): React.JSX.Element {
      const [dirty, setDirty] = useState(true)
      const guard = useUnsavedNavigation()
      useLayoutEffect(() => guard.register(dirty, async () => true))
      return h('button', { onClick: () => setDirty(false) }, 'save editor')
    }
    await act(async () =>
      root.render(
        h(UnsavedNavigationProvider, null, h(Editor), h(LibrarySyncController, { store: f.store }))
      )
    )
    await act(async () =>
      applyEvent!({
        id: 'dirty',
        expected: f.expected,
        next: f.next,
        expiresAt: Date.now() + 10000
      })
    )
    expect(invoke).toHaveBeenCalledWith(
      'pixai:library-sync-applied',
      expect.objectContaining({
        id: 'dirty',
        ok: false,
        error: expect.stringContaining('저장하지 않은')
      })
    )
    expect(f.storage.write).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()
    await click('save editor')
    await act(async () =>
      applyEvent!({
        id: 'clean',
        expected: f.expected,
        next: f.next,
        expiresAt: Date.now() + 10000
      })
    )
    expect(invoke).toHaveBeenCalledWith('pixai:library-sync-applied', { id: 'clean', ok: true })
  })

  it('preserves a real material editor draft when an apply event arrives', async () => {
    const f = await fixture()
    await act(async () =>
      root.render(
        h(
          UnsavedNavigationProvider,
          null,
          h(LibraryEditor, { store: f.store }),
          h(LibrarySyncController, { store: f.store })
        )
      )
    )
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="캐릭터 폴더 미분류"]')!.click()
    )
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((element) => element.textContent?.includes('Alice'))!
        .click()
    )
    const input =
      container.querySelector<HTMLInputElement>('input[aria-label="이름"]') ??
      [...container.querySelectorAll<HTMLInputElement>('input')].find(
        (element) => element.value === 'Alice'
      )!
    expect(input).toBeDefined()
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        'Unsaved Alice'
      )
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () =>
      applyEvent!({
        id: 'draft',
        expected: f.expected,
        next: f.next,
        expiresAt: Date.now() + 10000
      })
    )
    expect(invoke).toHaveBeenCalledWith(
      'pixai:library-sync-applied',
      expect.objectContaining({ id: 'draft', ok: false })
    )
    expect(input.value).toBe('Unsaved Alice')
    expect(f.storage.write).not.toHaveBeenCalled()
  })
})

describe('sync settings with mocked IPC', () => {
  it('fails closed when an older or malformed IPC response has no sync state', async () => {
    const f = await fixture()
    invoke.mockResolvedValueOnce({ connected: false, running: false })
    await act(async () => root.render(h(LibrarySyncSettings, { store: f.store })))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      '동기화 연결을 사용할 수 없습니다'
    )
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true)
    expect(container.textContent).not.toContain('스크립트와 연결됨')
    expect(f.storage.write).not.toHaveBeenCalled()
  })

  it('starts disabled and only enables or creates a code on explicit clicks', async () => {
    const f = await fixture()
    await act(async () => root.render(h(LibrarySyncSettings, { store: f.store })))
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual(['pixai:library-sync-status'])
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false)
    status = { ...status, enabled: true, listening: true }
    await act(async () =>
      container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()
    )
    expect(invoke).toHaveBeenCalledWith('pixai:library-sync-enable', { enabled: true })
    status = { ...status, code: 'synthetic-pair-code', expiresAt: Date.now() + 60000 }
    await click('새 연결 코드')
    expect(invoke).toHaveBeenCalledWith('pixai:library-sync-pair', {})
    expect(container.querySelector<HTMLInputElement>('input[readonly]')!.value).toBe(
      'synthetic-pair-code'
    )
    expect(f.storage.write).not.toHaveBeenCalled()
  })

  it('requires explicit first-sync confirmation and shows both library counts', async () => {
    const f = await fixture()
    status = {
      enabled: true,
      listening: true,
      paired: true,
      exchange: {
        state: 'preview',
        proposal: {
          id: 'p1',
          initial: true,
          library: f.next,
          conflicts: [],
          appCount: 3,
          scriptCount: 4,
          mergedCount: 7
        }
      }
    }
    await act(async () => root.render(h(LibrarySyncSettings, { store: f.store })))
    expect(container.textContent).toContain('첫 동기화 미리보기')
    expect([...container.querySelectorAll('dd')].map((item) => item.textContent)).toEqual([
      '3',
      '4',
      '7'
    ])
    expect(invoke).not.toHaveBeenCalledWith('pixai:library-sync-approve', expect.anything())
    await click('확인한 내용 적용')
    expect(invoke).toHaveBeenCalledWith('pixai:library-sync-approve', { id: 'p1', choices: {} })
  })

  it('renders conflict values as plain text, requires choices, and sends the exact proposal ID', async () => {
    const f = await fixture()
    status = {
      enabled: true,
      listening: true,
      paired: true,
      exchange: {
        state: 'preview',
        proposal: {
          id: 'conflict1',
          initial: false,
          library: f.next,
          conflicts: [
            {
              key: 'characters:c1',
              label: '<img src=x>',
              app: { prompt: '<script>unsafe</script>' },
              script: null
            }
          ],
          appCount: 3,
          scriptCount: 3,
          mergedCount: 3
        }
      }
    }
    await act(async () => root.render(h(LibrarySyncSettings, { store: f.store })))
    expect(button('확인한 내용 적용').disabled).toBe(true)
    expect(container.querySelectorAll('dd')[2].textContent).toBe('충돌 선택 후 확정')
    expect(container.querySelector('img,script')).toBeNull()
    expect(container.textContent).toContain('<script>unsafe</script>')
    await act(async () => container.querySelector<HTMLInputElement>('input[type="radio"]')!.click())
    expect(button('확인한 내용 적용').disabled).toBe(false)
    await click('확인한 내용 적용')
    expect(invoke).toHaveBeenCalledWith('pixai:library-sync-approve', {
      id: 'conflict1',
      choices: { 'characters:c1': 'app' }
    })
    await click('취소')
    expect(invoke).toHaveBeenCalledWith('pixai:library-sync-cancel', { id: 'conflict1' })
  })

  it('hides expired codes and provides disconnect without touching the library', async () => {
    const f = await fixture()
    status = {
      enabled: true,
      listening: true,
      paired: true,
      code: 'expired-code',
      expiresAt: Date.now() - 1000,
      exchange: { state: 'idle' }
    }
    await act(async () => root.render(h(LibrarySyncSettings, { store: f.store })))
    expect(container.querySelector<HTMLInputElement>('input[readonly]')!.value).toBe('')
    expect(container.textContent).toContain('코드가 만료')
    await click('연결 해제')
    expect(invoke).toHaveBeenCalledWith('pixai:library-sync-disconnect', {})
    expect(f.storage.write).not.toHaveBeenCalled()
  })

  it('keeps a blocked unapplied proposal available for retry or cancel', async () => {
    const f = await fixture()
    status = {
      enabled: true,
      listening: true,
      paired: true,
      exchange: {
        state: 'blocked',
        message: '저장하지 않은 편집 내용이 있습니다.',
        proposal: {
          id: 'retry1',
          initial: true,
          library: f.next,
          conflicts: [],
          appCount: 3,
          scriptCount: 4,
          mergedCount: 7
        }
      }
    }
    await act(async () => root.render(h(LibrarySyncSettings, { store: f.store })))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('저장하지 않은')
    await click('확인한 내용 적용')
    expect(invoke).toHaveBeenCalledWith('pixai:library-sync-approve', { id: 'retry1', choices: {} })
    await click('취소')
    expect(invoke).toHaveBeenCalledWith('pixai:library-sync-cancel', { id: 'retry1' })
  })
})
