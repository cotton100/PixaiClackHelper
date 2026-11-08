// @vitest-environment happy-dom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import PixaiApp from '../src/renderer/src/pixai/app'
import { emptyDraft } from '../src/renderer/src/pixai/composition'
import { importImageComposition, noImageSelection } from '../src/renderer/src/pixai/image-import'
import {
  createPixaiStore,
  emptyWorkspace,
  readWorkspace,
  type Workspace
} from '../src/renderer/src/pixai/store'
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
  vi.unstubAllGlobals()
  localStorage.clear()
})

function workspaceWithOrder(): Workspace {
  const library = pixaiLibrary()
  library.characters[1].negativePrompt = 'character-bad'
  library.scenes[2].negativePrompt = 'angry-bad'
  library.scenes[1].negativePrompt = 'wave-bad'
  return {
    ...emptyWorkspace(),
    library,
    composeDraft: {
      ...emptyDraft(),
      presetId: 'p1',
      characterId: 'c2',
      sceneIds: ['s3', 's2'],
      materialOrder: ['chunk:s3', 'common', 'chunk:s2', 'character'],
      triggerPosition: 1,
      count: 3
    }
  }
}

it('opens a saved scene with its own chunk order without carrying the prior material order', async () => {
  const workspace = workspaceWithOrder()
  const card = workspace.library.sceneCards![0]
  card.imageOptions = { aspectRatio: '5:3', size: '1k' }
  card.triggerPosition = 'end'
  let saved = JSON.stringify(workspace)
  const store = createPixaiStore({
    read: async () => saved,
    write: async (value) => {
      saved = value
    }
  })
  await act(async () => root.render(h(PixaiApp, { store })))
  expect(store.getState().workspace.composeDraft?.materialOrder).toEqual(
    workspace.composeDraft!.materialOrder
  )
  await act(async () =>
    [...container.querySelectorAll<HTMLButtonElement>('.px-nav button')]
      .find((button) => button.textContent === '씬')!
      .click()
  )
  const scene = container.querySelector('[aria-label="씬 웃음"]')!.closest('article')!
  await act(async () => {
    scene.querySelector<HTMLElement>('summary[aria-label="웃음 메뉴"]')!.click()
    ;[...scene.querySelectorAll('button')]
      .find((button) => button.textContent === '조합으로 열기')!
      .click()
  })
  const draft = store.getState().workspace.composeDraft!
  expect(draft).toMatchObject({
    presetId: 'p1',
    characterId: 'c2',
    count: 3,
    sceneIds: ['s1'],
    triggerPosition: 'end',
    imageOptions: card.imageOptions,
    card
  })
  expect(draft.materialOrder).toBeUndefined()
  expect(readWorkspace(saved).composeDraft).toEqual(draft)
  expect(store.getState().error).toBe('')
})

it.each(['prompt', 'negativePrompt', 'image'] as const)(
  'preserves the current material and trigger order for fields retained by an image %s import',
  (selectedField) => {
    const workspace = workspaceWithOrder()
    const before = structuredClone(workspace)
    const next = importImageComposition(
      workspace,
      { prompt: 'imported-positive', negativePrompt: 'imported-negative', aspectRatio: '5:3' },
      { ...noImageSelection(), [selectedField]: true },
      'image import'
    )
    const draft = next.composeDraft!
    const chunk = next.library.scenes.find((item) => item.id === draft.sceneIds[0])!
    expect(chunk.prompt).toBe(
      selectedField === 'prompt' ? 'imported-positive' : 'angry, quality, trigger, wave, bob'
    )
    expect(chunk.negativePrompt).toBe(
      selectedField === 'negativePrompt'
        ? 'imported-negative'
        : 'angry-bad, blur, wave-bad, character-bad'
    )
    expect(draft.materialOrder).toBeUndefined()
    expect(draft.sceneIds).toHaveLength(1)
    expect(readWorkspace(JSON.stringify(next)).composeDraft).toEqual(draft)
    expect(workspace).toEqual(before)
  }
)
