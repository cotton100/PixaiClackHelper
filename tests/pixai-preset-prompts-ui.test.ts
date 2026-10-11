// @vitest-environment happy-dom
import { act, createElement as h, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Compose } from '../src/renderer/src/pixai/compose'
import { emptyDraft } from '../src/renderer/src/pixai/composition'
import { BackupSettings } from '../src/renderer/src/pixai/settings'
import { LibraryEditor } from '../src/renderer/src/pixai/library-editor'
import { createPixaiStore, emptyWorkspace } from '../src/renderer/src/pixai/store'
import { normalizeSnapshot } from '../src/shared/pixai/library'
import { pixaiLibrary } from './fixtures/pixai-workspace'

let root: Root, container: HTMLDivElement
let store: ReturnType<typeof createPixaiStore>
let writes: string[]
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  writes = []
  const storage = {
    read: vi.fn(async () => JSON.stringify({ ...emptyWorkspace(), library: pixaiLibrary() })),
    write: vi.fn(async (value: string) => {
      writes.push(value)
    })
  }
  store = createPixaiStore(storage)
  await store.getState().hydrate()
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
const button = (name: string): HTMLButtonElement => {
  const match = [...container.querySelectorAll('button')].find(
    (element) => element.getAttribute('aria-label') === name || element.textContent?.trim() === name
  )
  if (!match) throw new Error(`Missing button: ${name}`)
  return match
}
const field = (name: string): HTMLTextAreaElement =>
  container.querySelector(`[aria-label="${name}"]`) as HTMLTextAreaElement
