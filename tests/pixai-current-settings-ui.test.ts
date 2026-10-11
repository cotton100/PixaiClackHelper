// @vitest-environment happy-dom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import PixaiApp from '../src/renderer/src/pixai/app'
import { ApiConnection } from '../src/renderer/src/pixai/execution'
import { createPixaiStore, emptyWorkspace } from '../src/renderer/src/pixai/store'
import { pixaiLibrary } from './fixtures/pixai-workspace'
let root: Root, container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
it('restores compose selections after unmount and restart and never writes empty defaults while hydrating', async () => {
  vi.stubGlobal('nais', { runtime: 'browser' })
  let saved = JSON.stringify({ ...emptyWorkspace(), library: pixaiLibrary() })
  const storage = {
    read: async () => saved,
    write: vi.fn(async (value: string) => {
      saved = value
    })
  }
  const store = createPixaiStore(storage)
  await act(async () => root.render(h(PixaiApp, { store })))
  expect(storage.write).not.toHaveBeenCalled()
  const pane = (): Element => container.querySelector('[aria-label="조합 재료"]')!
  const click = async (name: string): Promise<void> => {
    await act(async () =>
      [...pane().querySelectorAll('button')]
        .find((b) => b.getAttribute('aria-label') === name || b.textContent === name)!
        .click()
    )
  }
  await click('프리셋')
  await click('기본 모델')
  await click('캐릭터')
  await act(async () =>
    pane().querySelector<HTMLButtonElement>('button[aria-label="캐릭터 폴더 미분류"]')!.click()
  )
  await click('Bob')
  await act(async () =>
    store.getState().commit((w) => ({
      ...w,
      composeDraft: { ...w.composeDraft!, sceneIds: ['s2', 's1'], triggerPosition: 'end', count: 3 }
    }))
  )
  const before = saved
  await act(async () => root.unmount())
  root = createRoot(container)
  const restarted = createPixaiStore(storage)
  await act(async () => root.render(h(PixaiApp, { store: restarted })))
  expect(saved).toBe(before)
  expect(pane().querySelector('.px-selection-summary')?.textContent).toContain('기본 모델')
  expect(restarted.getState().workspace.composeDraft).toMatchObject({
    characterId: 'c2',
    sceneIds: ['s2', 's1'],
    triggerPosition: 'end',
    count: 3
  })
})
it('shows the remembered API-key choice from storage and clears it after forgetting', async () => {
  const invoke = vi.fn(async (channel: string) => ({
    connected: channel !== 'pixai:forget',
    remembered: channel !== 'pixai:forget',
    encryptionAvailable: true,
    outputDir: 'C:/fixture',
    maxInFlight: 4
  }))
  vi.stubGlobal('nais', { runtime: 'electron', invoke })
  await act(async () => root.render(h(ApiConnection)))
  expect(container.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(true)
  await act(async () =>
    [...container.querySelectorAll('button')]
      .find((b) => b.textContent === '연결 해제·저장된 키 삭제')!
      .click()
  )
  expect(container.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false)
})

it('keeps repeat input enabled during slow saves and waits before enabling update controls', async () => {
  vi.stubGlobal('nais', { runtime: 'browser' })
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let saved = JSON.stringify({ ...emptyWorkspace(), library: pixaiLibrary() })
  const store = createPixaiStore({
    read: async () => saved,
    write: async (value) => {
      await gate
      saved = value
    }
  })
  await act(async () => root.render(h(PixaiApp, { store })))
  const input = container.querySelector<HTMLInputElement>('[aria-label="조합 생성 횟수"]')!
  input.focus()
  for (const value of ['', '1', '12']) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(container.querySelector('fieldset')!.disabled).toBe(false)
    expect(document.activeElement).toBe(input)
  }
  expect(store.getState().draftSaving).toBe(true)
  expect(store.getState().workspace.composeDraft?.count).toBe(12)
  await act(async () =>
    [...container.querySelectorAll('.px-nav button')]
      .find((b) => b.textContent === '설정')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
  )
  expect(container.querySelector('fieldset')!.disabled).toBe(true)
  await act(async () => {
    release()
    await gate
  })
  expect(container.querySelector('fieldset')!.disabled).toBe(false)
  expect(JSON.parse(saved).composeDraft.count).toBe(12)
})
