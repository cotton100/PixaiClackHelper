// @vitest-environment happy-dom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LibraryEditor } from '../src/renderer/src/pixai/library-editor'
import { createPixaiStore, emptyWorkspace } from '../src/renderer/src/pixai/store'
import {
  bulkMaterials,
  deleteMaterialFolder,
  materialDragIds,
  renameMaterialFolder
} from '../src/renderer/src/pixai/library-actions'
import { pixaiLibrary } from './fixtures/pixai-workspace'

// Retain the real sortable UI while exercising the application drop callback directly.
const drag = vi.hoisted(() => ({
  drop: undefined as undefined | ((id: string, target: string) => boolean),
  label: undefined as undefined | ((id: string) => string)
}))
vi.mock('../src/renderer/src/pixai/controls', async (original) => {
  const actual = await original<typeof import('../src/renderer/src/pixai/controls')>()
  return {
    ...actual,
    SortableItems(props: Parameters<typeof actual.SortableItems>[0]) {
      if (props.ids.includes('s1') || props.ids.includes('c1')) {
        drag.drop = props.onDrop
        drag.label = props.dragLabel
      }
      return h(actual.SortableItems, props)
    }
  }
})

let root: Root, container: HTMLDivElement
let store: ReturnType<typeof createPixaiStore>
let write: ReturnType<typeof vi.fn>
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const library = pixaiLibrary()
  library.chunkFolders = [
    { id: 'a', name: '표정' },
    { id: 'b', name: '동작' },
    { id: 'empty', name: '빈 폴더' }
  ]
  library.scenes = library.scenes.map((chunk, index) => ({
    ...chunk,
    folderId: index < 2 ? 'a' : 'b'
  }))
  library.characterFolders = [
    { id: 'a', name: '주연' },
    { id: 'b', name: '조연' }
  ]
  library.characters = library.characters.map((character, index) => ({
    ...character,
    folderId: index < 2 ? 'a' : 'b'
  }))
  write = vi.fn(async () => {})
  store = createPixaiStore({
    read: async () => JSON.stringify({ ...emptyWorkspace(), library }),
    write
  })
  await store.getState().hydrate()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(h(LibraryEditor, { store })))
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  drag.drop = undefined
  drag.label = undefined
})
function button(name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (element) => element.getAttribute('aria-label') === name || element.textContent?.trim() === name
  )
  if (!found) throw new Error(`Missing button: ${name}`)
  return found
}
function field(name: string): HTMLInputElement {
  const found = container.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)
  if (!found) throw new Error(`Missing input: ${name}`)
  return found
}
async function click(name: string): Promise<void> {
  await act(async () => button(name).click())
}
async function check(name: string): Promise<void> {
  await act(async () => field(name).click())
}
async function input(name: string, value: string): Promise<void> {
  await act(async () => {
    const element = field(name)
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
async function drop(id: string, folder: string): Promise<void> {
  await act(async () => {
    expect(drag.drop!(id, `folder:${folder}`)).toBe(true)
  })
}

describe('library folder management', () => {
  it('keeps same-ID character and chunk folders independent, without altering snapshots', () => {
    const library = store.getState().workspace.library
    const original = structuredClone(library)
    const renamed = renameMaterialFolder(library, 'scenes', 'a', '  감정  ')
    expect(renamed.chunkFolders[0]).toEqual({ id: 'a', name: '감정' })
    expect(renamed.characterFolders).toEqual(original.characterFolders)
    const removed = deleteMaterialFolder(renamed, 'scenes', 'a')
    expect(removed.scenes.map((chunk) => chunk.folderId)).toEqual([undefined, undefined, 'b'])
    expect(removed.scenes.map((chunk) => chunk.prompt)).toEqual(
      original.scenes.map((chunk) => chunk.prompt)
    )
    expect(removed.characters).toEqual(original.characters)
    expect(removed.sceneCards).toEqual(original.sceneCards)
    expect(library).toEqual(original)
    expect(() => renameMaterialFolder(library, 'scenes', 'a', '  ')).toThrow('폴더 이름')
  })

  it.each(['캐릭터', '청크'])(
    'renames and cancels/deletes a %s folder while preserving all items',
    async (label) => {
      await click(label)
      const kind = label === '캐릭터' ? 'characters' : 'scenes'
      const key = label === '캐릭터' ? 'characterFolders' : 'chunkFolders'
      const name = label === '캐릭터' ? '주연' : '표정'
      const originalItems = structuredClone(store.getState().workspace.library[kind])
      await click(`${label} 폴더 ${name} 이름 변경`)
      await input(`${label} 폴더 새 이름`, '변경할 이름')
      await act(async () =>
        field(`${label} 폴더 새 이름`).dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        )
      )
      expect(write).not.toHaveBeenCalled()
      await click(`${label} 폴더 ${name} 이름 변경`)
      await input(`${label} 폴더 새 이름`, '새 이름')
      await submit('이름 저장')
      expect(store.getState().workspace.library[key]![0]).toEqual({ id: 'a', name: '새 이름' })
      expect(store.getState().workspace.library[kind]).toEqual(originalItems)
      await click(`${label} 폴더 새 이름 삭제`)
      expect(container.querySelector('[role="alertdialog"]')?.textContent).toContain('미분류')
      await click('취소')
      expect(store.getState().workspace.library[key]!.some((folder) => folder.id === 'a')).toBe(
        true
      )
      await click(`${label} 폴더 새 이름 삭제`)
      await click('폴더만 삭제')
      expect(store.getState().workspace.library[key]!.some((folder) => folder.id === 'a')).toBe(
        false
      )
      expect(store.getState().workspace.library[kind].map((item) => item.id)).toEqual(
        originalItems.map((item) => item.id)
      )
      expect(store.getState().workspace.library[kind].map((item) => item.folderId)).toEqual([
        undefined,
        undefined,
        'b'
      ])
    }
  )

  it('shows three checkbox states and scopes a folder selection to search results', async () => {
    await click('청크')
    await click('선택 모드')
    await click('청크 폴더 표정')
    await check('웃음 일괄 선택')
    expect(field('청크 폴더 표정 선택').indeterminate).toBe(true)
    expect(field('청크 폴더 표정 선택').getAttribute('aria-checked')).toBe('mixed')
    await check('청크 폴더 표정 선택')
    expect(field('청크 폴더 표정 선택').checked).toBe(true)
    await check('청크 폴더 동작 선택')
    await input('라이브러리 검색', '웃음')
    expect(container.textContent).toContain('검색에 맞는 항목만')
    await check('청크 폴더 표정 선택')
    expect(container.textContent).toContain('2개 선택')
    expect(field('청크 폴더 빈 폴더 선택').disabled).toBe(true)
    await input('라이브러리 검색', '')
    expect(field('웃음 일괄 선택').checked).toBe(false)
    expect(field('손 흔듦 일괄 선택').checked).toBe(true)
    expect(field('청크 폴더 동작 선택').checked).toBe(true)
    expect(write).not.toHaveBeenCalled()
  })

  it('moves multiple selected chunks in library order and retains the selection', async () => {
    await click('청크')
    await click('선택 모드')
    await check('청크 폴더 동작 선택')
    await click('청크 폴더 표정')
    await check('웃음 일괄 선택')
    const before = structuredClone(store.getState().workspace.library)
    expect(materialDragIds(before.scenes, ['s3', 's1', 'missing'], 's1')).toEqual(['s1', 's3'])
    expect(drag.label!('s1')).toBe('2개 청크 이동')
    await drop('s1', 'empty')
    const after = store.getState().workspace.library
    expect(
      after.scenes.filter((chunk) => chunk.folderId === 'empty').map((chunk) => chunk.id)
    ).toEqual(['s1', 's3'])
    expect(after.scenes.find((chunk) => chunk.id === 's2')?.folderId).toBe('a')
    expect(after.sceneCards).toEqual(before.sceneCards)
    expect(container.textContent).toContain('2개 선택')
    expect(write).toHaveBeenCalledOnce()
    await click('선택 2개를 미분류 폴더로 이동')
    expect(
      store
        .getState()
        .workspace.library.scenes.filter((chunk) => !chunk.folderId)
        .map((chunk) => chunk.id)
    ).toEqual(['s1', 's3'])
    expect(container.textContent).toContain('2개 선택')
  })

  it('moves only an unselected dragged item, leaving the current selection alone', async () => {
    await click('청크')
    await click('선택 모드')
    await check('청크 폴더 표정 선택')
    expect(drag.label!('s3')).toBe('1개 청크 이동')
    await drop('s3', 'empty')
    expect(store.getState().workspace.library.scenes.map((chunk) => chunk.folderId)).toEqual([
      'a',
      'a',
      'empty'
    ])
    expect(field('청크 폴더 표정 선택').checked).toBe(true)
    expect(container.textContent).toContain('2개 선택')
  })

  it('announces the selected count when keyboard dragging and cancels without saving', async () => {
    await click('청크')
    await click('선택 모드')
    await check('청크 폴더 표정 선택')
    await click('청크 폴더 표정')
    await act(async () => {
      const grip = button('웃음 순서 이동')
      grip.focus()
      grip.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }))
    })
    expect(container.querySelector('.px-drag-label')?.textContent).toBe('2개 청크 이동')
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })
      )
    })
    expect(container.querySelector('.px-drag-label')).toBeNull()
    expect(field('청크 폴더 표정 선택').checked).toBe(true)
    expect(write).not.toHaveBeenCalled()
  })

  it('does not mutate the library when dropping a dirty selection is canceled', async () => {
    await click('청크')
    await click('선택 모드')
    await check('청크 폴더 표정 선택')
    await click('청크 폴더 표정')
    await click('웃음smile')
    await input('청크 이름', '수정 중')
    const before = structuredClone(store.getState().workspace.library)
    await drop('s1', 'empty')
    expect(container.querySelector('[aria-label="저장하지 않은 변경"]')).not.toBeNull()
    await click('취소')
    expect(store.getState().workspace.library).toEqual(before)
    expect(field('청크 이름').value).toBe('수정 중')
    expect(write).not.toHaveBeenCalled()
    await drop('s1', 'empty')
    await click('저장하고 이동')
    expect(store.getState().workspace.library.scenes[0]).toMatchObject({
      name: '수정 중',
      folderId: 'empty'
    })
    expect(field('청크 이름').value).toBe('수정 중')
    expect(container.textContent).toContain('2개 선택')
  })

  it('requires the dirty editor decision before folder deletion and reconciles the editor afterwards', async () => {
    await click('청크')
    await click('청크 폴더 표정')
    await click('웃음smile')
    await input('청크 이름', '저장하지 않은 이름')
    await click('청크 폴더 표정 삭제')
    await click('폴더만 삭제')
    await click('취소')
    expect(
      store.getState().workspace.library.chunkFolders.some((folder) => folder.id === 'a')
    ).toBe(true)
    await click('청크 폴더 표정 삭제')
    await click('폴더만 삭제')
    await click('버리고 이동')
    expect(field('청크 이름').value).toBe('웃음')
    expect(
      (container.querySelector('[aria-label="청크 폴더 선택"]') as HTMLSelectElement).value
    ).toBe('')
    expect(store.getState().workspace.library.scenes[0].folderId).toBeUndefined()
  })

  it('preserves contents and folder after a failed save', async () => {
    await click('청크')
    const before = structuredClone(store.getState().workspace.library)
    write.mockRejectedValueOnce(new Error('테스트 저장 실패'))
    await click('청크 폴더 표정 삭제')
    await click('폴더만 삭제')
    expect(store.getState().workspace.library).toEqual(before)
    expect(container.textContent).toContain('변경 사항은 적용되지 않았습니다.')
  })

  it('moves characters atomically without changing snapshots or the source order', () => {
    const before = store.getState().workspace.library
    const next = bulkMaterials(before, 'characters', ['c3', 'c1'], 'move', 'a')
    expect(next.characters.map((character) => character.id)).toEqual(['c1', 'c2', 'c3'])
    expect(next.characters.map((character) => character.folderId)).toEqual(['a', 'a', 'a'])
    expect(next.scenes).toBe(before.scenes)
    expect(next.sceneCards).toBe(before.sceneCards)
  })
})