async function click(name: string): Promise<void> {
  await act(async () => button(name).click())
}
async function type(name: string, value: string): Promise<void> {
  const element = field(name)
  if (!element) throw new Error(`Missing field: ${name}`)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      element,
      value
    )
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function submit(name: string): Promise<void> {
  await act(async () =>
    button(name)
      .closest('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  )
}
async function renderLibrary(): Promise<void> {
  await act(async () => root.render(h(LibraryEditor, { store })))
  await click('프리셋')
  await click('기본 모델테스트 모델 · LoRA 1')
}

describe('preset common prompts in the UI', () => {
  it('saves, restores, duplicates and keeps the preset text out of other presets', async () => {
    await renderLibrary()
    expect(field('이 프리셋의 공통 포지').value).toBe('')
    expect(container.textContent).toContain('전역 공통문과 함께 적용됩니다')
    await type('이 프리셋의 공통 포지', 'preset-style')
    await type('이 프리셋의 공통 네거', 'preset-bad')
    // typing alone does not save
    expect(store.getState().workspace.library.presets[0].prompt).toBeUndefined()
    await submit('재료 저장')
    const saved = store.getState().workspace.library.presets[0]
    expect(saved).toMatchObject({ prompt: 'preset-style', negativePrompt: 'preset-bad' })
    expect(writes.at(-1)).toContain('preset-style')
    // remount = restart: the fields show the stored values
    await act(async () => root.unmount())
    root = createRoot(container)
    await renderLibrary()
    expect(field('이 프리셋의 공통 포지').value).toBe('preset-style')
    expect(field('이 프리셋의 공통 네거').value).toBe('preset-bad')
    await click('복제')
    const presets = store.getState().workspace.library.presets
    expect(presets).toHaveLength(2)
    expect(presets[1]).toMatchObject({
      name: '기본 모델 사본',
      prompt: 'preset-style',
      negativePrompt: 'preset-bad'
    })
    // switching to the copy and back shows each preset's own text, with no mixing
    await click('기본 모델 사본테스트 모델 · LoRA 1')
    await type('이 프리셋의 공통 포지', 'copy-style')
    await submit('재료 저장')
    await click('기본 모델테스트 모델 · LoRA 1')
    expect(field('이 프리셋의 공통 포지').value).toBe('preset-style')
    expect(store.getState().workspace.library.presets.map((preset) => preset.prompt)).toEqual([
      'preset-style',
      'copy-style'
    ])
    // a brand-new preset starts empty and saving it never copies another preset's text
    await click('추가')
    expect(field('이 프리셋의 공통 포지').value).toBe('')
    expect(field('이 프리셋의 공통 네거').value).toBe('')
  })

  it('shows the merged common block in the compose preview and labels it when the preset has text', async () => {
    await store.getState().editLibrary((library) => ({
      ...library,
      presets: library.presets.map((preset) => ({
        ...preset,
        prompt: 'preset-style',
        negativePrompt: 'preset-bad'
      }))
    }))
    function TestCompose(): React.JSX.Element {
      const [draft, setDraft] = useState({
        ...emptyDraft(),
        presetId: 'p1',
        characterId: 'c1',
        sceneIds: ['s1']
      })
      return h(Compose, { store, draft, onChange: setDraft, onSceneCreated: vi.fn() })
    }
    await act(async () => root.render(h(TestCompose)))
    const preview = [...container.querySelectorAll('textarea')].find((element) => element.readOnly)!
    expect(preview.value).toBe('quality, preset-style, trigger, alice, smile')
    expect(field('네거티브 미리보기').value).toBe('blur, preset-bad')
    expect(container.textContent).toContain('공통문 + 프리셋 문구')
    expect(container.textContent).toContain(
      '프리셋 「기본 모델」의 공통 포지·네거가 공통문 블록에 포함됩니다'
    )
    await click('이 조합 예약 추가')
    const [reservation] = store.getState().workspace.library.reservations
    expect(reservation.snapshot?.preset).toMatchObject({
      prompt: 'preset-style',
      negativePrompt: 'preset-bad'
    })
    // clearing the preset text afterwards changes the preview but not the stored copy
    await act(async () => {
      await store.getState().editLibrary((library) => ({
        ...library,
        presets: library.presets.map((preset) => ({ ...preset, prompt: '', negativePrompt: '' }))
      }))
    })
    await act(async () => root.render(h(TestCompose)))
    const after = [...container.querySelectorAll('textarea')].find((element) => element.readOnly)!
    expect(after.value).toBe('quality, trigger, alice, smile')
    expect(container.textContent).not.toContain('공통문 + 프리셋 문구')
    expect(store.getState().workspace.library.reservations[0].snapshot?.preset.prompt).toBe(
      'preset-style'
    )
  })

  it('tells the user which preset text and reservations a script export will lose', async () => {
    await store.getState().editLibrary((library) => {
      const preset = { ...library.presets[0], prompt: 'preset-style', negativePrompt: '' }
      return {
        ...library,
        presets: [preset],
        reservations: [
          {
            id: 'r1',
            presetId: 'p1',
            characterId: 'c1',
            sceneIds: ['s1'],
            count: 1,
            snapshot: normalizeSnapshot({
              common: library.common,
              preset,
              character: library.characters[0],
              chunks: [library.scenes[0]]
            })
          },
          {
            id: 'r2',
            presetId: 'p1',
            characterId: 'c2',
            sceneIds: ['s1'],
            count: 1,
            snapshot: normalizeSnapshot({
              common: library.common,
              preset: library.presets[0],
              character: library.characters[1],
              chunks: [library.scenes[0]]
            })
          }
        ],
        combinations: [
          {
            id: 'k1',
            presetId: 'p1',
            characterId: 'c1',
            sceneIds: ['s1'],
            count: 1,
            favorite: true,
            name: 'fav',
            at: 1
          }
        ]
      }
    })
    await store.getState().editLibrary((library) => ({
      ...library,
      reservations: [
        ...library.reservations,
        {
          id: 'legacy',
          presetId: 'p1',
          characterId: 'c1',
          sceneIds: ['s1'],
          count: 1
        }
      ]
    }))
    await act(async () => root.render(h(BackupSettings, { store, onImport: vi.fn() })))
    await click('스크립트용 내보내기')
    const text = container.textContent ?? ''
    expect(text).toContain('예약 2개를 제외합니다 (그중 프리셋 공통 문구가 든 예약 2개)')
    expect(text).toContain('프리셋 「기본 모델」의 공통 포지·네거는 스크립트가 읽지 못해 빠집니다')
    expect(text).toContain('최근 조합·즐겨찾기 1개도 문구 없이 불러와집니다')
    expect(text).toContain('프리셋 공통 포지·네거')
  })
})
