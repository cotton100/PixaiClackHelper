// @vitest-environment happy-dom
import { act, createElement as h, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Scenes } from '../src/renderer/src/pixai/scenes'
import { Compose, ReservationList } from '../src/renderer/src/pixai/compose'
import { emptyDraft } from '../src/renderer/src/pixai/composition'
import { BackupSettings } from '../src/renderer/src/pixai/settings'
import { LibraryEditor } from '../src/renderer/src/pixai/library-editor'
import { SplitPanes } from '../src/renderer/src/pixai/controls'
import { ModelLinkInput } from '../src/renderer/src/pixai/model-link'
import { parseModelLink, type ModelLinkInfo } from '../src/shared/pixai/model-link'
import { createPixaiStore, emptyWorkspace } from '../src/renderer/src/pixai/store'
import { makeSettingsBackup, type BatchPlan } from '../src/shared/pixai/library'
import { pixaiLibrary } from './fixtures/pixai-workspace'

let root: Root, container: HTMLDivElement
let storage: { read: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> }
let store: ReturnType<typeof createPixaiStore>
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  storage = {
    read: vi.fn(async () => JSON.stringify({ ...emptyWorkspace(), library: pixaiLibrary() })),
    write: vi.fn(async () => {})
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
const field = (name: string): HTMLInputElement =>
  container.querySelector(`[aria-label="${name}"]`) as HTMLInputElement
async function click(name: string): Promise<void> {
  await act(async () => button(name).click())
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
async function renderScenes(): Promise<void> {
  await act(async () => root.render(h(Scenes, { store, onOpen: vi.fn() })))
}
async function selectNine(): Promise<void> {
  await click('행 전체 선택')
  await click('씬 전체 선택')
  await input('공통 반복 수', '2')
}

describe('PixAIS scene UI uses the fixed batch core', () => {
  it('creates a named scene and group from checked chunks without modifying the library chunks', async () => {
    await renderScenes()
    const original = structuredClone(store.getState().workspace.library.scenes)
    await click('새 씬 만들기')
    await input('씬 이름', '인사하는 씬')
    await input('새 씬 그룹에 저장', '대화')
    await click('청크 폴더 미분류')
    await act(async () => field('씬에 넣기 웃음').click())
    await act(async () => field('씬에 넣기 손 흔듦').click())
    await act(async () =>
      button('씬 저장')
        .closest('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    )
    const library = store.getState().workspace.library
    const card = library.sceneCards!.find((item) => item.name === '인사하는 씬')!
    expect(card.sceneIds).toEqual(['s1', 's2'])
    expect(library.sceneFolders!.find((folder) => folder.id === card.folderId)?.name).toBe('대화')
    expect(container.querySelector('.px-new-scene')).toBeNull()
    expect(container.textContent).toContain('대화 · 2청크')
    expect(library.scenes).toEqual(original)
    expect(library.reservations).toHaveLength(0)
  })
  it('allows a direct-text scene, validates an empty scene, and keeps unsaved changes local', async () => {
    await renderScenes()
    await click('새 씬 만들기')
    await input('씬 이름', '직접 입력')
    const submit = async (): Promise<void> => {
      await act(async () =>
        button('씬 저장')
          .closest('form')!
          .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      )
    }
    await submit()
    expect(container.textContent).toContain('청크를 고르거나 씬 문구를 입력해 주세요')
    const textarea = container.querySelector('.px-scene-text textarea')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        textarea,
        'reading a book'
      )
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await submit()
    expect(container.querySelector('.px-new-scene [role="alert"]')?.textContent ?? '').toBe('')
    const card = store
      .getState()
      .workspace.library.sceneCards!.find((item) => item.name === '직접 입력')!
    expect(card.chunks).toEqual([])
    expect(card.extra?.prompt).toBe('reading a book')
    await act(async () => {
      await store.getState().reserve({
        id: 'direct',
        name: 'test',
        rows: [{ kind: 'character', id: 'c1' }],
        columns: [card.id],
        exceptions: {},
        count: 1,
        order: 'byRow'
      })
    })
    expect(store.getState().workspace.library.reservations).toHaveLength(1)
    await click('새 씬 만들기')
    await input('씬 이름', '취소할 씬')
    await click('닫기')
    expect(store.getState().workspace.library.sceneCards).toHaveLength(4)
  })
  it('updates 9 pairs/18 jobs/72 images and exceptions immediately, then reserves with one batch ID', async () => {
    await renderScenes()
    await selectNine()
    expect(container.textContent).toContain('9조합 · 18작업 · 72장')
    expect(container.querySelector('.px-batch-detail')?.hasAttribute('open')).toBe(false)
    await input('Alice × 웃음 반복 수', '0')
    expect(container.textContent).toContain('8조합 · 16작업 · 64장')
    await input('Bob × 손 흔듦 반복 수', '3')
    expect(container.textContent).toContain('8조합 · 17작업 · 68장')
    await click('예외 전부 지우기')
    await input('묶음 이름', '표정 세트')
    await click('선택 조합 전부 예약')
    const reservations = store.getState().workspace.library.reservations
    expect(reservations).toHaveLength(9)
    expect(new Set(reservations.map((item) => item.batch?.id)).size).toBe(1)
    expect(reservations.every((item) => item.batch?.name === '표정 세트')).toBe(true)
    expect(container.textContent).toContain('9조합 18작업을 예약했습니다')
  })
  it('reports missing preset errors, adds no reservations, and re-enables the button', async () => {
    await store.getState().editLibrary((library) => ({
      ...library,
      characters: library.characters.map((item) =>
        item.id === 'c2' ? { ...item, defaultPresetId: '' } : item
      )
    }))
    storage.write.mockClear()
    await renderScenes()
    await selectNine()
    await click('선택 조합 전부 예약')
    expect(container.textContent).toContain('Bob」의 모델·LoRA 프리셋이 지정되지 않았습니다')
    expect(store.getState().workspace.library.reservations).toHaveLength(0)
    expect(storage.write).not.toHaveBeenCalled()
    expect(button('선택 조합 전부 예약').disabled).toBe(false)
  })
  it('keeps reservations unchanged on failed persistence and uses an automatic name when blank', async () => {
    await renderScenes()
    await selectNine()
    await input('묶음 이름', ' ')
    storage.write.mockRejectedValueOnce(new Error('full'))
    await click('선택 조합 전부 예약')
    expect(store.getState().workspace.library.reservations).toEqual([])
    expect(button('선택 조합 전부 예약').disabled).toBe(false)
    expect(container.textContent).toContain('저장하지 못했습니다')
    await click('선택 조합 전부 예약')
    expect(store.getState().workspace.library.reservations[0].batch?.name).toMatch(
      /^캐릭터 3 × 씬 3/
    )
  })
  it('includes selected casts, changes traversal order and restores a saved plan with exceptions', async () => {
    await store.getState().editLibrary((library) => ({
      ...library,
      casts: [
        {
          id: 'cast1',
          characterId: 'c1',
          presetId: 'p1',
          name: 'Alice · 겨울복',
          extra: { prompt: 'coat', negativePrompt: '' }
        }
      ]
    }))
    await renderScenes()
    await selectNine()
    await click('씬별')
    await input('Alice · 겨울복 × 웃음 반복 수', '0')
    await click('현재 구성 저장')
    const saved = store.getState().workspace.library.batchPlans![0]
    expect(saved.rows).toHaveLength(4)
    expect(saved.order).toBe('byColumn')
    await click('행 선택 해제')
    await click('씬 선택 해제')
    await input('저장한 구성', saved.id)
    await click('구성 불러오기')
    expect(container.textContent).toContain('11조합 · 22작업 · 88장')
    await click('선택 조합 전부 예약')
    expect(store.getState().workspace.library.reservations[3].batch?.columnName).toBe('손 흔듦')
  })
  it('shows refresh differences without overwriting a scene before confirmation', async () => {
    await store.getState().editLibrary((library) => ({
      ...library,
      scenes: library.scenes.map((chunk) =>
        chunk.id === 's1' ? { ...chunk, prompt: 'new smile' } : chunk
      )
    }))
    await renderScenes()
    await click('웃음 최신 청크로 갱신')
    expect(container.textContent).toContain('new smile')
    expect(store.getState().workspace.library.sceneCards![0].chunks[0].prompt).toBe('smile')
    await click('변경 내용 적용')
    expect(store.getState().workspace.library.sceneCards![0].chunks[0].prompt).toBe('new smile')
  })
  it('rejects an outdated refresh preview instead of overwriting a later scene edit', async () => {
    await renderScenes()
    await click('웃음 최신 청크로 갱신')
    await act(async () =>
      store.getState().editLibrary((library) => ({
        ...library,
        sceneCards: library.sceneCards?.map((card) =>
          card.id === 'sc1' ? { ...card, name: '새 이름' } : card
        )
      }))
    )
    await click('변경 내용 적용')
    expect(container.textContent).toContain('비교 후 자료가 바뀌었습니다')
    expect(store.getState().workspace.library.sceneCards![0].name).toBe('새 이름')
  })
})

describe('Composition, grouped reservations and backup controls', () => {
  it('keeps per-reservation batch and mode selections after changing the composition and registering', async () => {
    function TestCompose(): React.JSX.Element {
      const [draft, setDraft] = useState({ ...emptyDraft(), presetId: 'p1', characterId: 'c1' })
      return h(Compose, { store, draft, onChange: setDraft, onSceneCreated: vi.fn() })
    }
    await act(async () => root.render(h(TestCompose)))
    await click('Ultra')
    await click('4장 배치')
    await click('이 조합 예약 추가')
    await click('Pro')
    await click('1장')
    await click('이 조합 예약 추가')
    const reservations = store.getState().workspace.library.reservations
    expect(reservations.map((r) => r.imageOptions?.batchSize)).toEqual([4, 1])
    expect(reservations.map((r) => r.imageOptions?.mode)).toEqual(['ultra', 'pro'])
    await act(async () => store.getState().register())
    expect(store.getState().workspace.jobs.map((j) => j.imageCount)).toEqual([4, 1])
  })
  it.each(['캐릭터', '청크'])(
    'creates %s folders beside the library tabs without editing a material',
    async (label) => {
      await act(async () => root.render(h(LibraryEditor, { store })))
      await click(label)
      const add = button('폴더 추가')
      const listPane = add.closest('section')!
      expect(listPane.textContent).toContain('라이브러리')
      expect(listPane.querySelector('[aria-label="라이브러리 검색"]')).not.toBeNull()
      await click('폴더 추가')
      expect(add.getAttribute('aria-expanded')).toBe('true')
      await input(`새 ${label} 폴더 이름`, '새 재료 폴더')
      await act(async () =>
        button('폴더 만들기')
          .closest('form')!
          .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      )
      const key = label === '캐릭터' ? 'characterFolders' : 'chunkFolders'
      expect(
        store.getState().workspace.library[key]?.some((folder) => folder.name === '새 재료 폴더')
      ).toBe(true)
      expect(button(`${label} 폴더 새 재료 폴더`).getAttribute('aria-expanded')).toBe('false')
      await click('프리셋')
      expect(container.querySelector('#library-folder-tools')).toBeNull()
      expect(
        [...container.querySelectorAll('button')].some((b) => b.textContent === '폴더 추가')
      ).toBe(false)
    }
  )

  it('creates a character folder while saving, duplicates within it, and moves back to unfiled', async () => {
    await act(async () => root.render(h(LibraryEditor, { store })))
    await click('캐릭터 폴더 미분류')
    await click('Alicealice')
    await input('새 폴더에 저장', '주연')
    const save = async (): Promise<void> => {
      await act(async () =>
        button('재료 저장')
          .closest('form')!
          .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      )
    }
    await save()
    const folder = store.getState().workspace.library.characterFolders![0]
    expect(folder.name).toBe('주연')
    expect(button('캐릭터 폴더 주연').getAttribute('aria-expanded')).toBe('false')
    await click('복제')
    expect(store.getState().workspace.library.characters.at(-1)?.folderId).toBe(folder.id)
    await input('캐릭터 폴더 선택', '')
    await save()
    expect(store.getState().workspace.library.characters.at(-1)?.folderId).toBeUndefined()
    await input('라이브러리 검색', 'Alice')
    expect(button('캐릭터 폴더 주연').getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain('Alice 사본')
  })
  it.each([false, true])(
    'does not move a removed LoRA link result into the following LoRA (pending=%s)',
    async (pending) => {
      let resolveLink: ((info: ModelLinkInfo) => void) | undefined
      if (pending)
        vi.stubGlobal('nais', {
          runtime: 'electron',
          invoke: vi.fn(
            () =>
              new Promise<ModelLinkInfo>((resolve) => {
                resolveLink = resolve
              })
          )
        })
      await store.getState().editLibrary((library) => ({
        ...library,
        presets: library.presets.map((preset) => ({
          ...preset,
          loras: [...preset.loras, { id: '30', versionId: '300', name: '다른 LoRA', weight: 0.4 }]
        }))
      }))
      await act(async () => root.render(h(LibraryEditor, { store })))
      await click('프리셋')
      await click('기본 모델테스트 모델 · LoRA 2')
      await input('LoRA 1 링크', 'https://pixai.art/model/99-test/999')
      await click('LoRA 1 정보 가져오기')
      if (!pending) expect(container.textContent).toContain('버전 999')
      await click('이 LoRA 빼기')
      if (pending)
        await act(async () => {
          resolveLink!(parseModelLink('https://pixai.art/model/99-test/999'))
        })
      expect(container.textContent).not.toContain('버전 999')
      expect(field('LoRA 1 링크').value).toBe('')
      await act(async () =>
        button('재료 저장')
          .closest('form')!
          .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      )
      expect(store.getState().workspace.library.presets[0].loras).toEqual([
        { id: '30', versionId: '300', name: '다른 LoRA', weight: 0.4 }
      ])
    }
  )
  it('shows imported chunk folders and collapses them without changing assignments', async () => {
    await store.getState().editLibrary((library) => ({
      ...library,
      chunkFolders: [
        { id: 'f1', name: '표정' },
        { id: 'f2', name: '행동' }
      ],
      scenes: library.scenes.map((chunk, index) => ({
        ...chunk,
        folderId: index === 1 ? 'f2' : 'f1'
      }))
    }))
    await act(async () => root.render(h(LibraryEditor, { store })))
    await click('청크')
    const expression = container.querySelector('[aria-label="청크 폴더 표정"]')!
    expect(expression.textContent).not.toContain('웃음')
    expect(expression.querySelector('button')?.getAttribute('aria-expanded')).toBe('false')
    await click('청크 폴더 표정')
    expect(expression.textContent).toContain('웃음')
    expect(expression.textContent).toContain('분노')
    expect(expression.textContent).not.toContain('손 흔듦')
    await act(async () => expression.querySelector('button')!.click())
    expect(expression.textContent).not.toContain('웃음')
    await input('라이브러리 검색', '웃음')
    expect(expression.textContent).toContain('웃음')
    expect(store.getState().workspace.library.scenes.map((chunk) => chunk.folderId)).toEqual([
      'f1',
      'f2',
      'f1'
    ])
  })
  it('previews link information and only applies it after an explicit click', async () => {
    const apply = vi.fn()
    await act(async () => root.render(h(ModelLinkInput, { label: '모델', onApply: apply })))
    await input('모델 링크', 'https://pixai.art/model/123-test/456')
    await click('모델 정보 가져오기')
    expect(container.textContent).toContain('버전 456')
    expect(apply).not.toHaveBeenCalled()
    await click('이 정보 적용')
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ id: '123', versionId: '456' }))
    await input('모델 링크', 'https://pixai.art/model/789')
    await click('모델 정보 가져오기')
    expect(container.textContent).toContain('버전 미포함')
    expect(apply).toHaveBeenCalledTimes(1)
  })
  it('creates a scene from ordered chunks without preset/character, reservation or generation', async () => {
    const created = vi.fn()
    await act(async () =>
      root.render(
        h(Compose, {
          store,
          draft: {
            ...emptyDraft(),
            presetId: 'p1',
            characterId: 'c1',
            sceneIds: ['s2', 's1'],
            triggerPosition: 'end',
            imageOptions: { aspectRatio: '5:3', size: '1k' }
          },
          onChange: vi.fn(),
          onSceneCreated: created
        })
      )
    )
    await click('이 조합으로 씬 만들기')
    const card = store.getState().workspace.library.sceneCards!.at(-1)!
    expect(card.sceneIds).toEqual(['s2', 's1'])
    expect(card.imageOptions?.aspectRatio).toBe('5:3')
    expect(card).not.toHaveProperty('characterId')
    expect(card).not.toHaveProperty('presetId')
    expect(store.getState().workspace.library.reservations).toEqual([])
    expect(store.getState().workspace.jobs).toEqual([])
    expect(created).toHaveBeenCalledWith(card.id)
  })
  it('removes only one batch and leaves other groups and standalone reservations', async () => {
    const plan: BatchPlan = {
      id: 'x',
      name: '묶음 A',
      rows: [{ kind: 'character', id: 'c1' }],
      columns: ['sc1', 'sc2'],
      count: 1,
      exceptions: {},
      order: 'byRow'
    }
    await store.getState().reserve(plan)
    await store.getState().reserve({ ...plan, name: '묶음 B' })
    await store.getState().editLibrary((library) => {
      const copy = { ...library.reservations[0] }
      delete copy.batch
      return { ...library, reservations: [...library.reservations, { ...copy, id: 'single' }] }
    })
    await act(async () => root.render(h(ReservationList, { store, onNotice: vi.fn() })))
    await click('이 묶음 제외')
    expect(store.getState().workspace.library.reservations).toHaveLength(3)
    expect(
      store
        .getState()
        .workspace.library.reservations.filter((item) => item.batch?.name === '묶음 B')
    ).toHaveLength(2)
    expect(
      store.getState().workspace.library.reservations.some((item) => item.id === 'single')
    ).toBe(true)
  })
  it('previews a script backup before replacing data and reports script export omissions', async () => {
    const onImport = vi.fn()
    await act(async () => root.render(h(BackupSettings, { store, onImport })))
    const backup = makeSettingsBackup(
      pixaiLibrary(),
      emptyWorkspace().options,
      { appVersion: 'test', exportedAt: new Date().toISOString() },
      'script'
    )
    const file = new File([JSON.stringify(backup)], 'test.json', { type: 'application/json' })
    const picker = field('설정 백업 파일')
    Object.defineProperty(picker, 'files', { configurable: true, value: [file] })
    await act(async () => picker.dispatchEvent(new Event('change', { bubbles: true })))
    expect(container.textContent).toContain('가져올 자료')
    expect(storage.write).not.toHaveBeenCalled()
    await click('확인한 백업 적용')
    expect(onImport).toHaveBeenCalledOnce()
    expect(store.getState().workspace.library).toEqual(backup.library)
    await act(async () => store.getState().editLibrary(() => pixaiLibrary()))
    await click('스크립트용 내보내기')
    expect(container.textContent).toContain('씬 카드')
    expect(container.textContent).toContain('캐릭터 기본 프리셋 연결')
  })
  it('saves a character default preset and an individually editable cast', async () => {
    await act(async () => root.render(h(LibraryEditor, { store })))
    await click('캐릭터 폴더 미분류')
    await click('Alicealice')
    await input('기본 모델·LoRA 프리셋', '')
    await act(async () =>
      button('재료 저장')
        .closest('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    )
    expect(store.getState().workspace.library.characters[0].defaultPresetId).toBeUndefined()
    await click('출연으로 저장')
    await input('출연 이름', 'Alice · 겨울복')
    await input('출연 프리셋', 'p1')
    await act(async () =>
      button('출연 저장')
        .closest('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    )
    expect(store.getState().workspace.library.casts?.[0]).toMatchObject({
      name: 'Alice · 겨울복',
      characterId: 'c1',
      presetId: 'p1'
    })
  })
  it('resizes panes with the keyboard and persists their proportions', async () => {
    const save = vi.fn()
    await act(async () =>
      root.render(
        h(SplitPanes, {
          name: '씬',
          widths: [30, 35, 35],
          onSave: save,
          children: [h('section', { key: 1 }), h('section', { key: 2 }), h('section', { key: 3 })]
        })
      )
    )
    await act(async () =>
      container
        .querySelector('[role=separator]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    )
    expect(save).toHaveBeenCalledWith([32, 33, 35])
  })
})
