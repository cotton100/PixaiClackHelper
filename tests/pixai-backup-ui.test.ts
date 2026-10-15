// @vitest-environment happy-dom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BackupSettings } from '../src/renderer/src/pixai/settings'
import { createPixaiStore, emptyWorkspace } from '../src/renderer/src/pixai/store'
import { pixaiLibrary } from './fixtures/pixai-workspace'
import {
  backupSelection,
  makeTransferBackup,
  parseTransferBackup,
  type TransferBackup
} from '../src/shared/pixai/backup-transfer'

vi.mock('../src/renderer/src/pixai/execution', () => ({ ApiConnection: () => null }))
vi.mock('../src/renderer/src/pixai/updates', () => ({ AppUpdates: () => null }))

let root: Root, container: HTMLDivElement, store: ReturnType<typeof createPixaiStore>
let write: ReturnType<typeof vi.fn>, onImport: ReturnType<typeof vi.fn>
const meta = { appVersion: 'test', exportedAt: '2026-10-16T00:00:00Z' }
const options = emptyWorkspace().options
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  write = vi.fn(async () => {})
  store = createPixaiStore({
    read: async () => JSON.stringify({ ...emptyWorkspace(), library: pixaiLibrary() }),
    write
  })
  await store.getState().hydrate()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  onImport = vi.fn()
  await act(async () => root.render(h(BackupSettings, { store, onImport })))
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
const panel = (name: string): HTMLElement =>
  [...container.querySelectorAll('section')].find(
    (x) => x.querySelector('h2')?.textContent === name
  )!
const btn = (scope: HTMLElement, name: string): HTMLButtonElement =>
  [...scope.querySelectorAll('button')].find((x) => x.textContent?.trim() === name)!
const check = (scope: HTMLElement, label: string): HTMLInputElement =>
  [...scope.querySelectorAll('label')]
    .find((x) => x.textContent?.trim().split(' · ')[0] === label)!
    .querySelector('input')!
async function click(element: HTMLElement): Promise<void> {
  await act(async () => element.click())
}
async function read(file: TransferBackup): Promise<void> {
  const input = container.querySelector('input[type=file]')!
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [new File([JSON.stringify(file)], 'backup.json')]
  })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
}

describe('backup selection UI', () => {
  it('exports checked categories with visible dependencies and no unrelated settings', async () => {
    const out = panel('백업 내보내기')
    await click(btn(out, '선택 해제'))
    expect(btn(out, '앱용 내보내기').disabled).toBe(true)
    await click(check(out, '씬'))
    await click(btn(out, '앱용 내보내기'))
    expect(out.textContent).toContain('청크 3개')
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic')
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await click(btn(out, '백업 파일 저장'))
    const blob = create.mock.calls[0][0] as Blob
    const exported = parseTransferBackup(await blob.text())
    expect(exported.selection.sceneCards).toBe(true)
    expect(exported.selection.scenes).toBe(false)
    expect(exported.backup.library.sceneCards).toHaveLength(3)
    expect(exported.backup.library.presets).toEqual([])
    expect(exported.selection.options).toBe(false)
    expect(write).not.toHaveBeenCalled()
  })

  it('defaults to append, shows before/after counts and leaves originals untouched', async () => {
    await read(
      makeTransferBackup(pixaiLibrary(), options, { ...backupSelection(false), scenes: true }, meta)
    )
    const incoming = panel('백업 가져오기')
    expect(check(incoming, '기존 자료에 추가').checked).toBe(true)
    expect(incoming.querySelector('[aria-label="적용 후 자료 수"]')?.textContent).toContain(
      '3개 → 6개'
    )
    expect(check(incoming, '캐릭터').disabled).toBe(true)
    expect(write).not.toHaveBeenCalled()
    await click(btn(incoming, '확인한 백업 적용'))
    expect(store.getState().workspace.library.scenes).toHaveLength(6)
    expect(store.getState().workspace.library.scenes.slice(0, 3)).toEqual(pixaiLibrary().scenes)
    expect(onImport).toHaveBeenCalledOnce()
  })

  it('lets the user narrow a full backup to chunks and explicitly replace only that list', async () => {
    const source = pixaiLibrary()
    source.scenes = [source.scenes[0]]
    source.scenes[0].prompt = 'new smile'
    await read(makeTransferBackup(source, { ...options, repeat: 9 }, backupSelection(), meta))
    const incoming = panel('백업 가져오기')
    expect(check(incoming, '생성·화면 설정').checked).toBe(false)
    await click(btn(incoming, '선택 해제'))
    expect(btn(incoming, '확인한 백업 적용').disabled).toBe(true)
    await click(check(incoming, '청크'))
    await click(check(incoming, '선택한 항목만 교체'))
    expect(incoming.textContent).toContain('교체 범위: 청크')
    expect(incoming.querySelector('[aria-label="적용 후 자료 수"]')?.textContent).toContain(
      '3개 → 1개'
    )
    await click(btn(incoming, '확인한 백업 적용'))
    expect(store.getState().workspace.library.scenes).toEqual(source.scenes)
    expect(store.getState().workspace.library.characters).toEqual(pixaiLibrary().characters)
    expect(store.getState().workspace.options.repeat).toBe(1)
  })

  it('disables applying a stale preview, while cancel leaves the library alone', async () => {
    await read(
      makeTransferBackup(pixaiLibrary(), options, { ...backupSelection(false), scenes: true }, meta)
    )
    await act(async () =>
      store.getState().editLibrary((library) => ({
        ...library,
        common: { prompt: 'later edit', negativePrompt: '' }
      }))
    )
    const incoming = panel('백업 가져오기')
    expect(incoming.textContent).toContain('미리보기 후 자료가 바뀌었습니다')
    expect(btn(incoming, '확인한 백업 적용').disabled).toBe(true)
    await click(btn(incoming, '취소'))
    expect(store.getState().workspace.library.scenes).toHaveLength(3)
    expect(onImport).not.toHaveBeenCalled()
  })
})
