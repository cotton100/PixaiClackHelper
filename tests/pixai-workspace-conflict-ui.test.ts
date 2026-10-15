// @vitest-environment happy-dom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import PixaiApp from '../src/renderer/src/pixai/app'
import { ExecutionQueue } from '../src/renderer/src/pixai/execution'
import {
  createPixaiStore,
  emptyWorkspace,
  WorkspaceConflictError,
  type Workspace
} from '../src/renderer/src/pixai/store'
import {
  backupSelection,
  makeTransferBackup,
  parseTransferBackup
} from '../src/shared/pixai/backup-transfer'
import { pixaiLibrary } from './fixtures/pixai-workspace'

let root: Root, container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('nais', { runtime: 'browser' })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// Only synthetic workspace strings and an in-memory revision are used here.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function fixture() {
  let saved = JSON.stringify({ ...emptyWorkspace(), library: pixaiLibrary() })
  let revision = 1,
    readRevision = 0
  const storage = {
    read: vi.fn(async () => {
      readRevision = revision
      return saved
    }),
    write: vi.fn(async (value: string) => {
      if (readRevision !== revision) throw new WorkspaceConflictError()
      saved = value
      readRevision = ++revision
    }),
    verify: vi.fn(async () => {
      if (readRevision !== revision) throw new WorkspaceConflictError()
      return String(revision)
    })
  }
  const store = createPixaiStore(storage)
  await store.getState().hydrate()
  return {
    store,
    storage,
    saved: () => saved,
    replace: (workspace: Workspace) => {
      saved = JSON.stringify(workspace)
      revision++
    }
  }
}
function button(name: string, scope: ParentNode = container): HTMLButtonElement {
  const found = [...scope.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === name || item.getAttribute('aria-label') === name
  )
  expect(found, name).toBeTruthy()
  return found!
}
async function click(name: string, scope?: ParentNode): Promise<void> {
  await act(async () => button(name, scope).click())
}
function field(label: string): HTMLInputElement {
  const found = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)
  expect(found, label).toBeTruthy()
  return found!
}
async function type(label: string, value: string): Promise<void> {
  const input = field(label)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
function blocked(element: HTMLElement): boolean {
  return element.hasAttribute('disabled') || !!element.closest('fieldset[disabled]')
}
async function focusCheck(): Promise<void> {
  await act(async () => window.dispatchEvent(new Event('focus')))
}
async function preparePreview(): Promise<void> {
  const file = makeTransferBackup(
    pixaiLibrary(),
    emptyWorkspace().options,
    { ...backupSelection(false), scenes: true },
    { appVersion: 'synthetic', exportedAt: '2026-10-16T00:00:00Z' }
  )
  const input = field('설정 백업 파일')
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [new File([JSON.stringify(file)], 'synthetic-backup.json')]
  })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  expect(container.textContent).toContain('가져올 자료')
}
async function prepareQueue(store: ReturnType<typeof createPixaiStore>): Promise<void> {
  await store.getState().reserve(
    {
      id: 'synthetic-plan',
      name: 'synthetic queue',
      rows: [{ kind: 'character', id: 'c1' }],
      columns: ['sc1'],
      count: 1,
      exceptions: {},
      order: 'byRow'
    },
    true
  )
}

it('locks conflicting edits but exports the still-visible materials without writing the newer workspace', async () => {
  const f = await fixture()
  await act(async () => root.render(h(PixaiApp, { store: f.store })))
  const newer = structuredClone(f.store.getState().workspace)
  newer.library.common.prompt = 'external latest'
  f.replace(newer)
  const latest = f.saved()
  await focusCheck()
  expect(f.store.getState().conflict).toBe(true)
  expect(blocked(field('조합 생성 횟수'))).toBe(true)
  expect(container.querySelector('.px-global-error')?.textContent).toContain(
    '덮어쓰기를 막았습니다'
  )
  expect(container.querySelector('.px-global-error')?.textContent).toContain(
    '편집 중인 입력은 포함되지 않습니다'
  )

  await click('화면에 남은 재료 백업')
  expect(blocked(field('설정 백업 파일'))).toBe(true)
  expect(blocked(button('앱용 내보내기'))).toBe(false)
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic-conflict')
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  await click('앱용 내보내기')
  await click('백업 파일 저장')
  const backup = parseTransferBackup(await (create.mock.calls[0][0] as Blob).text())
  expect(backup.backup.library.common.prompt).toBe('quality')
  expect(f.saved()).toBe(latest)
  expect(f.storage.write).not.toHaveBeenCalled()
  expect(f.store.getState().conflict).toBe(true)
})

