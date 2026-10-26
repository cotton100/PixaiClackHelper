// @vitest-environment happy-dom
import { act, Children, createElement as h, type ReactElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Scenes } from '../src/renderer/src/pixai/scenes'
import { createPixaiStore, emptyWorkspace } from '../src/renderer/src/pixai/store'
import { buildPayload } from '../src/shared/pixai/execution'
import { pixaiLibrary } from './fixtures/pixai-workspace'

type DragEnd = (event: { active: { id: string }; over: { id: string } }) => void
const dragHarness = vi.hoisted(() => ({
  blocks: undefined as DragEnd | undefined,
  extras: undefined as DragEnd | undefined
}))
// Keep SortableItems' actual drag-end and arrayMove path. Browser hit testing and
// physical keyboard/pointer sensors need a real window, not happy-dom's zero-size layout.
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@dnd-kit/core')>()
  return {
    ...original,
    DndContext: (props: { children: ReactNode; onDragEnd: DragEnd }): ReactNode => {
      const ids = (Children.toArray(props.children)[0] as ReactElement<{ items: string[] }>).props
        .items
      if (ids.includes('character')) dragHarness.blocks = props.onDragEnd
      if (ids.includes('extra1') || ids.includes('extra2')) dragHarness.extras = props.onDragEnd
      return props.children
    }
  }
})

let root: Root, container: HTMLDivElement
let store: ReturnType<typeof createPixaiStore>
let saved: string
let write: ReturnType<typeof vi.fn>

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  dragHarness.blocks = undefined
  dragHarness.extras = undefined
  const library = pixaiLibrary()
  library.characters[0].negativePrompt = 'bad anatomy'
  library.chunkFolders = [{ id: 'lighting', name: '빛과 날씨' }]
  library.scenes.push(
    {
      id: 'extra1',
      name: '역광',
      prompt: 'backlight',
      negativePrompt: 'harsh shadows',
      folderId: 'lighting'
    },
    { id: 'extra2', name: '비', prompt: 'rain', negativePrompt: 'rain drops', folderId: 'lighting' }
  )
  saved = JSON.stringify({ ...emptyWorkspace(), library })
  write = vi.fn(async (text: string) => {
    saved = text
  })
  store = createPixaiStore({ read: async () => saved, write })
  await store.getState().hydrate()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(h(Scenes, { store, onOpen: vi.fn() })))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function field(name: string): HTMLInputElement {
  const match = container.querySelector<HTMLInputElement>(`[aria-label="${name}"]`)
  if (!match) throw new Error(`Missing field: ${name}`)
  return match
}
function button(name: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find(
    (item) => item.getAttribute('aria-label') === name || item.textContent?.trim() === name
  )
  if (!match) throw new Error(`Missing button: ${name}`)
  return match
}
async function click(name: string): Promise<void> {
  await act(async () => button(name).click())
}
async function check(name: string): Promise<void> {
  await act(async () => field(name).click())
}
async function input(name: string, value: string): Promise<void> {
  const element = field(name)
  await act(async () => {
    const proto =
      element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value)
    element.dispatchEvent(
      new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })
    )
  })
}
async function drop(kind: 'blocks' | 'extras', active: string, over: string): Promise<void> {
  expect(dragHarness[kind]).toBeTypeOf('function')
  await act(async () => dragHarness[kind]!({ active: { id: active }, over: { id: over } }))
}
async function selectPair(): Promise<void> {
  await click('캐릭터 폴더 미분류')
  await check('행 Alice')
  await check('씬 웃음')
}

