// @vitest-environment happy-dom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Compose } from '../src/renderer/src/pixai/compose'
import { composeOrder, emptyDraft, toggleComposeChunk } from '../src/renderer/src/pixai/composition'
import { createPixaiStore, emptyWorkspace } from '../src/renderer/src/pixai/store'
import { expandReservations } from '../src/shared/pixai/library'
import { pixaiLibrary } from './fixtures/pixai-workspace'

let root: Root, container: HTMLDivElement, saved: string
let store: ReturnType<typeof createPixaiStore>
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('nais', { runtime: 'browser' })
  localStorage.clear()
  saved = JSON.stringify({
    ...emptyWorkspace(),
    library: pixaiLibrary(),
    composeDraft: {
      ...emptyDraft(),
      presetId: 'p1',
      characterId: 'c1',
      sceneIds: ['s1', 's2', 's3']
    }
  })
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
  // happy-dom has no layout. Supply only item geometry; retain the actual
  // PointerSensor, event listeners, collision detection and drop callback.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const rows = [...container.querySelectorAll('.px-order .px-sortable')]
    const row = this.closest('.px-sortable')
    const index = row ? rows.indexOf(row) : -1
    const top = index < 0 ? 0 : 50 + index * 50
    return {
      x: 400,
      y: top,
      left: 400,
      top,
      width: 300,
      height: 44,
      right: 700,
      bottom: top + 44,
      toJSON: () => ({})
    }
  })
  function View(): React.JSX.Element {
    const { workspace } = store()
    return h(Compose, {
      store,
      draft: workspace.composeDraft!,
      onChange: (draft) => {
        void store.getState().saveDraft(draft)
      },
      onSceneCreated: () => {}
    })
  }
  await act(async () => root.render(h(View)))
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

async function pointer(target: EventTarget, type: string, y: number): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        isPrimary: true,
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        clientX: 410,
        clientY: y
      })
    )
  })
  if (type === 'pointerup') await finishDrop()
}

async function finishDrop(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve))
  })
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve))
  })
}

async function pendingDrop(afterPointerUp: () => void): Promise<void> {
  const grip = container.querySelector<HTMLButtonElement>(
    '.px-order [aria-label="손 흔듦 순서 이동"]'
  )!
  await pointer(grip, 'pointerdown', grip.getBoundingClientRect().top + 20)
  await pointer(document, 'pointermove', 220)
  await act(async () => {
    document.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        pointerId: 1,
        isPrimary: true,
        button: 0,
        buttons: 0,
        clientX: 410,
        clientY: 220
      })
    )
    afterPointerUp()
  })
}

it('cancels a pending drop without allowing its delayed callback to end the next drag', async () => {
  const before = structuredClone(store.getState().workspace)
  await pendingDrop(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }))
  })
  const grip = container.querySelector<HTMLButtonElement>(
    '.px-order [aria-label="손 흔듦 순서 이동"]'
  )!
  await pointer(grip, 'pointerdown', grip.getBoundingClientRect().top + 20)
  await pointer(document, 'pointermove', 220)
  await finishDrop()
  expect(store.getState().workspace).toEqual(before)
  await pointer(document, 'pointerup', 220)
  expect(store.getState().workspace.composeDraft?.sceneIds).toEqual(['s2', 's1', 's3'])
})

it('does not save a queued drop after its list unmounts', async () => {
  const before = structuredClone(store.getState().workspace)
  await pendingDrop(() => root.render(h('div')))
  await finishDrop()
  expect(store.getState().workspace).toEqual(before)
})

it('does not lose a complete short drag delivered before the next React render', async () => {
  const grip = container.querySelector<HTMLButtonElement>(
    '.px-order [aria-label="손 흔듦 순서 이동"]'
  )!
  const start = grip.getBoundingClientRect().top + 20
  const target =
    container.querySelector('.px-order [aria-label="웃음 순서 이동"]')!.getBoundingClientRect()
      .top + 20
  await act(async () => {
    for (const [element, type, y] of [
      [grip, 'pointerdown', start],
      [document, 'pointermove', target],
      [document, 'pointerup', target]
    ] as const) {
      element.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          isPrimary: true,
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          clientX: 410,
          clientY: y
        })
      )
    }
  })
  await finishDrop()
  expect(store.getState().workspace.composeDraft?.sceneIds).toEqual(['s2', 's1', 's3'])
})

