// @vitest-environment happy-dom
import { act, Children, createElement as h, type ReactElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Scenes } from '../src/renderer/src/pixai/scenes'
import { createPixaiStore, emptyWorkspace } from '../src/renderer/src/pixai/store'
import { pixaiLibrary } from './fixtures/pixai-workspace'
import { expandBatchPlan } from '../src/shared/pixai/batch-reserve'
import type { BatchPlan } from '../src/shared/pixai/library'

const dragHarness = vi.hoisted(() => ({
  drop: undefined as undefined | ((event: { active: { id: string }; over: { id: string } }) => void)
}))
// Exercise the real SortableItems drop callback with a deterministic target; browser hit testing is separate.
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@dnd-kit/core')>()
  return {
    ...original,
    DndContext: (props: { children: ReactNode; onDragEnd: typeof dragHarness.drop }): ReactNode => {
      const ids = (Children.toArray(props.children)[0] as ReactElement<{ items: string[] }>).props
        .items
      if (ids.some((id) => id.startsWith('sc'))) dragHarness.drop = props.onDragEnd
      return props.children
    }
  }
})

let root: Root, container: HTMLDivElement
let store: ReturnType<typeof createPixaiStore>
let write: ReturnType<typeof vi.fn>
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('nais', { runtime: 'browser' })
  dragHarness.drop = undefined
  const library = pixaiLibrary()
  library.sceneFolders = [
    { id: 'f1', name: '원래 그룹' },
    { id: 'f2', name: '대상 그룹' }
  ]
  library.sceneCards!.forEach((card) => {
    card.folderId = 'f1'
  })
  const plan: BatchPlan = {
    id: 'saved',
    name: '기존 구성',
    rows: [{ kind: 'character', id: 'c1' }],
    columns: ['sc3', 'sc1'],
    count: 1,
    exceptions: {},
    order: 'byRow'
  }
  library.batchPlans = [plan]
  library.reservations = expandBatchPlan(library, plan, {
    batchId: 'frozen',
    now: 1,
    batchSize: 1,
    idFactory: (() => {
      let i = 0
      return () => `r${++i}`
    })()
  }).reservations
  write = vi.fn(async () => {})
  store = createPixaiStore({
    read: async () => JSON.stringify({ ...emptyWorkspace(), library }),
    write
  })
  await store.getState().hydrate()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(h(Scenes, { store, onOpen: vi.fn() })))
  await act(async () =>
    container.querySelector<HTMLInputElement>('[aria-label="씬 분노"]')!.click()
  )
  await act(async () =>
    container.querySelector<HTMLInputElement>('[aria-label="씬 웃음"]')!.click()
  )
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function drop(active: string, over: string): Promise<void> {
  expect(dragHarness.drop).toBeTypeOf('function')
  await act(async () => dragHarness.drop!({ active: { id: active }, over: { id: over } }))
}

it('persists a whole selected scene set once without changing generation order, card content or frozen reservations', async () => {
  const before = structuredClone(store.getState().workspace)
  await drop('sc1', 'scene-folder:f2')
  const after = store.getState().workspace
  expect(write).toHaveBeenCalledTimes(1)
  expect(after.library.sceneCards!.map((card) => [card.id, card.folderId])).toEqual([
    ['sc1', 'f2'],
    ['sc2', 'f1'],
    ['sc3', 'f2']
  ])
  expect(after.library.sceneCards!.map((card) => card.chunks)).toEqual(
    before.library.sceneCards!.map((card) => card.chunks)
  )
  expect(after.library.reservations).toEqual(before.library.reservations)
  expect(after.library.batchPlans).toEqual(before.library.batchPlans)
  expect(after.jobs).toEqual(before.jobs)
  expect(
    container.querySelector('[aria-label="씬 분노"]')!.closest('label')!.textContent
  ).toContain('1. 분노')
  expect(
    container.querySelector('[aria-label="씬 웃음"]')!.closest('label')!.textContent
  ).toContain('2. 웃음')
  write.mockClear()
  await drop('sc1', 'sc3')
  expect(write).not.toHaveBeenCalled()
  expect(
    container.querySelector('[aria-label="씬 웃음"]')!.closest('label')!.textContent
  ).toContain('1. 웃음')
})

it('runs dirty-editor confirmation before moving and leaves the selection untouched on cancel', async () => {
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="웃음 편집"]')!.click()
  )
  const field = container.querySelector<HTMLInputElement>('[aria-label="씬 이름"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      field,
      '미저장 이름'
    )
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await drop('sc1', 'scene-folder:f2')
  expect(write).not.toHaveBeenCalled()
  const dialog = container.querySelector('[aria-label="저장하지 않은 변경"]')!
  expect(dialog).not.toBeNull()
  await act(async () =>
    [...dialog.querySelectorAll('button')].find((item) => item.textContent === '취소')!.click()
  )
  expect(field.value).toBe('미저장 이름')
  expect(store.getState().workspace.library.sceneCards![0].folderId).toBe('f1')
  await drop('sc1', 'scene-folder:f2')
  await act(async () =>
    [...container.querySelectorAll('button')]
      .find((item) => item.textContent === '버리고 이동')!
      .click()
  )
  expect(write).toHaveBeenCalledTimes(1)
  expect(store.getState().workspace.library.sceneCards![0]).toMatchObject({
    name: '웃음',
    folderId: 'f2'
  })
  expect(container.querySelector('[aria-label="씬 이름"]')).toBeNull()
})
