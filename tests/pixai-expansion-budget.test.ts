import { describe, it, expect, vi } from 'vitest'
import { pixaiLibrary } from './fixtures/pixai-workspace'
import {
  expandReservations,
  makeSettingsBackup,
  parseSettingsBackup,
  type BatchPlan
} from '../src/shared/pixai/library'
import { expandBatchPlan } from '../src/shared/pixai/batch-reserve'
import { createPixaiStore, emptyWorkspace, readWorkspace } from '../src/renderer/src/pixai/store'

describe('pre-allocation expansion limits', () => {
  it('restores already-expanded large jobs without applying the new repeat budget', () => {
    const library = pixaiLibrary()
    library.common.prompt = 'x'.repeat(1_100_000)
    library.reservations = [
      { id: 'large-one', presetId: 'p1', characterId: 'c1', sceneIds: ['s1'], count: 1 }
    ]
    const request = expandReservations(library, { idFactory: () => 'saved-job' })[0]
    const material = request.composition
    material.reservation.snapshot = {
      common: material.common,
      preset: material.preset,
      character: material.character,
      chunks: material.chunks
    }
    const saved = {
      ...emptyWorkspace(),
      jobs: [{ request, imageCount: 4, options: emptyWorkspace().options }]
    }
    const restored = readWorkspace(JSON.stringify(saved))
    expect(restored.jobs[0].request.prompt).toBe(request.prompt)
    expect(restored.jobs[0].request.id).toBe('saved-job')
    expect(restored.jobs[0].request.composition.reservation.snapshot).toEqual(
      material.reservation.snapshot
    )
    // Restoring is not a way to bypass limits for repeated new work.
    library.reservations[0].count = 2
    expect(() => expandReservations(library, { restoreSingleJob: true })).toThrow('한 건씩')
    library.reservations[0].count = 1
    library.reservations.push({ ...library.reservations[0], id: 'second' })
    expect(() => expandReservations(library, { restoreSingleJob: true })).toThrow('한 건씩')
  })
  it('also bounds the per-job options copy before registration and leaves storage unchanged', async () => {
    const library = pixaiLibrary()
    library.reservations = Array.from({ length: 10 }, (_, n) => ({
      id: `r${n}`,
      presetId: 'p1',
      characterId: 'c1',
      sceneIds: ['s1'],
      count: 100
    }))
    const value = {
      ...emptyWorkspace(),
      library,
      options: { ...emptyWorkspace().options, api: { style: 'x'.repeat(4 * 1024 * 1024) } }
    }
    const write = vi.fn(async () => {})
    const store = createPixaiStore({ read: async () => JSON.stringify(value), write })
    await store.getState().hydrate()
    await expect(store.getState().register()).rejects.toThrow('너무 큽니다')
    expect(write).not.toHaveBeenCalled()
    expect(store.getState().workspace.jobs).toEqual([])
    expect(store.getState().workspace.library.reservations).toHaveLength(10)
  })
  it('refuses a small accepted backup with large repeated text before creating job IDs', () => {
    const library = pixaiLibrary()
    library.common.prompt = 'x'.repeat(4 * 1024 * 1024)
    library.reservations = Array.from({ length: 10 }, (_, n) => ({
      id: `r${n}`,
      presetId: 'p1',
      characterId: 'c1',
      sceneIds: ['s1'],
      count: 100
    }))
    const backup = makeSettingsBackup(
      library,
      { maxCredits: null, filePrefix: '', repeat: 1 },
      { appVersion: 'test', exportedAt: new Date().toISOString() }
    )
    const parsed = parseSettingsBackup(JSON.stringify(backup))
    const idFactory = vi.fn(() => 'must-not-run')
    expect(() => expandReservations(parsed.library, { idFactory })).toThrow('너무 큽니다')
    expect(idFactory).not.toHaveBeenCalled()
  })
  it('preflights all reservations before allocating earlier valid jobs', () => {
    const library = pixaiLibrary()
    library.scenes[1].prompt = 'x'.repeat(500_000)
    library.reservations = [
      { id: 'small', presetId: 'p1', characterId: 'c1', sceneIds: ['s1'], count: 1 },
      { id: 'large', presetId: 'p1', characterId: 'c1', sceneIds: ['s2'], count: 100 }
    ]
    const idFactory = vi.fn(() => 'must-not-run')
    expect(() => expandReservations(library, { idFactory })).toThrow('너무 큽니다')
    expect(idFactory).not.toHaveBeenCalled()
  })
  it('bounds Cartesian pairs and repeat counts before IDs/snapshots are made', () => {
    const plan: BatchPlan = {
      id: 'p',
      name: '',
      rows: Array.from({ length: 100 }, (_, i) => ({ kind: 'character', id: `c${i}` })),
      columns: Array.from({ length: 100 }, (_, i) => `sc${i}`),
      count: 1,
      exceptions: {},
      order: 'byRow'
    }
    const idFactory = vi.fn(() => 'must-not-run')
    expect(expandBatchPlan(pixaiLibrary(), plan, { idFactory })).toMatchObject({
      reservations: [],
      problems: [{ level: 'error', message: expect.stringContaining('1,000쌍') }]
    })
    expect(idFactory).not.toHaveBeenCalled()
    plan.rows = [{ kind: 'character', id: 'c1' }]
    plan.columns = Array.from({ length: 11 }, (_, i) => `sc${i}`)
    plan.count = 100
    expect(expandBatchPlan(pixaiLibrary(), plan, { idFactory })).toMatchObject({
      reservations: [],
      problems: [{ level: 'error', message: expect.stringContaining('1,000개') }]
    })
    expect(idFactory).not.toHaveBeenCalled()
    plan.rows = []
    plan.columns = Array.from({ length: 1001 }, (_, i) => `sc${i}`)
    expect(expandBatchPlan(pixaiLibrary(), plan, { idFactory }).reservations).toEqual([])
    expect(expandBatchPlan(pixaiLibrary(), plan, { idFactory }).problems[0].level).toBe('error')
    expect(idFactory).not.toHaveBeenCalled()
  })
  it('bounds batch text before snapshot copies, while permitting ordinary 1,000 jobs', () => {
    const library = pixaiLibrary()
    const plan: BatchPlan = {
      id: 'p',
      name: '',
      rows: [{ kind: 'character', id: 'c1' }],
      columns: ['sc1'],
      count: 100,
      exceptions: {},
      order: 'byRow'
    }
    library.common.prompt = 'x'.repeat(100_000)
    const idFactory = vi.fn(() => 'must-not-run')
    expect(() => expandBatchPlan(library, plan, { idFactory })).toThrow('너무 큽니다')
    expect(idFactory).not.toHaveBeenCalled()
    library.common.prompt = 'quality'
    library.reservations = Array.from({ length: 10 }, (_, n) => ({
      id: `r${n}`,
      presetId: 'p1',
      characterId: 'c1',
      sceneIds: ['s1'],
      count: 100
    }))
    let id = 0
    expect(expandReservations(library, { idFactory: () => `job${++id}` })).toHaveLength(1000)
  })
})