describe('scene extra chunks and prompt order UI', () => {
  it('selects a collapsed folder, previews every chunk, and retains the selection summary when folded', async () => {
    await selectPair()
    expect(button('추가 청크 폴더 빛과 날씨').getAttribute('aria-expanded')).toBe('false')
    await check('추가 청크 폴더 빛과 날씨 선택')
    expect(field('씬 조합 포지티브 미리보기').textContent).toBe(
      'quality, trigger, alice, smile, backlight, rain'
    )
    expect(container.querySelector('.px-totals')!.textContent).toBe('1조합 · 1작업 · 4장')
    await click('추가 청크·문구 순서 접기·펼치기')
    expect(button('추가 청크·문구 순서 접기·펼치기').getAttribute('aria-expanded')).toBe('false')
    expect(field('추가 청크·문구 순서 현재 선택').textContent).toContain('2개 · 역광, 비')
    expect(field('추가 청크·문구 순서 현재 선택').textContent).toContain('캐릭터 → 씬 → 추가 청크')
    expect(write).not.toHaveBeenCalled()
    await click('추가 청크·문구 순서 접기·펼치기')
    await click('추가 청크 역광 빼기')
    expect(field('씬 조합 포지티브 미리보기').textContent).toBe(
      'quality, trigger, alice, smile, rain'
    )
    await click('추가 청크 선택 해제')
    expect(field('추가 청크·문구 순서 현재 선택').textContent).toContain('추가 청크 없음')
    expect(field('씬 조합 포지티브 미리보기').textContent).toBe('quality, trigger, alice, smile')
  })

  it('uses both drag-end paths to change positive and negative preview without multiplying pairs', async () => {
    await selectPair()
    await input('추가 청크 검색', '역광')
    await check('추가 청크 역광 선택')
    await input('추가 청크 검색', '비')
    await check('추가 청크 비 선택')
    await drop('blocks', 'character', 'extraChunks')
    await drop('extras', 'extra2', 'extra1')
    expect(
      [...container.querySelectorAll('[data-prompt-block]')].map((item) =>
        item.getAttribute('data-prompt-block')
      )
    ).toEqual(['scene', 'extraChunks', 'character'])
    expect(field('추가 청크·문구 순서 현재 선택').textContent).toContain('씬 → 추가 청크 → 캐릭터')
    expect(field('추가 청크·문구 순서 현재 선택').textContent).toContain('2개 · 비, 역광')
    expect(field('씬 조합 포지티브 미리보기').textContent).toBe(
      'quality, trigger, smile, rain, backlight, alice'
    )
    expect(field('씬 조합 네거티브 미리보기').textContent).toBe(
      'blur, rain drops, harsh shadows, bad anatomy'
    )
    expect(container.querySelector('.px-totals')!.textContent).toBe('1조합 · 1작업 · 4장')
  })

  it('saves and reloads the configuration, then freezes it through reservation, registration and workspace restart', async () => {
    await selectPair()
    await check('추가 청크 폴더 빛과 날씨 선택')
    await drop('blocks', 'extraChunks', 'character')
    await drop('extras', 'extra2', 'extra1')
    await input('묶음 이름', '비 오는 웃음')
    await click('현재 구성 저장')
    const plan = store.getState().workspace.library.batchPlans![0]
    expect(plan).toMatchObject({
      extraChunkIds: ['extra2', 'extra1'],
      promptOrder: ['extraChunks', 'character', 'scene']
    })
    await click('추가 청크 선택 해제')
    await drop('blocks', 'extraChunks', 'scene')
    await input('저장한 구성', plan.id)
    await click('구성 불러오기')
    const prompt = 'quality, trigger, rain, backlight, alice, smile'
    const negative = 'blur, rain drops, harsh shadows, bad anatomy'
    expect(field('씬 조합 포지티브 미리보기').textContent).toBe(prompt)
    await click('선택 조합 전부 예약')
    const frozen = structuredClone(store.getState().workspace.library.reservations[0].snapshot)
    expect(frozen).toMatchObject({
      extraChunks: [
        { id: 'extra2', prompt: 'rain' },
        { id: 'extra1', prompt: 'backlight' }
      ],
      promptOrder: ['extraChunks', 'character', 'scene']
    })
    await act(async () =>
      store.getState().editLibrary((library) => ({
        ...library,
        scenes: library.scenes
          .filter((chunk) => chunk.id !== 'extra2')
          .map((chunk) =>
            chunk.id === 'extra1'
              ? { ...chunk, prompt: 'changed', negativePrompt: 'changed-negative' }
              : chunk
          )
      }))
    )
    await act(async () => store.getState().register())
    expect(store.getState().workspace.jobs).toHaveLength(1)
    expect(store.getState().workspace.jobs[0].request.composition.reservation.snapshot).toEqual(
      frozen
    )
    const reopened = createPixaiStore({ read: async () => saved, write })
    await reopened.getState().hydrate()
    expect(reopened.getState().error).toBe('')
    const job = reopened.getState().workspace.jobs[0]
    expect(job.request.composition.reservation.snapshot).toEqual(frozen)
    expect(buildPayload(job, 123)).toMatchObject({ prompt, negativePrompt: negative, batchSize: 4 })
    expect(reopened.getState().workspace.library.reservations).toHaveLength(0)
    expect(reopened.getState().workspace.library.batchPlans![0]).toEqual(plan)
  })

  it('blocks reservation when a selected additional chunk disappears instead of silently dropping it', async () => {
    await selectPair()
    await check('추가 청크 폴더 빛과 날씨 선택')
    await act(async () =>
      store.getState().editLibrary((library) => ({
        ...library,
        scenes: library.scenes.filter((chunk) => chunk.id !== 'extra2')
      }))
    )
    expect(field('추가 청크·문구 순서 현재 선택').textContent).toContain('삭제된 청크')
    write.mockClear()
    await click('선택 조합 전부 예약')
    expect(store.getState().workspace.library.reservations).toHaveLength(0)
    expect(store.getState().workspace.jobs).toHaveLength(0)
    expect(write).not.toHaveBeenCalled()
    expect(
      [...container.querySelectorAll('.px-error')].map((item) => item.textContent).join(' ')
    ).toContain('추가 청크')
  })
})