it.each([false, true])(
  'persists a middle-pane pointer drag (one movement event: %s) into reservations',
  async (singleMove) => {
    const before = structuredClone(store.getState().workspace.library)
    const grip = container.querySelector<HTMLButtonElement>(
      '.px-order [aria-label="분노 순서 이동"]'
    )!
    const start = grip.getBoundingClientRect().top + 20
    const target =
      container
        .querySelector<HTMLElement>('.px-order [aria-label="웃음 순서 이동"]')!
        .getBoundingClientRect().top + 20
    await pointer(grip, 'pointerdown', start)
    if (!singleMove) await pointer(document, 'pointermove', start - 10)
    await pointer(document, 'pointermove', target)
    await pointer(document, 'pointerup', target)
    expect(store.getState().workspace.composeDraft?.sceneIds).toEqual(['s3', 's1', 's2'])
    expect(store.getState().workspace.library).toEqual(before)
    expect(
      container.querySelector('.px-order')!.parentElement!.querySelector('textarea')!.value
    ).toBe('quality, trigger, alice, angry, smile, wave')
    // The actual PointerSensor briefly suppresses clicks after releasing a drag.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60))
    })
    const reserve = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === '이 조합 예약 추가'
    )!
    await act(async () => reserve.click())
    const reservation = store.getState().workspace.library.reservations[0]
    expect(reservation.sceneIds).toEqual(['s3', 's1', 's2'])
    expect(reservation.snapshot?.chunks.map((c) => c.id)).toEqual(['s3', 's1', 's2'])
    const restored = createPixaiStore({ read: async () => saved, write: async () => {} })
    await restored.getState().hydrate()
    expect(restored.getState().workspace.composeDraft?.sceneIds).toEqual(['s3', 's1', 's2'])
    expect(expandReservations(restored.getState().workspace.library)[0].prompt).toBe(
      'quality, trigger, alice, angry, smile, wave'
    )
  }
)

it('keeps the selection unchanged on a handle click or an Escape-cancelled drag', async () => {
  const before = structuredClone(store.getState().workspace)
  const grip = container.querySelector<HTMLButtonElement>(
    '.px-order [aria-label="웃음 순서 이동"]'
  )!
  const start = grip.getBoundingClientRect().top + 20
  await pointer(grip, 'pointerdown', start)
  await pointer(document, 'pointerup', start)
  expect(store.getState().workspace).toEqual(before)
  await pointer(grip, 'pointerdown', start)
  await pointer(document, 'pointermove', start + 100)
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }))
  })
  await pointer(document, 'pointerup', start + 100)
  expect(store.getState().workspace).toEqual(before)
})

it('still moves the trigger before common and character blocks with one pointer movement', async () => {
  const grip = container.querySelector<HTMLButtonElement>(
    '.px-order [aria-label="LoRA 트리거 순서 이동"]'
  )!
  const start = grip.getBoundingClientRect().top + 20
  const target = container.querySelector('.px-order .px-sortable')!.getBoundingClientRect().top + 20
  await pointer(grip, 'pointerdown', start)
  await pointer(document, 'pointermove', target)
  await pointer(document, 'pointerup', target)
  expect(store.getState().workspace.composeDraft).toMatchObject({
    sceneIds: ['s1', 's2', 's3'],
    triggerPosition: 0
  })
  expect(
    container.querySelector('.px-order')!.parentElement!.querySelector('textarea')!.value
  ).toBe('trigger, quality, alice, smile, wave, angry')
})

async function dragBefore(from: string, to: string): Promise<void> {
  const grip = container.querySelector<HTMLButtonElement>(
    `.px-order [aria-label="${from} 순서 이동"]`
  )!
  const target =
    container
      .querySelector<HTMLElement>(`.px-order [aria-label="${to} 순서 이동"]`)!
      .getBoundingClientRect().top + 20
  await pointer(grip, 'pointerdown', grip.getBoundingClientRect().top + 20)
  await pointer(document, 'pointermove', target)
  await pointer(document, 'pointerup', target)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60))
  })
}

async function clickButton(text: string): Promise<void> {
  const button = [...container.querySelectorAll('button')].find(
    (item) => item.textContent === text
  )!
  expect(button).toBeTruthy()
  await act(async () => button.click())
}

