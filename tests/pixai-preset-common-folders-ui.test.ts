// @vitest-environment happy-dom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LibraryEditor } from '../src/renderer/src/pixai/library-editor'
import { createPixaiStore, emptyWorkspace, readWorkspace } from '../src/renderer/src/pixai/store'
import { pixaiLibrary } from './fixtures/pixai-workspace'

const drag = vi.hoisted(() => ({
  drop: undefined as undefined | ((id: string, target: string) => boolean),
  reorder: undefined as undefined | ((ids: string[]) => void)
}))
vi.mock('../src/renderer/src/pixai/controls', async (original) => {
  const actual = await original<typeof import('../src/renderer/src/pixai/controls')>()
  return {
    ...actual,
    SortableItems(props: Parameters<typeof actual.SortableItems>[0]) {
      if (props.ids.includes('p1') || props.ids.includes('cp1')) {
        drag.drop = props.onDrop
        drag.reorder = props.onReorder
      }
      return h(actual.SortableItems, props)
    }
  }
})

let root: Root, container: HTMLDivElement, saved: string
let store: ReturnType<typeof createPixaiStore>, write: ReturnType<typeof vi.fn>
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const library = pixaiLibrary()
  library.presetFolders = [
    { id: 'a', name: '기본' },
    { id: 'b', name: '보관' },
    { id: 'empty', name: '빈 폴더' }
  ]
  library.commonPresetFolders = structuredClone(library.presetFolders)
  library.presets = [1, 2, 3].map((number) => ({
    ...structuredClone(library.presets[0]),
    id: 'p' + number,
    name: '모델 ' + number,
    folderId: number < 3 ? 'a' : 'b',
    commonPresetId: 'cp1'
  }))
  library.commonPresets = [1, 2, 3].map((number) => ({
    id: 'cp' + number,
    name: '문구 ' + number,
    prompt: 'style' + number,
    negativePrompt: 'bad' + number,
    folderId: number < 3 ? 'a' : 'b'
  }))
  saved = JSON.stringify({ ...emptyWorkspace(), library })
  write = vi.fn(async (value: string) => {
    saved = value
  })
  store = createPixaiStore({ read: async () => saved, write })
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
  drag.reorder = undefined
})
function button(name: string): HTMLButtonElement {
  const result = [...container.querySelectorAll('button')].find(
    (el) => el.getAttribute('aria-label') === name || el.textContent?.trim() === name
  )
  if (!result) throw new Error('Missing button ' + name)
  return result
}
async function click(name: string): Promise<void> {
  await act(async () => button(name).click())
}
async function field(name: string, value: string): Promise<void> {
  const el = container.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    `[aria-label="${name}"]`
  )!
  expect(el).toBeTruthy()
  await act(async () => {
    const proto =
      el.tagName === 'SELECT'
        ? HTMLSelectElement.prototype
        : el.tagName === 'TEXTAREA'
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  })
}
async function check(name: string): Promise<void> {
  await act(async () =>
    container.querySelector<HTMLInputElement>(`[aria-label="${name}"]`)!.click()
  )
}
async function submit(name: string): Promise<void> {
  await act(async () =>
    button(name)
      .closest('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  )
}
async function drop(id: string, target: string): Promise<void> {
  await act(async () => {
    expect(drag.drop!(id, target)).toBe(true)
  })
}

describe.each([
  {
    label: '프리셋',
    kind: 'presets' as const,
    key: 'presetFolders' as const,
    prefix: 'p',
    name: '모델'
  },
  {
    label: '공통문',
    kind: 'commonPresets' as const,
    key: 'commonPresetFolders' as const,
    prefix: 'cp',
    name: '문구'
  }
])('$label folder organization', ({ label, kind, key, prefix, name }) => {
  it('creates beside Add, renames and removes only a folder, restoring all items to unfiled', async () => {
    await click(label)
    expect(button('폴더 추가').parentElement).toBe(button('추가').parentElement)
    expect(button(`${label} 폴더 기본`).getAttribute('aria-expanded')).toBe('false')
    await click('폴더 추가')
    await field(`새 ${label} 폴더 이름`, '새 폴더')
    await submit('폴더 만들기')
    expect(readWorkspace(saved).library[key]?.at(-1)?.name).toBe('새 폴더')
    await click(`${label} 폴더 기본 이름 변경`)
    await field(`${label} 폴더 새 이름`, '분류')
    await submit('이름 저장')
    expect(readWorkspace(saved).library[key]![0].name).toBe('분류')
    const original = structuredClone(store.getState().workspace.library[kind])
    await click(`${label} 폴더 분류 삭제`)
    await click('폴더만 삭제')
    const restored = readWorkspace(saved).library
    expect(restored[key]!.some((folder) => folder.id === 'a')).toBe(false)
    expect(restored[kind]!.map((item) => item.folderId)).toEqual([undefined, undefined, 'b'])
    expect(restored[kind]!.map((item) => item.name)).toEqual(original!.map((item) => item.name))
  })

  it('drags folders from their headings during search without dropping hidden items or other folders', async () => {
    await click(label)
    expect(button(`${label} 폴더 기본 순서 이동`)).toBeTruthy()
    const original = structuredClone(store.getState().workspace.library[kind])
    await field('라이브러리 검색', `${name} 1`)
    await drop('group:b', 'group:a')
    expect(readWorkspace(saved).library[key]!.map((folder) => folder.id)).toEqual([
      'b',
      'a',
      'empty'
    ])
    expect(readWorkspace(saved).library[kind]).toEqual(original)
    await drop('group:b', 'folder:')
    expect(readWorkspace(saved).library[key]!.map((folder) => folder.id)).toEqual([
      'b',
      'a',
      'empty'
    ])
  })

  it('moves checked items together but an unchecked drag moves only that item', async () => {
    await click(label)
    await click('선택 모드')
    await check(`${label} 폴더 기본 선택`)
    await drop(prefix + '3', 'folder:empty')
    expect(readWorkspace(saved).library[kind]!.map((item) => item.folderId)).toEqual([
      'a',
      'a',
      'empty'
    ])
    await drop(prefix + '1', 'group:b')
    expect(readWorkspace(saved).library[kind]!.map((item) => item.folderId)).toEqual([
      'b',
      'b',
      'empty'
    ])
    await act(async () =>
      drag.reorder!(['group:a', 'group:b', 'group:empty', prefix + '2', prefix + '1', prefix + '3'])
    )
    expect(readWorkspace(saved).library[kind]!.map((item) => item.id)).toEqual([
      prefix + '2',
      prefix + '1',
      prefix + '3'
    ])
  })
})

it('pins default common outside selection and bulk deletion unlinks only selected sets', async () => {
  await click('공통문')
  const common = structuredClone(store.getState().workspace.library.common)
  expect(button('기본 공통문').closest('.px-chunk-group')).toBeNull()
  await click('선택 모드')
  await check('공통문 폴더 기본 선택')
  await click('선택 삭제')
  await click('선택 삭제 확인')
  const library = readWorkspace(saved).library
  expect(library.common).toEqual(common)
  expect(library.commonPresets!.map((set) => set.id)).toEqual(['cp3'])
  expect(library.presets.every((preset) => !preset.commonPresetId)).toBe(true)
  expect(button('기본 공통문')).toBeTruthy()
})

it('guards a dirty common editor before moving and never restores its old folder on later save', async () => {
  await click('공통문')
  await click('공통문 폴더 기본')
  await click('문구 1')
  await field('공통 포지', 'edited style')
  await drop('cp1', 'folder:b')
  expect(container.querySelector('[aria-label="저장하지 않은 변경"]')).not.toBeNull()
  expect(store.getState().workspace.library.commonPresets![0].folderId).toBe('a')
  await click('저장하고 이동')
  expect(readWorkspace(saved).library.commonPresets![0]).toMatchObject({
    prompt: 'edited style',
    folderId: 'b'
  })
  expect(container.querySelector<HTMLSelectElement>('[aria-label="공통문 폴더 선택"]')!.value).toBe(
    'b'
  )
  await submit('공통문 저장')
  expect(readWorkspace(saved).library.commonPresets![0].folderId).toBe('b')
})

it('keeps common folder moves unchanged when persistence fails and shows the failure', async () => {
  await click('공통문')
  const before = structuredClone(store.getState().workspace.library)
  write.mockRejectedValueOnce(new Error('disk unavailable'))
  await drop('cp1', 'folder:b')
  expect(store.getState().workspace.library).toEqual(before)
  expect(container.querySelector('p[role="status"]')?.textContent).toContain('저장하지 못했습니다')
})
