// @vitest-environment happy-dom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { LibraryEditor } from '../src/renderer/src/pixai/library-editor'
import { Compose } from '../src/renderer/src/pixai/compose'
import { emptyDraft } from '../src/renderer/src/pixai/composition'
import { createPixaiStore, emptyWorkspace, readWorkspace } from '../src/renderer/src/pixai/store'
import { makeSettingsBackup } from '../src/shared/pixai/library'
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
  vi.unstubAllGlobals()
})
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function fixture() {
  let saved = JSON.stringify({ ...emptyWorkspace(), library: pixaiLibrary() })
  const storage = {
    read: async () => saved,
    write: vi.fn(async (value: string) => {
      saved = value
    })
  }
  const store = createPixaiStore(storage)
  await store.getState().hydrate()
  return { store, storage, saved: () => saved }
}
function button(name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label') === name || b.textContent?.trim() === name
  )
  expect(found, name).toBeTruthy()
  return found!
}
async function click(name: string): Promise<void> {
  await act(async () => button(name).click())
}
async function field(label: string, value: string): Promise<void> {
  const element = container.querySelector<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >(`[aria-label="${label}"]`)!
  expect(element, label).toBeTruthy()
  await act(async () => {
    const proto =
      element.tagName === 'SELECT'
        ? HTMLSelectElement.prototype
        : element.tagName === 'TEXTAREA'
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value)
    element.dispatchEvent(
      new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })
    )
  })
}
async function submit(name: string): Promise<void> {
  await act(async () =>
    button(name)
      .closest('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  )
}

it('creates and links common sets, previews the applied tags, freezes direct reservations and unlinks on deletion', async () => {
  const { store, saved } = await fixture()
  await act(async () => root.render(h(LibraryEditor, { store })))
  await click('공통문')
  await click('추가')
  await field('공통문 세트 이름', '파스텔')
  await field('공통 포지', 'pastel, soft light')
  await field('공통 네거', 'harsh light')
  await submit('공통문 저장')
  const id = store.getState().workspace.library.commonPresets![0].id
  expect(button('파스텔').textContent).toContain('pastel, soft light')
  await click('프리셋')
  await click('기본 모델')
  await field('연결할 공통문 세트', id)
  await submit('재료 저장')
  expect(button('기본 모델').textContent).toContain('pastel, soft light')
  expect(readWorkspace(saved()).library.presets[0].commonPresetId).toBe(id)
  await act(async () =>
    root.render(
      h(Compose, {
        store,
        draft: { ...emptyDraft(), presetId: 'p1', characterId: 'c1', sceneIds: ['s1'] },
        onChange: () => {},
        onSceneCreated: () => {}
      })
    )
  )
  await click('이 조합 예약 추가')
  expect(store.getState().workspace.library.reservations[0].snapshot!.common).toEqual({
    prompt: 'pastel, soft light',
    negativePrompt: 'harsh light'
  })
  await act(async () => root.render(h(LibraryEditor, { store })))
  await click('공통문')
  await click('파스텔')
  await click('삭제')
  expect(container.querySelector('[role=alertdialog]')!.textContent).toContain('프리셋 1개')
  await click('삭제 확인')
  expect(store.getState().workspace.library.presets[0]).not.toHaveProperty('commonPresetId')
  expect(store.getState().workspace.library.reservations[0].snapshot!.common.prompt).toBe(
    'pastel, soft light'
  )
})

it('copies the current draft, protects unsaved edits and retains input after a failed save', async () => {
  const { store, storage } = await fixture()
  await act(async () => root.render(h(LibraryEditor, { store })))
  await click('공통문')
  await field('공통 포지', 'draft quality')
  await click('복제')
  expect(container.querySelector<HTMLTextAreaElement>('[aria-label="공통 포지"]')!.value).toBe(
    'draft quality'
  )
  await click('프리셋')
  expect(container.querySelector('[role=alertdialog]')).toBeTruthy()
  // Cancel navigation, then fail the actual save: nothing must be persisted or discarded.
  const dialog = container.querySelector('[role=alertdialog]')!
  await act(async () =>
    [...dialog.querySelectorAll('button')].find((b) => b.textContent === '취소')!.click()
  )
  storage.write.mockRejectedValueOnce(new Error('disk full'))
  await submit('공통문 저장')
  expect(container.textContent).toContain('변경 사항은 적용되지 않았습니다')
  expect(store.getState().workspace.library.commonPresets).toBeUndefined()
  expect(container.querySelector<HTMLTextAreaElement>('[aria-label="공통 포지"]')!.value).toBe(
    'draft quality'
  )
  await submit('공통문 저장')
  expect(store.getState().workspace.library.commonPresets![0].prompt).toBe('draft quality')
  expect(store.getState().workspace.library.common.prompt).toBe('quality')
})

it.each([
  ['default', 'set-1'],
  ['same-set', 'set-1'],
  ['removed-set', 'set-1'],
  ['same-set', 'default'],
  ['removed-set', 'default']
] as const)(
  'refreshes the mounted clean common editor after backup import (%s, id=%s)',
  async (mode, id) => {
    const { store } = await fixture()
    // 'default' is a valid imported set ID and must not share the default editor key.
    await store
      .getState()
      .editLibrary((library) => ({
        ...library,
        commonPresets: [
          { id, name: '기존 세트', prompt: 'old-set', negativePrompt: 'old-negative' }
        ]
      }))
    await act(async () => root.render(h(LibraryEditor, { store })))
    await click('공통문')
    if (mode !== 'default') await click('기존 세트')
    const library = pixaiLibrary()
    library.common = { prompt: 'imported-default', negativePrompt: 'imported-default-negative' }
    library.commonPresets =
      mode === 'removed-set'
        ? []
        : [{ id, name: '가져온 세트', prompt: 'imported-set', negativePrompt: 'imported-negative' }]
    const backup = makeSettingsBackup(library, store.getState().workspace.options, {
      appVersion: '0.1.10',
      exportedAt: new Date().toISOString()
    })
    // The app hides tabs instead of unmounting them; import through the real store path.
    container.hidden = true
    await act(async () => store.getState().importBackup(backup, store.getState().revision))
    container.hidden = false
    const expected = mode === 'same-set' ? 'imported-set' : 'imported-default'
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="공통 포지"]')!.value).toBe(
      expected
    )
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="공통 네거"]')!.value).toBe(
      mode === 'same-set' ? 'imported-negative' : 'imported-default-negative'
    )
    const form = button('공통문 저장').closest('form')!
    expect(form.querySelector('small')!.textContent).toBe('저장됨')
    if (mode === 'removed-set')
      expect(button('기본 공통문').getAttribute('aria-pressed')).toBe('true')
    const imported = JSON.stringify(store.getState().workspace.library)
    await submit('공통문 저장')
    expect(JSON.stringify(store.getState().workspace.library)).toBe(imported)
  }
)

it('does not discard a dirty common draft when the stored item changes', async () => {
  const { store } = await fixture()
  await act(async () => root.render(h(LibraryEditor, { store })))
  await click('공통문')
  await field('공통 포지', 'unsaved typing')
  await act(async () =>
    store
      .getState()
      .editLibrary((library) => ({
        ...library,
        common: { prompt: 'external', negativePrompt: '' }
      }))
  )
  expect(container.querySelector<HTMLTextAreaElement>('[aria-label="공통 포지"]')!.value).toBe(
    'unsaved typing'
  )
  expect(button('공통문 저장').closest('form')!.querySelector('small')!.textContent).toBe(
    '저장 안 됨'
  )
  expect(store.getState().workspace.library.common.prompt).toBe('external')
})
