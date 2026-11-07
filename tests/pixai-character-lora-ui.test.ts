// @vitest-environment happy-dom
import { act, createElement as h, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LibraryEditor } from '../src/renderer/src/pixai/library-editor'
import { Compose } from '../src/renderer/src/pixai/compose'
import { emptyDraft } from '../src/renderer/src/pixai/composition'
import { Scenes } from '../src/renderer/src/pixai/scenes'
import { BackupSettings } from '../src/renderer/src/pixai/settings'
import { importImageComposition, noImageSelection } from '../src/renderer/src/pixai/image-import'
import { createPixaiStore, emptyWorkspace, readWorkspace } from '../src/renderer/src/pixai/store'
import { pixaiLibrary } from './fixtures/pixai-workspace'
import { expandReservations, type LoraRef } from '../src/shared/pixai/library'
import { buildPayload } from '../src/shared/pixai/execution'

let root: Root, container: HTMLDivElement
let store: ReturnType<typeof createPixaiStore>, saved: string
const characterLora: LoraRef = {
  id: '30',
  versionId: '300',
  name: '전용 LoRA',
  weight: 0.7,
  triggerWords: 'character-trigger'
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('nais', { runtime: 'browser' })
  localStorage.clear()
  saved = JSON.stringify({ ...emptyWorkspace(), library: pixaiLibrary() })
  store = createPixaiStore({
    read: async () => saved,
    write: async (value) => {
      saved = value
    }
  })
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
function button(name: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find(
    (element) => element.getAttribute('aria-label') === name || element.textContent?.trim() === name
  )
  if (!match) throw new Error(`Missing button: ${name}`)
  return match
}
async function click(name: string): Promise<void> {
  await act(async () => button(name).click())
}
function field(name: string): HTMLInputElement {
  const element = container.querySelector<HTMLInputElement>(`[aria-label="${name}"]`)
  if (!element) throw new Error(`Missing input: ${name}`)
  return element
}
async function input(name: string, value: string): Promise<void> {
  const element = field(name)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function save(): Promise<void> {
  await act(async () =>
    button('재료 저장')
      .closest('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  )
}
async function attach(loras: LoraRef[] = [characterLora]): Promise<void> {
  await act(async () =>
    store.getState().editLibrary((library) => ({
      ...library,
      characters: library.characters.map((item, i) => (i === 0 ? { ...item, loras } : item))
    }))
  )
}
function TestCompose(): React.JSX.Element {
  const [draft, setDraft] = useState({
    ...emptyDraft(),
    presetId: 'p1',
    characterId: 'c1',
    sceneIds: ['s1'],
    triggerPosition: 'end' as const
  })
  return h(Compose, { store, draft, onChange: setDraft, onSceneCreated: vi.fn() })
}
const preview = (): string =>
  container.querySelector<HTMLTextAreaElement>('textarea[readonly]')!.value

it('edits character LoRAs through the shared link and weight controls, saves, duplicates and restores them', async () => {
  await act(async () => root.render(h(LibraryEditor, { store })))
  await click('캐릭터 폴더 미분류')
  await click('Alice')
  await click('캐릭터 LoRA 추가')
  await input('캐릭터 LoRA 1 링크', 'https://pixai.art/model/30/300')
  await click('캐릭터 LoRA 1 정보 가져오기')
  await click('이 정보 적용')
  await input('캐릭터 LoRA 1 이름', '전용 LoRA')
  await input('캐릭터 LoRA 1 트리거 문구', 'character-trigger')
  await input('캐릭터 LoRA 1 가중치', '0.7')
  expect(store.getState().workspace.library.characters[0].loras).toBeUndefined()
  await save()
  expect(readWorkspace(saved).library.characters[0].loras).toEqual([characterLora])
  await click('복제')
  expect(store.getState().workspace.library.characters.at(-1)?.loras).toEqual([characterLora])
  await click('Alice 사본')
  await input('캐릭터 LoRA 1 가중치', '0.4')
  await save()
  await click('Alice')
  expect(field('캐릭터 LoRA 1 가중치').value).toBe('0.7')
  await act(async () => root.unmount())
  root = createRoot(container)
  store = createPixaiStore({
    read: async () => saved,
    write: async (value) => {
      saved = value
    }
  })
  await store.getState().hydrate()
  await act(async () => root.render(h(LibraryEditor, { store })))
  await click('캐릭터 폴더 미분류')
  await click('Alice')
  expect(field('캐릭터 LoRA 1 트리거 문구').value).toBe('character-trigger')
  await click('이 LoRA 빼기')
  await save()
  expect(store.getState().workspace.library.characters[0].loras ?? []).toEqual([])
  await click('Bob')
  expect(container.querySelector('[aria-label="캐릭터 LoRA 1 ID"]')).toBeNull()
  expect(store.getState().workspace.library.characters.at(-1)?.loras?.[0].weight).toBe(0.4)
})

it('shows merged sources, updates with character selection and freezes a reservation without double triggers', async () => {
  const style = store.getState().workspace.library.presets[0].loras[0]
  await attach([{ ...style, name: '캐릭터의 동일 LoRA' }, characterLora])
  await act(async () => root.render(h(TestCompose)))
  expect(preview()).toBe('quality, alice, smile, trigger, character-trigger')
  const summary = container.querySelector('[aria-label="최종 적용 LoRA"]')!
  expect(summary.textContent).toContain('2개')
  expect(summary.textContent).toContain('프리셋 + 캐릭터')
  expect(summary.textContent).toContain('전용 LoRA × 0.7')
  await click('이 조합 예약 추가')
  const reservation = store.getState().workspace.library.reservations[0]
  expect(reservation.snapshot!.preset.loras).toEqual([style, characterLora])
  expect(reservation.snapshot!.character).not.toHaveProperty('loras')
  await attach([{ ...characterLora, weight: 0.4, triggerWords: 'new-trigger' }])
  expect(preview()).toBe('quality, alice, smile, trigger, new-trigger')
  expect(store.getState().workspace.library.reservations[0]).toEqual(reservation)
  await click('캐릭터')
  await click('캐릭터 폴더 미분류')
  await click('Bob')
  expect(preview()).toBe('quality, bob, smile, trigger')
  expect(container.querySelector('[aria-label="최종 적용 LoRA"]')!.textContent).not.toContain(
    '전용 LoRA'
  )
})

it('blocks conflicting or API-invalid merged LoRAs with visible errors and no reservation writes', async () => {
  const style = store.getState().workspace.library.presets[0].loras[0]
  await attach([{ ...style, weight: 0.9 }])
  await act(async () => root.render(h(TestCompose)))
  expect(container.querySelector('[role="alert"]')).toBeTruthy()
  expect(button('이 조합 예약 추가').disabled).toBe(true)
  expect(preview()).toBe('')
  await click('이 조합 예약 추가')
  expect(store.getState().workspace.library.reservations).toHaveLength(0)
  await attach([{ ...characterLora, weight: 1.5 }])
  expect(container.querySelector('[role="alert"]')!.textContent).toContain('0~1')
  expect(button('이 조합 예약 추가').disabled).toBe(true)
  // The editable prompt remains inspectable for an API-range error.
  expect(preview()).toContain('character-trigger')
  await attach([characterLora])
  expect(button('이 조합 예약 추가').disabled).toBe(false)
})

it.each(['weight', 'version'] as const)(
  'retains legacy preset-only reservations and favorites while still refusing API-invalid execution (%s)',
  async (problem) => {
    await store.getState().editLibrary((library) => ({
      ...library,
      presets: library.presets.map((preset) => ({
        ...preset,
        loras:
          problem === 'weight'
            ? preset.loras.map((lora) => ({ ...lora, weight: 1.2 }))
            : [...preset.loras, { ...preset.loras[0], id: '99' }]
      }))
    }))
    await act(async () => root.render(h(TestCompose)))
    expect(button('이 조합 예약 추가').disabled).toBe(false)
    await click('현재 조합 즐겨찾기')
    await click('이 조합 예약 추가')
    const workspace = store.getState().workspace
    expect(workspace.library.combinations?.filter((item) => item.favorite)).toHaveLength(1)
    expect(workspace.library.reservations[0].snapshot!.preset.loras).toEqual(
      workspace.library.presets[0].loras
    )
    const request = expandReservations(workspace.library)[0]
    expect(() => buildPayload({ request, options: workspace.options, imageCount: 4 }, 1)).toThrow(
      problem === 'weight' ? '0~1' : '같은 LoRA 버전'
    )
  }
)

it('shows character LoRAs in the scene sample and reserves the displayed frozen settings', async () => {
  await attach()
  await act(async () => root.render(h(Scenes, { store, onOpen: vi.fn() })))
  await click('캐릭터 폴더 미분류')
  await act(async () => field('행 Alice').click())
  await act(async () => field('씬 웃음').click())
  const summary = container.querySelector('[aria-label="최종 적용 LoRA"]')!
  expect(summary.textContent).toContain('전용 LoRA × 0.7')
  expect(summary.textContent).toContain('캐릭터')
  expect(
    container.querySelector('[aria-label="씬 조합 포지티브 미리보기"]')!.textContent
  ).toContain('character-trigger')
  await click('선택 조합 전부 예약')
  expect(store.getState().workspace.library.reservations[0].snapshot!.preset.loras).toHaveLength(2)
  expect(store.getState().workspace.library.reservations[0].snapshot!.character).not.toHaveProperty(
    'loras'
  )
})

it('keeps character LoRAs when image import replaces only prompts and blocks lossy legacy export without breaking settings', async () => {
  await attach()
  const workspace = store.getState().workspace
  workspace.composeDraft = { ...emptyDraft(), presetId: 'p1', characterId: 'c1', sceneIds: ['s1'] }
  let nextId = 0
  const next = importImageComposition(
    workspace,
    { prompt: 'imported prompt' },
    {
      ...noImageSelection(),
      prompt: true
    },
    'test image',
    () => `import-${++nextId}`
  )
  expect(next.library.presets.at(-1)!.loras).toEqual(
    [...workspace.library.presets[0].loras, characterLora].map((lora) => ({
      ...lora,
      triggerWords: ''
    }))
  )
  expect(next.library.characters.at(-1)).not.toHaveProperty('loras')
  await act(async () => root.render(h(BackupSettings, { store, onImport: vi.fn() })))
  await click('스크립트용 내보내기')
  expect(container.querySelector('[role="alert"]')!.textContent).toContain('LoRA')
  expect(button('백업 파일 저장').disabled).toBe(true)
  await click('취소')
  await click('앱용 내보내기')
  expect(button('백업 파일 저장').disabled).toBe(false)
})

const replacementImage = {
  prompt: 'new positive',
  negativePrompt: 'new negative',
  modelId: '90',
  modelVersionId: '900',
  loras: [{ id: '91', versionId: '910', weight: 0.2 }]
}

it('can replace model and both prompts even when the discarded combination has conflicting LoRAs and missing chunks', async () => {
  const style = store.getState().workspace.library.presets[0].loras[0]
  await attach([{ ...style, weight: 0.9 }])
  const workspace = structuredClone(store.getState().workspace)
  workspace.composeDraft = {
    ...emptyDraft(),
    presetId: 'p1',
    characterId: 'c1',
    sceneIds: ['missing']
  }
  const before = structuredClone(workspace)
  const idFactory = vi.fn(() => `new-${idFactory.mock.calls.length}`)
  const next = importImageComposition(
    workspace,
    replacementImage,
    {
      ...noImageSelection(),
      model: true,
      prompt: true,
      negativePrompt: true
    },
    'replacement',
    idFactory
  )
  expect(next.library.presets.at(-1)!.model.versionId).toBe('900')
  expect(next.library.presets.at(-1)!.loras[0].versionId).toBe('910')
  expect(next.library.scenes.at(-1)).toMatchObject({
    prompt: 'new positive',
    negativePrompt: 'new negative'
  })
  expect(idFactory).toHaveBeenCalledTimes(4)
  expect(workspace).toEqual(before)
})

it('can preserve only the previous negative prompt without resolving discarded conflicting LoRAs', async () => {
  const style = store.getState().workspace.library.presets[0].loras[0]
  await attach([{ ...style, weight: 0.9 }])
  const workspace = structuredClone(store.getState().workspace)
  workspace.library.presets[0].negativePrompt = 'preset negative'
  workspace.library.characters[0].negativePrompt = 'character negative'
  workspace.library.scenes[0].negativePrompt = 'chunk negative'
  workspace.composeDraft = { ...emptyDraft(), presetId: 'p1', characterId: 'c1', sceneIds: ['s1'] }
  const before = structuredClone(workspace)
  let id = 0
  const next = importImageComposition(
    workspace,
    replacementImage,
    {
      ...noImageSelection(),
      model: true,
      prompt: true
    },
    'negative retained',
    () => `new-${++id}`
  )
  expect(next.library.scenes.at(-1)).toMatchObject({
    prompt: 'new positive',
    negativePrompt: 'blur, preset negative, character negative, chunk negative'
  })
  expect(next.library.presets.at(-1)!.loras[0].versionId).toBe('910')
  expect(workspace).toEqual(before)
})

it.each([
  { model: false, prompt: true, negativePrompt: true },
  { model: true, prompt: false, negativePrompt: true }
])(
  'still refuses conflicting LoRAs when retaining old model or positive prompt (%j)',
  async (selection) => {
    const style = store.getState().workspace.library.presets[0].loras[0]
    await attach([{ ...style, weight: 0.9 }])
    const workspace = structuredClone(store.getState().workspace)
    workspace.composeDraft = {
      ...emptyDraft(),
      presetId: 'p1',
      characterId: 'c1',
      sceneIds: ['s1']
    }
    const before = structuredClone(workspace)
    const idFactory = vi.fn(() => 'unused')
    expect(() =>
      importImageComposition(
        workspace,
        replacementImage,
        {
          ...noImageSelection(),
          ...selection
        },
        'refused',
        idFactory
      )
    ).toThrow()
    expect(idFactory).not.toHaveBeenCalled()
    expect(workspace).toEqual(before)
  }
)
