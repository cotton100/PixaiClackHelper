// @vitest-environment happy-dom
import { act, createElement as h, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Compose } from '../src/renderer/src/pixai/compose'
import { emptyDraft } from '../src/renderer/src/pixai/composition'
import { createPixaiStore, emptyWorkspace } from '../src/renderer/src/pixai/store'
import { pixaiLibrary } from './fixtures/pixai-workspace'

let root: Root, container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('nais', { runtime: 'browser' })
  localStorage.clear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function fixture() {
  const storage = {
    read: async () => JSON.stringify({ ...emptyWorkspace(), library: pixaiLibrary() }),
    write: vi.fn(async () => {})
  }
  const store = createPixaiStore(storage)
  await store.getState().hydrate()
  function View(): React.JSX.Element {
    const [draft, setDraft] = useState({
      ...emptyDraft(),
      presetId: 'p1',
      characterId: 'c1',
      sceneIds: ['s2', 's1']
    })
    return h(Compose, { store, draft, onChange: setDraft, onSceneCreated: () => {} })
  }
  await act(async () => root.render(h(View)))
  return { store, storage, View }
}
async function click(name: string): Promise<void> {
  const button = [...container.querySelectorAll('button')].find(
    (b) =>
      b.textContent?.trim() === name ||
      b.getAttribute('aria-label') === name ||
      b.getAttribute('title') === name
  )
  expect(button, name).toBeTruthy()
  await act(async () => button!.click())
}
function summary(name: string): string {
  return container.querySelector(`[aria-label="${name} 현재 선택"]`)!.textContent!
}

it('keeps folded selections current and reserves exactly the selected materials and image options', async () => {
  const { store, storage, View } = await fixture()
  const before = structuredClone(store.getState().workspace)
  await click('프리셋·캐릭터 접기·펼치기')
  await click('청크 선택 접기·펼치기')
  expect(summary('프리셋·캐릭터')).toContain('기본 모델 · 캐릭터: Alice')
  expect(summary('청크 선택')).toBe('2개 · 손 흔듦 → 웃음')
  expect(store.getState().workspace).toEqual(before)
  expect(storage.write).not.toHaveBeenCalled()
  await act(async () => root.render(h(View, { key: 'remount' })))
  expect(
    container
      .querySelector('[data-compose-group="materials"] button')
      ?.getAttribute('aria-expanded')
  ).toBe('false')
  expect(
    container
      .querySelector('[data-compose-group="chunks"] .px-compose-group-body')
      ?.hasAttribute('hidden')
  ).toBe(true)
  await click('이미지 설정 접기·펼치기')
  await click('가로:세로 5:3')
  await click('4장 배치')
  await click('Ultra')
  await click('이미지 설정 접기·펼치기')
  expect(summary('이미지 설정')).toContain('5:3')
  expect(summary('이미지 설정')).toContain('4장')
  expect(summary('이미지 설정')).toContain('ultra')
  await click('이 조합 예약 추가')
  expect(store.getState().workspace.library.reservations[0]).toMatchObject({
    presetId: 'p1',
    characterId: 'c1',
    sceneIds: ['s2', 's1'],
    imageOptions: { aspectRatio: '5:3', batchSize: 4, mode: 'ultra' },
    snapshot: { chunks: [{ prompt: 'wave' }, { prompt: 'smile' }] }
  })
})

it('distinguishes unsaved seed from saved options across folding and follows external saved changes', async () => {
  const { store } = await fixture()
  await click('스타일·시드 공통 옵션 접기·펼치기')
  const field = container.querySelector<HTMLInputElement>('[aria-label="API 시드"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, '42')
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click('스타일·시드 공통 옵션 접기·펼치기')
  expect(summary('스타일·시드 공통 옵션')).toContain('저장값: 스타일 없음 · 시드 랜덤')
  expect(summary('스타일·시드 공통 옵션')).toContain('미저장 변경: 스타일 없음 · 시드 42')
  await click('스타일·시드 공통 옵션 접기·펼치기')
  expect(field.value).toBe('42')
  await click('스타일·시드 저장')
  expect(summary('스타일·시드 공통 옵션')).not.toContain('미저장')
  expect(store.getState().workspace.options.api?.seed).toBe(42)
  await act(async () =>
    store.getState().commit((w) => ({
      ...w,
      options: { ...w.options, api: { ...w.options.api, seed: 123, style: 'chibi' } }
    }))
  )
  expect(summary('스타일·시드 공통 옵션')).toContain('chibi · 시드 123')
  expect(field.value).toBe('123')
})

it('still folds without touching data when presentation storage fails', async () => {
  const { store, storage } = await fixture()
  const before = structuredClone(store.getState().workspace)
  vi.stubGlobal('localStorage', {
    setItem: () => {
      throw new Error('unavailable')
    }
  })
  await click('청크 선택 접기·펼치기')
  expect(
    container.querySelector('[data-compose-group="chunks"] button')?.getAttribute('aria-expanded')
  ).toBe('false')
  expect(summary('청크 선택')).toContain('손 흔듦 → 웃음')
  expect(container.textContent).toContain('접기 상태를 기억하지 못했습니다')
  expect(store.getState().workspace).toEqual(before)
  expect(storage.write).not.toHaveBeenCalled()
})
