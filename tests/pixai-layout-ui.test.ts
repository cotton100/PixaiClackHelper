// @vitest-environment happy-dom
import { act, createElement as h, useState, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Compose } from '../src/renderer/src/pixai/compose'
import { emptyDraft } from '../src/renderer/src/pixai/composition'
import { LibraryEditor } from '../src/renderer/src/pixai/library-editor'
import { Scenes } from '../src/renderer/src/pixai/scenes'
import { ExecutionQueue } from '../src/renderer/src/pixai/execution'
import {
  createPixaiStore,
  emptyWorkspace,
  readWorkspace,
  savePaneUI
} from '../src/renderer/src/pixai/store'
import { useUnsavedNavigation } from '../src/renderer/src/pixai/unsaved-navigation'
import { bulkMaterials } from '../src/renderer/src/pixai/library-actions'
import {
  makeSettingsBackup,
  parseSettingsBackup,
  type BatchPlan
} from '../src/shared/pixai/library'
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
// Fixture intentionally keeps the inferred storage spy type.
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
function button(name: string, within: ParentNode = container): HTMLButtonElement {
  const found = [...within.querySelectorAll('button')].find(
    (b) =>
      b.textContent?.trim() === name ||
      b.getAttribute('aria-label') === name ||
      b.getAttribute('title') === name
  )
  expect(found, name).toBeTruthy()
  return found!
}
async function click(name: string, within?: ParentNode): Promise<void> {
  await act(async () => button(name, within).click())
}
async function input(label: string, value: string): Promise<void> {
  const field = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!
  expect(field, label).toBeTruthy()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const plan = (): BatchPlan => ({
  id: 'plan1',
  name: '묶음 테스트',
  rows: [{ kind: 'character', id: 'c1' }],
  columns: ['sc1', 'sc2'],
  count: 2,
  exceptions: {},
  order: 'byRow'
})

it('changes only this reservation until default saving is explicitly selected', async () => {
  const { store } = await fixture()
  function View(): React.JSX.Element {
    const [draft, setDraft] = useState({ ...emptyDraft(), presetId: 'p1', characterId: 'c1' })
    return h(Compose, { store, draft, onChange: setDraft, onSceneCreated: () => {} })
  }
  await act(async () => root.render(h(View)))
  const initial = structuredClone(store.getState().workspace.options)
  await click('가로:세로 5:3')
  await click('1장')
  await click('Pro')
  expect(store.getState().workspace.options).toEqual(initial)
  await click('이 조합 예약 추가')
  expect(store.getState().workspace.library.reservations[0].imageOptions).toMatchObject({
    aspectRatio: '5:3',
    batchSize: 1,
    mode: 'pro'
  })
  await act(async () =>
    container.querySelectorAll<HTMLInputElement>('input[type=radio]')[1].click()
  )
  await click('가로:세로 3:5')
  expect(store.getState().workspace.options.api).toMatchObject({ aspectRatio: '3:5', mode: 'pro' })
  expect(store.getState().workspace.library.reservations[0].imageOptions?.aspectRatio).toBe('5:3')
})

it('round trips UI preferences, reads old backups and strips app-only settings from script exports', async () => {
  const { store, saved } = await fixture()
  await savePaneUI(store, 'compose', [31, 36, 33], 1)
  await store.getState().commit((w) => ({
    ...w,
    options: { ...w.options, ui: { ...w.options.ui, sceneView: 'list' } }
  }))
  const restored = readWorkspace(saved())
  expect(restored.options.ui?.sceneView).toBe('list')
  const meta = { appVersion: 'fixture', exportedAt: new Date().toISOString() }
  const app = makeSettingsBackup(restored.library, restored.options, meta)
  expect(parseSettingsBackup(JSON.stringify(app)).options.ui).toEqual(restored.options.ui)
  const script = makeSettingsBackup(restored.library, restored.options, meta, 'script')
  expect(script.options).not.toHaveProperty('ui')
  expect(parseSettingsBackup(JSON.stringify(script)).library.characters).toHaveLength(3)
  expect(() =>
    parseSettingsBackup(
      JSON.stringify({
        ...app,
        options: { ...app.options, ui: { paneRatios: { compose: [-1, 40, 61] } } }
      })
    )
  ).toThrow()
})

it('registers only the new batch atomically and never invokes generation', async () => {
  const { store, storage } = await fixture()
  await store.getState().reserve(plan())
  const old = store.getState().workspace.library.reservations.map((r) => r.id)
  const writes = storage.write.mock.calls.length
  await store.getState().reserve(plan(), true)
  expect(storage.write.mock.calls.length).toBe(writes + 1)
  expect(store.getState().workspace.jobs).toHaveLength(4)
  expect(store.getState().workspace.library.reservations.map((r) => r.id)).toEqual(old)
  const before = JSON.stringify(store.getState().workspace)
  storage.write.mockRejectedValueOnce(new Error('disk full'))
  await expect(store.getState().reserve(plan(), true)).rejects.toThrow()
  expect(JSON.stringify(store.getState().workspace)).toBe(before)
})

it('moves, duplicates and deletes multiple materials without changing scene or reservation snapshots', async () => {
  const { store } = await fixture()
  await store.getState().reserve(plan())
  const library = store.getState().workspace.library
  const moved = bulkMaterials(library, 'scenes', ['s1', 's2'], 'move', 'new', '표정')
  expect(moved.scenes[0].folderId).toBe(moved.scenes[1].folderId)
  expect(moved.chunkFolders.at(-1)?.name).toBe('표정')
  const duplicated = bulkMaterials(moved, 'scenes', ['s1', 's2'], 'duplicate')
  expect(duplicated.scenes).toHaveLength(5)
  const deleted = bulkMaterials(duplicated, 'scenes', ['s1', 's2'], 'delete')
  expect(deleted.sceneCards).toEqual(library.sceneCards)
  expect(deleted.reservations).toEqual(library.reservations)
})

it('asks before losing a material draft, cancels navigation and supports save then move', async () => {
  const { store } = await fixture()
  await act(async () => root.render(h(LibraryEditor, { store })))
  await click('캐릭터 폴더 미분류')
  await click('Alicealice')
  await input('캐릭터 이름', 'Edited Alice')
  await click('Bobbob')
  expect(container.querySelector('[role=alertdialog]')).toBeTruthy()
  await click('취소')
  expect(container.querySelector<HTMLInputElement>('[aria-label="캐릭터 이름"]')?.value).toBe(
    'Edited Alice'
  )
  await click('Bobbob')
  await click('저장하고 이동')
  expect(store.getState().workspace.library.characters[0].name).toBe('Edited Alice')
  expect(container.querySelector<HTMLInputElement>('[aria-label="캐릭터 이름"]')?.value).toBe('Bob')
})

it('keeps the editor and unsaved draft when saving before navigation fails', async () => {
  const { store, storage } = await fixture()
  await act(async () => root.render(h(LibraryEditor, { store })))
  await click('캐릭터 폴더 미분류')
  await click('Alicealice')
  await input('캐릭터 이름', 'Keep me')
  await click('Bobbob')
  storage.write.mockRejectedValueOnce(new Error('disk'))
  await click('저장하고 이동')
  expect(container.querySelector<HTMLInputElement>('[aria-label="캐릭터 이름"]')?.value).toBe(
    'Keep me'
  )
  expect(container.querySelector('[role=alertdialog]')).toBeTruthy()
  expect(store.getState().workspace.library.characters[0].name).toBe('Alice')
})

it('edits a scene in the third pane, protects a draft and saves a separate copy', async () => {
  const { store } = await fixture()
  await act(async () => root.render(h(Scenes, { store, onOpen: () => {} })))
  await click('웃음 편집')
  expect(button('청크').getAttribute('aria-pressed')).toBe('true')
  const inputEl = container.querySelector('[aria-label="씬 이름"]')!
  expect(inputEl.closest('[aria-label="수량·순서"]')).toBeTruthy()
  expect(inputEl.closest('.px-scene-card')).toBeNull()
  await input('씬 이름', '새 표정')
  await click('손 흔듦 편집')
  await click('취소')
  await click('복제해서 저장')
  expect(store.getState().workspace.library.sceneCards?.[0].name).toBe('웃음')
  expect(store.getState().workspace.library.sceneCards?.at(-1)?.name).toBe('새 표정 사본')
  await click('목록')
  expect(store.getState().workspace.options.ui?.sceneView).toBe('list')
})

it('shows the local queue by frozen batch and filters without submitting anything', async () => {
  const { store } = await fixture()
  await store.getState().reserve(plan(), true)
  await act(async () => root.render(h(ExecutionQueue, { store })))
  expect(container.querySelector('.px-queue-group summary')?.textContent).toContain('묶음 테스트')
  expect(container.querySelectorAll('.px-queue-item')).toHaveLength(4)
  await click('실패 0')
  expect(container.querySelectorAll('.px-queue-item')).toHaveLength(0)
  expect(store.getState().workspace.jobs).toHaveLength(4)
  expect(button('시작·저장 재개').disabled).toBe(true)
})

it('discards an active draft even when the editor stays mounted', async () => {
  function View(): React.JSX.Element {
    const guard = useUnsavedNavigation()
    const [value, setValue] = useState('draft')
    const [moved, setMoved] = useState(false)
    useEffect(
      () =>
        guard.register(
          value === 'draft',
          async () => true,
          () => setValue('saved')
        ),
      [value]
    )
    return h(
      'div',
      null,
      h('span', null, value),
      h('button', { onClick: () => guard.request(() => setMoved(true)) }, 'Move'),
      moved && 'moved',
      guard.dialog
    )
  }
  await act(async () => root.render(h(View)))
  await click('Move')
  await click('버리고 이동')
  expect(container.textContent).toContain('saved')
  expect(container.textContent).not.toContain('draft')
  expect(container.textContent).toContain('moved')
})

it('deletes a saved cast only after confirmation and keeps frozen reservations', async () => {
  const { store } = await fixture()
  await store.getState().editLibrary((library) => ({
    ...library,
    casts: [
      {
        id: 'cast1',
        name: 'Alice coat',
        characterId: 'c1',
        presetId: 'p1',
        extra: { prompt: 'coat', negativePrompt: '' }
      }
    ]
  }))
  await store.getState().reserve(plan())
  const snapshots = structuredClone(store.getState().workspace.library.reservations)
  await act(async () => root.render(h(LibraryEditor, { store })))
  await click('캐릭터 폴더 미분류')
  await click('Alicealice')
  const cast = store.getState().workspace.library.casts!.find((c) => c.characterId === 'c1')!
  const castButton = [...container.querySelectorAll('button')].find(
    (b) => b.querySelector('strong')?.textContent === cast.name
  )!
  await act(async () => castButton.click())
  await click('출연 삭제')
  expect(store.getState().workspace.library.casts!.some((c) => c.id === cast.id)).toBe(true)
  await click('출연 삭제 확인', container.querySelector('[aria-label="출연 삭제 확인"]')!)
  expect(store.getState().workspace.library.casts!.some((c) => c.id === cast.id)).toBe(false)
  expect(store.getState().workspace.library.reservations).toEqual(snapshots)
})

it('keeps an externally moved folder when saving the currently open clean editor', async () => {
  const { store } = await fixture()
  await act(async () => root.render(h(LibraryEditor, { store })))
  await click('캐릭터 폴더 미분류')
  await click('Alicealice')
  await act(async () =>
    store
      .getState()
      .editLibrary((library) =>
        bulkMaterials(library, 'characters', ['c1'], 'move', 'new', 'Moved')
      )
  )
  const folderId = store.getState().workspace.library.characters[0].folderId
  await input('캐릭터 이름', 'Renamed')
  await click('재료 저장')
  expect(store.getState().workspace.library.characters[0]).toMatchObject({
    folderId,
    name: 'Renamed'
  })
})

it('marks removed folder fields dirty and saves the unfiled choice before navigation', async () => {
  const { store } = await fixture()
  await store
    .getState()
    .editLibrary((library) => ({
      ...library,
      characterFolders: [{ id: 'f1', name: 'Group' }],
      characters: library.characters.map((c) => (c.id === 'c1' ? { ...c, folderId: 'f1' } : c))
    }))
  await act(async () => root.render(h(LibraryEditor, { store })))
  await click('캐릭터 폴더 Group')
  await click('캐릭터 폴더 미분류')
  await click('Alicealice')
  const field = container.querySelector<HTMLSelectElement>('[aria-label="캐릭터 폴더 선택"]')!
  await act(async () => {
    field.value = ''
    field.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(container.textContent).toContain('저장 안 됨')
  await click('Bobbob')
  expect(container.querySelector('[role=alertdialog]')).toBeTruthy()
  await click('저장하고 이동')
  expect(store.getState().workspace.library.characters[0].folderId).toBeUndefined()
})

it('keeps a newly created scene group across consecutive saves and marks the draft clean', async () => {
  const { store } = await fixture()
  await act(async () => root.render(h(Scenes, { store, onOpen: () => {} })))
  await click('웃음 편집')
  await click('그룹')
  await input('새 씬 그룹에 저장', 'New group')
  await click('씬 저장')
  const id = store.getState().workspace.library.sceneCards![0].folderId
  expect(id).toBeTruthy()
  expect(container.querySelector<HTMLSelectElement>('[aria-label="씬 그룹 이동"]')!.value).toBe(id)
  expect(container.querySelector('.px-editor header')!.textContent).not.toContain('저장 안 됨')
  await click('씬 저장')
  expect(store.getState().workspace.library.sceneCards![0].folderId).toBe(id)
})

it('discards edits when reopening the same scene without remounting it', async () => {
  const { store } = await fixture()
  await act(async () => root.render(h(Scenes, { store, onOpen: () => {} })))
  await click('웃음 편집')
  await input('씬 이름', 'Discard me')
  await click('웃음 편집')
  await click('버리고 이동')
  expect(container.querySelector<HTMLInputElement>('[aria-label="씬 이름"]')!.value).toBe('웃음')
  expect(container.querySelector('.px-editor header')!.textContent).not.toContain('저장 안 됨')
})