it('moves chunks ahead of common and character and preserves preview, favorites, registered jobs and restart', async () => {
  await act(async () =>
    store.getState().editLibrary((library) => ({
      ...library,
      characters: library.characters.map((c) => ({ ...c, negativePrompt: 'character-negative' })),
      scenes: library.scenes.map((c) => ({ ...c, negativePrompt: `${c.prompt}-negative` }))
    }))
  )
  await dragBefore('손 흔듦', '기본 공통문')
  await dragBefore('웃음', '캐릭터')
  const draft = store.getState().workspace.composeDraft!
  expect(draft.materialOrder).toEqual(['chunk:s2', 'common', 'chunk:s1', 'character', 'chunk:s3'])
  expect(composeOrder(draft)).toEqual([
    'chunk:s2',
    'common',
    'triggers',
    'chunk:s1',
    'character',
    'chunk:s3'
  ])
  const prompt = 'wave, quality, trigger, smile, alice, angry'
  const negative = 'wave-negative, blur, smile-negative, character-negative, angry-negative'
  expect(
    container.querySelector('.px-order')!.parentElement!.querySelector('textarea')!.value
  ).toBe(prompt)
  expect(
    container.querySelector<HTMLTextAreaElement>('[aria-label="네거티브 미리보기"]')!.value
  ).toBe(negative)
  const select = [...container.querySelectorAll('select')].find((el) =>
    el.parentElement!.textContent!.includes('LoRA 트리거 위치')
  )!
  expect([...select.options].slice(0, 5).map((option) => option.text)).toEqual([
    '맨 앞',
    '손 흔듦 뒤',
    '기본 공통문 뒤',
    '웃음 뒤',
    '캐릭터 뒤'
  ])
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="현재 조합 즐겨찾기"]')!.click()
  )
  await clickButton('이 조합 예약 추가')
  const library = store.getState().workspace.library
  expect(library.reservations[0].materialOrder).toEqual(draft.materialOrder)
  expect(
    library.combinations!.every(
      (item) => JSON.stringify(item.materialOrder) === JSON.stringify(draft.materialOrder)
    )
  ).toBe(true)
  await act(async () =>
    store
      .getState()
      .saveDraft({ ...emptyDraft(), presetId: 'p1', characterId: 'c1', sceneIds: ['s3'] })
  )
  await clickButton('즐겨찾기')
  await clickButton('불러오기')
  expect(composeOrder(store.getState().workspace.composeDraft!)).toEqual(composeOrder(draft))
  await act(async () => store.getState().register())
  await act(async () =>
    store.getState().editLibrary((current) => ({
      ...current,
      common: { prompt: 'changed', negativePrompt: 'changed' }
    }))
  )
  const restored = createPixaiStore({ read: async () => saved, write: async () => {} })
  await restored.getState().hydrate()
  expect(restored.getState().workspace.jobs[0].request).toMatchObject({
    prompt,
    negativePrompt: negative
  })
  expect(composeOrder(restored.getState().workspace.composeDraft!)).toEqual(composeOrder(draft))
})

it('keeps trigger anchors and end semantics while adding/removing chunks in a custom layout', async () => {
  await dragBefore('손 흔듦', '기본 공통문')
  const draft = store.getState().workspace.composeDraft!
  const removed = toggleComposeChunk({ ...draft, triggerPosition: 3 }, 's2')
  expect(composeOrder(removed)).toEqual(['triggers', 'common', 'character', 'chunk:s1', 'chunk:s3'])
  const end = toggleComposeChunk({ ...draft, triggerPosition: 'end' }, 's3')
  const added = toggleComposeChunk(end, 's3')
  expect(composeOrder(added)).toEqual([
    'chunk:s2',
    'common',
    'character',
    'chunk:s1',
    'chunk:s3',
    'triggers'
  ])
  expect(added.triggerPosition).toBe('end')
  await act(async () => store.getState().saveDraft(draft))
  await clickButton('이 조합으로 씬 만들기')
  const card = store.getState().workspace.library.sceneCards!.at(-1)!
  expect(card.sceneIds).toEqual(['s2', 's1', 's3'])
  expect(card).not.toHaveProperty('materialOrder')
  expect(container.textContent).toContain('전체 조합 순서는 즐겨찾기에 저장해 주세요.')
})
