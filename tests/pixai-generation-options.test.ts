import { describe, expect, it } from 'vitest'
import { pixaiLibrary } from './fixtures/pixai-workspace'
import {
  normalizeImageOptions,
  strictLibrary,
  makeSettingsBackup,
  parseSettingsBackup,
  normalizeSnapshot
} from '../src/shared/pixai/library'
import { resolveImageOptions } from '../src/shared/pixai/generation-options'
import { buildPayload } from '../src/shared/pixai/execution'
import { createPixaiStore, emptyWorkspace, readWorkspace } from '../src/renderer/src/pixai/store'

describe('per reservation generation options and character folders', () => {
  it('reads legacy image options and rejects unsupported batch sizes and modes', () => {
    expect(normalizeImageOptions({ aspectRatio: '5:3', size: '1k' })).toEqual({
      aspectRatio: '5:3',
      size: '1k'
    })
    for (const extra of [{ batchSize: 2 }, { batchSize: '4' }, { mode: 'invalid' }])
      expect(() => normalizeImageOptions({ aspectRatio: '5:3', size: '1k', ...extra })).toThrow()
  })
  it('roundtrips character folders in app and current script backups, validates references, and detaches snapshots', () => {
    const library = pixaiLibrary()
    library.characterFolders = [{ id: 'f1', name: '출연진' }]
    library.characters[0].folderId = 'f1'
    for (const target of ['app', 'script'] as const) {
      const backup = makeSettingsBackup(
        library,
        emptyWorkspace().options,
        { appVersion: 'test', exportedAt: '2026-10-11T00:00:00Z' },
        target
      )
      const restored = parseSettingsBackup(JSON.stringify(backup)).library
      expect(restored.characterFolders).toEqual(library.characterFolders)
      expect(restored.characters[0].folderId).toBe('f1')
    }
    const frozen = normalizeSnapshot({
      common: library.common,
      preset: library.presets[0],
      character: library.characters[0],
      chunks: []
    })
    expect(frozen.character.prompt).toBe('alice')
    expect(frozen.character.folderId).toBeUndefined()
    library.characterFolders = []
    expect(() => strictLibrary(library)).toThrow('폴더가 없습니다')
  })
  it('keeps distinct batch sizes/modes across reservation, registration, restart and API payload', async () => {
    let saved: string | null = JSON.stringify({ ...emptyWorkspace(), library: pixaiLibrary() })
    const store = createPixaiStore({
      read: async () => saved,
      write: async (text) => {
        saved = text
      }
    })
    await store.getState().hydrate()
    await store.getState().commit((workspace) => ({
      ...workspace,
      options: { ...workspace.options, imageCount: 4, api: { mode: 'ultra' } }
    }))
    const plan = {
      id: 'plan',
      rows: [{ kind: 'character' as const, id: 'c1' }],
      columns: ['sc1'],
      count: 1,
      name: '',
      exceptions: {},
      order: 'byRow' as const
    }
    await store.getState().reserve(plan)
    await store.getState().commit((workspace) => ({
      ...workspace,
      options: { ...workspace.options, imageCount: 1, api: { mode: 'pro' } }
    }))
    await store.getState().reserve(plan)
    await store.getState().register()
    const jobs = readWorkspace(saved).jobs
    expect(jobs.map((job) => job.imageCount)).toEqual([4, 1])
    expect(jobs.map((job) => buildPayload(job, 123).mode)).toEqual(['ultra', 'pro'])
    expect(jobs.map((job) => buildPayload(job, 123).batchSize)).toEqual([4, 1])
    jobs[0].request.imageOptions!.mode = ''
    expect(buildPayload(jobs[0], 123).mode).toBeUndefined()
  })
  it('preserves scene-specific batch size and computes mixed image totals', async () => {
    const library = pixaiLibrary()
    library.sceneCards![0].imageOptions = {
      aspectRatio: '5:3',
      size: '1.5k',
      batchSize: 1,
      mode: 'pro'
    }
    const store = createPixaiStore({
      read: async () => JSON.stringify({ ...emptyWorkspace(), library }),
      write: async () => {}
    })
    await store.getState().hydrate()
    const result = await store.getState().reserve({
      id: 'plan',
      rows: [{ kind: 'character', id: 'c1' }],
      columns: ['sc1', 'sc2'],
      count: 2,
      name: '',
      exceptions: {},
      order: 'byRow'
    })
    expect(result.totals.images).toBe(10)
    expect(result.reservations.map((r) => r.imageOptions?.batchSize)).toEqual([1, 4])
    expect(
      resolveImageOptions(result.reservations[0].imageOptions, {
        ...emptyWorkspace().options,
        imageCount: 4
      }).mode
    ).toBe('pro')
  })
  it('inherits batch and mode from the composition when a scene only overrides aspect ratio', async () => {
    const library = pixaiLibrary()
    library.sceneCards![0].imageOptions = { aspectRatio: '5:3', size: '1k' }
    const workspace = { ...emptyWorkspace(), library }
    workspace.options.api = { mode: 'ultra' }
    const store = createPixaiStore({
      read: async () => JSON.stringify(workspace),
      write: async () => {}
    })
    await store.getState().hydrate()
    const result = await store
      .getState()
      .reserve({
        id: 'plan',
        rows: [{ kind: 'character', id: 'c1' }],
        columns: ['sc1'],
        count: 2,
        name: '',
        exceptions: {},
        order: 'byRow',
        imageOptions: { aspectRatio: '1:1', size: '1.5k', batchSize: 1, mode: 'lite' }
      })
    expect(result.reservations[0].imageOptions).toEqual({
      aspectRatio: '5:3',
      size: '1k',
      batchSize: 1,
      mode: 'lite'
    })
    expect(result.totals.images).toBe(2)
    await store.getState().register()
    expect(buildPayload(store.getState().workspace.jobs[0], 0)).toMatchObject({
      aspectRatio: '5:3',
      batchSize: 1,
      mode: 'lite'
    })
  })
})
