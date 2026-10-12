// @vitest-environment happy-dom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ImageInformation } from '../src/renderer/src/pixai/image-info'
import { createPixaiStore, emptyWorkspace } from '../src/renderer/src/pixai/store'
import { pixaiLibrary } from './fixtures/pixai-workspace'
import { emptyDraft } from '../src/renderer/src/pixai/composition'
import type { ImageInfo } from '../src/shared/pixai/image-info'

let root: Root, container: HTMLDivElement
const result: ImageInfo = {
  format: 'png',
  width: 5,
  height: 3,
  raw: [{ label: 'test', text: '<script>not executable</script>' }],
  warnings: [],
  sources: [
    {
      label: 'file',
      fields: {
        prompt: 'imported',
        negativePrompt: '',
        seed: 42,
        seedKind: 'request',
        batchSize: 4
      }
    },
    { label: 'other', fields: { prompt: 'different' } }
  ]
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('nais', { invoke: vi.fn(async () => result) })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
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
function button(text: string): HTMLButtonElement {
  const b = [...container.querySelectorAll('button')].find((v) => v.textContent?.trim() === text)
  expect(b, text).toBeTruthy()
  return b!
}
async function click(text: string): Promise<void> {
  await act(async () => button(text).click())
}
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function setup() {
  const state = {
    ...emptyWorkspace(),
    library: pixaiLibrary(),
    composeDraft: { ...emptyDraft(), presetId: 'p1', characterId: 'c1', sceneIds: ['s1'] }
  }
  const storage = { read: async () => JSON.stringify(state), write: vi.fn(async () => {}) }
  const store = createPixaiStore(storage)
  await store.getState().hydrate()
  const onCompose = vi.fn()
  await act(async () => root.render(h(ImageInformation, { store, onCompose })))
  const input = container.querySelector<HTMLInputElement>('input[type=file]')!
  await act(async () => {
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['test'], 'sample.png')]
    })
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  return { store, storage, onCompose }
}
it('reading is read-only; explicit selection plus confirmation applies without generation or markup execution', async () => {
  const f = await setup()
  expect(f.storage.write).not.toHaveBeenCalled()
  expect(container.querySelector('script')).toBeNull()
  expect(button('선택 정보로 조합 열기').disabled).toBe(true)
  await act(async () =>
    container.querySelector<HTMLInputElement>('[aria-label="긍정 프롬프트 적용"]')!.click()
  )
  await click('선택 정보로 조합 열기')
  await click('취소')
  expect(f.storage.write).not.toHaveBeenCalled()
  await click('선택 정보로 조합 열기')
  await click('확인하고 새 조합 열기')
  expect(f.onCompose).toHaveBeenCalledOnce()
  expect(f.store.getState().workspace.library.scenes.at(-1)?.prompt).toBe('imported')
  expect(f.store.getState().workspace.jobs).toEqual([])
  expect(window.nais.invoke).toHaveBeenCalledTimes(1)
  expect(window.nais.invoke).toHaveBeenCalledWith('pixai:image-info', expect.anything())
})
it('switching source clears selections; saving a chunk does not switch the active composition', async () => {
  const f = await setup(),
    draft = f.store.getState().workspace.composeDraft
  await act(async () =>
    container.querySelector<HTMLInputElement>('[aria-label="긍정 프롬프트 적용"]')!.click()
  )
  await click('other')
  expect(button('선택 정보로 조합 열기').disabled).toBe(true)
  await click('이 출처 문구를 청크로 저장')
  expect(f.store.getState().workspace.composeDraft).toEqual(draft)
  expect(f.store.getState().workspace.library.scenes.at(-1)?.prompt).toBe('different')
  expect(f.onCompose).not.toHaveBeenCalled()
})