it('requires a second reload confirmation, preserves drafts on cancel, and remounts editors and import previews on success', async () => {
  const f = await fixture()
  await act(async () => root.render(h(PixaiApp, { store: f.store })))
  await click('라이브러리', container.querySelector('.px-nav')!)
  const library = container.querySelector('.px-page:not([hidden])')!
  await click('캐릭터 폴더 미분류', library)
  await click('Alicealice', library)
  await type('캐릭터 이름', 'unsaved local edit')
  const originalEditor = field('캐릭터 이름')
  await click('설정', container.querySelector('.px-nav')!)
  await preparePreview()
  const newer = structuredClone(f.store.getState().workspace)
  newer.library.characters[0].name = 'External Alice'
  f.replace(newer)
  await focusCheck()
  const reads = f.storage.read.mock.calls.length
  await click('최신 자료 다시 불러오기')
  expect(f.storage.read).toHaveBeenCalledTimes(reads)
  expect(container.querySelector('.px-global-error')?.textContent).toContain('미저장 입력을 버리고')
  await click('취소', container.querySelector('.px-global-error')!)
  expect(f.storage.read).toHaveBeenCalledTimes(reads)
  expect(field('캐릭터 이름')).toBe(originalEditor)
  expect(originalEditor.value).toBe('unsaved local edit')
  expect(container.textContent).toContain('가져올 자료')
  expect(f.store.getState().conflict).toBe(true)

  await click('최신 자료 다시 불러오기')
  await click('미저장 변경을 버리고 불러오기')
  expect(f.store.getState().conflict).toBe(false)
  expect(f.store.getState().workspace.library.characters[0].name).toBe('External Alice')
  expect(container.contains(originalEditor)).toBe(false)
  expect(container.textContent).not.toContain('가져올 자료')
  expect(f.storage.write).not.toHaveBeenCalled()
  await click('라이브러리', container.querySelector('.px-nav')!)
  const refreshedLibrary = container.querySelector('.px-page:not([hidden])')!
  await click('캐릭터 폴더 미분류', refreshedLibrary)
  await click('External Alicealice', refreshedLibrary)
  expect(field('캐릭터 이름').value).toBe('External Alice')
})

it('keeps the old editor and conflict protection when the explicit reload fails', async () => {
  const f = await fixture()
  await act(async () => root.render(h(PixaiApp, { store: f.store })))
  await click('라이브러리', container.querySelector('.px-nav')!)
  const library = container.querySelector('.px-page:not([hidden])')!
  await click('캐릭터 폴더 미분류', library)
  await click('Alicealice', library)
  await type('캐릭터 이름', 'keep unsaved')
  const oldEditor = field('캐릭터 이름')
  f.replace({
    ...f.store.getState().workspace,
    options: { ...emptyWorkspace().options, repeat: 8 }
  })
  await focusCheck()
  f.storage.read.mockRejectedValueOnce(new Error('synthetic read failure'))
  await click('최신 자료 다시 불러오기')
  await click('미저장 변경을 버리고 불러오기')
  expect(f.store.getState().conflict).toBe(true)
  expect(field('캐릭터 이름')).toBe(oldEditor)
  expect(oldEditor.value).toBe('keep unsaved')
  expect(blocked(oldEditor)).toBe(true)
  expect(container.querySelector('.px-global-error')?.textContent).toContain(
    '최신 자료를 읽지 못했습니다'
  )
  expect(f.storage.write).not.toHaveBeenCalled()
})

