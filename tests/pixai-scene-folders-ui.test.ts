// @vitest-environment happy-dom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Scenes } from '../src/renderer/src/pixai/scenes'
import { createPixaiStore, emptyWorkspace } from '../src/renderer/src/pixai/store'
import { pixaiLibrary } from './fixtures/pixai-workspace'
import { type BatchPlan } from '../src/shared/pixai/library'

let root: Root, container: HTMLDivElement
let store: ReturnType<typeof createPixaiStore>
let storage: { read: () => Promise<string>; write: ReturnType<typeof vi.fn> }

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('nais', { runtime: 'browser' })
  const library = pixaiLibrary()
  library.sceneFolders = [
    { id: 'f1', name: '표정' },
    { id: 'f2', name: '다른 장면' }
  ]
  library.characterFolders = [{ id: 'c-f1', name: '함께 선택' }]
  library.chunkFolders = [{ id: 'chunk-f1', name: '기본 동작' }]
  library.characters[0].folderId = 'c-f1'
  library.characters[1].folderId = 'c-f1'
  library.sceneCards![0].folderId = 'f1'
  library.sceneCards![2].folderId = 'f1'
  library.scenes[0].folderId = 'chunk-f1'
  library.scenes[1].folderId = 'chunk-f1'
  const plan: BatchPlan = {
    id: 'saved',
    name: '저장 구성',
    rows: [{ kind: 'character', id: 'c1' }],
    columns: ['sc3', 'sc1'],
    count: 1,
    exceptions: {},
    order: 'byRow'
  }
  library.batchPlans = [plan]
  storage = {
    read: async () => JSON.stringify({ ...emptyWorkspace(), library }),
    write: vi.fn(async () => {})
  }
  store = createPixaiStore(storage)
  await store.getState().hydrate()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(h(Scenes, { store, onOpen: vi.fn() })))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function field(name: string): HTMLInputElement {
  const match = container.querySelector<HTMLInputElement>(`[aria-label="${name}"]`)
  expect(match, name).toBeTruthy()
  return match!
}

function button(name: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === name || item.getAttribute('aria-label') === name
  )
  expect(match, name).toBeTruthy()
  return match!
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
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value)
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

it('selects matching folder scenes without resetting prior selection order or other selections', async () => {
  await check('씬 손 흔듦')
  await check('표정 씬 전체 선택')
  expect(field('씬 손 흔듦').closest('label')!.textContent).toContain('1. 손 흔듦')
  expect(field('씬 웃음').closest('label')!.textContent).toContain('2. 웃음')
  expect(field('씬 분노').closest('label')!.textContent).toContain('3. 분노')
  await input('씬 검색', '웃음')
  await check('표정 검색 결과 씬 전체 선택')
  expect(field('씬 웃음').checked).toBe(false)
  await input('씬 검색', '')
  expect(field('씬 손 흔듦').checked).toBe(true)
  expect(field('씬 분노').checked).toBe(true)
  expect(field('표정 씬 전체 선택').indeterminate).toBe(true)
  expect(storage.write).not.toHaveBeenCalled()
})

it('supports character folder and scene editor chunk folder selection while keeping copied chunks', async () => {
  await check('캐릭터 폴더 함께 선택 선택')
  expect(container.querySelector('[aria-label="누구"] header')!.textContent).toContain('2명 선택')
  await check('캐릭터 폴더 함께 선택 선택')
  expect(container.querySelector('[aria-label="누구"] header')!.textContent).toContain('0명 선택')
  await click('웃음 편집')
  await check('청크 폴더 기본 동작 선택')
  await submit('씬 저장')
  expect(store.getState().workspace.library.sceneCards![0].sceneIds).toEqual(['s1', 's2'])
  expect(store.getState().workspace.library.sceneCards![0].chunks[0].prompt).toBe('smile')
  expect(store.getState().workspace.library.sceneCards![0].chunks[0].folderId).toBeUndefined()
})

it('adds groups beside new scenes, renames them and deletes only the grouping', async () => {
  expect(button('새 씬 그룹').parentElement).toBe(button('새 씬 만들기').parentElement)
  await click('새 씬 그룹')
  await input('새 씬 그룹 이름', '새 폴더')
  await submit('만들기')
  expect(store.getState().workspace.library.sceneFolders).toHaveLength(3)
  await click('표정 씬 보기')
  await click('이름 변경')
  await input('씬 그룹 새 이름', '감정')
  await submit('이름 저장')
  expect(store.getState().workspace.library.sceneFolders![0]).toEqual({ id: 'f1', name: '감정' })
  const before = structuredClone(store.getState().workspace.library)
  storage.write.mockClear()
  await click('그룹 삭제')
  await click('그룹 삭제 확인')
  const after = store.getState().workspace.library
  expect(storage.write).toHaveBeenCalledTimes(1)
  expect(after.sceneCards).toHaveLength(before.sceneCards!.length)
  expect(after.sceneCards!.filter((card) => card.folderId === 'f1')).toHaveLength(0)
  expect(after.sceneCards!.map((card) => card.chunks)).toEqual(
    before.sceneCards!.map((card) => card.chunks)
  )
  expect(after.batchPlans).toEqual(before.batchPlans)
  expect(after.reservations).toEqual(before.reservations)
  expect(field('씬 웃음')).toBeTruthy()
})

it('keeps the dirty scene and folder intact when folder deletion is cancelled at the existing guard', async () => {
  await click('표정 씬 보기')
  await click('웃음 편집')
  await input('씬 이름', '아직 저장하지 않은 이름')
  await click('그룹 삭제')
  await click('그룹 삭제 확인')
  const dialog = container.querySelector('[aria-label="저장하지 않은 변경"]')!
  expect(dialog).not.toBeNull()
  expect(storage.write).not.toHaveBeenCalled()
  await act(async () =>
    [...dialog.querySelectorAll('button')].find((item) => item.textContent === '취소')!.click()
  )
  expect(field('씬 이름').value).toBe('아직 저장하지 않은 이름')
  expect(store.getState().workspace.library.sceneFolders![0].id).toBe('f1')
  await click('그룹 삭제 확인')
  await click('버리고 이동')
  expect(store.getState().workspace.library.sceneCards![0].name).toBe('웃음')
  expect(store.getState().workspace.library.sceneCards![0].folderId).toBeUndefined()
  expect(storage.write).toHaveBeenCalledTimes(1)
})

it('keeps folder contents unchanged when persistence fails', async () => {
  await click('표정 씬 보기')
  const before = structuredClone(store.getState().workspace.library)
  storage.write.mockRejectedValueOnce(new Error('저장 실패 테스트'))
  await click('그룹 삭제')
  await click('그룹 삭제 확인')
  expect(store.getState().workspace.library).toEqual(before)
  expect(container.textContent).toContain('변경 사항은 적용되지 않았습니다')
})