it('blocks starting after a detected conflict while keeping a running queue stoppable', async () => {
  const f = await fixture()
  await prepareQueue(f.store)
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'pixai:update-status')
      return {
        currentVersion: '0.1.17-beta.2',
        supported: true,
        phase: 'idle',
        releases: []
      }
    if (channel === 'pixai:connection')
      return {
        connected: true,
        remembered: false,
        encryptionAvailable: true,
        outputDir: 'synthetic',
        maxInFlight: 1
      }
    if (channel === 'pixai:scene-thumbnails') return { revision: 'synthetic', images: [] }
    return { running: true, stopping: channel === 'pixai:pause', error: '', jobs: [] }
  })
  vi.stubGlobal('nais', { runtime: 'electron', invoke })
  await act(async () => root.render(h(PixaiApp, { store: f.store })))
  f.replace({
    ...f.store.getState().workspace,
    options: { ...emptyWorkspace().options, repeat: 8 }
  })
  await focusCheck()
  await click('대기열1', container.querySelector('.px-nav')!)
  expect(blocked(button('시작·저장 재개'))).toBe(true)
  expect(blocked(button('완료 목록 비우기'))).toBe(true)
  expect(blocked(button('중지'))).toBe(false)
  await click('중지')
  expect(invoke).toHaveBeenCalledWith('pixai:pause', {})
  expect(invoke.mock.calls.some(([channel]) => channel === 'pixai:start')).toBe(false)
  expect(f.store.getState().conflict).toBe(true)
})

it('rejects a stale workspace before invoking the paid start IPC', async () => {
  const f = await fixture()
  await prepareQueue(f.store)
  const invoke = vi.fn(async (channel: string) => {
    if (channel !== 'pixai:status') throw new Error('unexpected IPC in synthetic fixture')
    return { running: false, stopping: false, error: '', jobs: [] }
  })
  vi.stubGlobal('nais', { runtime: 'electron', invoke })
  await act(async () => root.render(h(ExecutionQueue, { store: f.store })))
  await click('시작·저장 재개')
  const costs = [...container.querySelectorAll('label')]
    .find((label) => label.textContent?.includes('API 비용이 발생'))!
    .querySelector('input')!
  await act(async () => costs.click())
  f.replace({
    ...f.store.getState().workspace,
    options: { ...emptyWorkspace().options, repeat: 8 }
  })
  await click('확인한 작업 실행')
  expect(f.store.getState().conflict).toBe(true)
  expect(invoke.mock.calls.some(([channel]) => channel === 'pixai:start')).toBe(false)
  expect(button('확인한 작업 실행').disabled).toBe(true)
})

it('locks the workspace when the main process detects a change after the renderer preflight', async () => {
  const f = await fixture()
  await prepareQueue(f.store)
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'pixai:start')
      throw new Error(
        "Error invoking remote method 'pixai:start': WORKSPACE_CONFLICT: synthetic external change"
      )
    return { running: false, stopping: false, error: '', jobs: [] }
  })
  vi.stubGlobal('nais', { runtime: 'electron', invoke })
  await act(async () => root.render(h(ExecutionQueue, { store: f.store })))
  await click('시작·저장 재개')
  const costs = [...container.querySelectorAll('label')]
    .find((label) => label.textContent?.includes('API 비용이 발생'))!
    .querySelector('input')!
  await act(async () => costs.click())
  await click('확인한 작업 실행')
  expect(invoke).toHaveBeenCalledWith(
    'pixai:start',
    expect.objectContaining({
      expectedWorkspaceRevision: '2',
      costsAccepted: true
    })
  )
  expect(f.store.getState().conflict).toBe(true)
  expect(f.store.getState().error).toContain('덮어쓰기를 막았습니다')
  expect(button('확인한 작업 실행').disabled).toBe(true)
  expect(invoke.mock.calls.filter(([channel]) => channel === 'pixai:start')).toHaveLength(1)
})
