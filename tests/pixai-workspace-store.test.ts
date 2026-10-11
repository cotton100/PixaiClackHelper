import { describe, expect, it, vi } from 'vitest'
import { createPixaiStore, emptyWorkspace, readWorkspace } from '../src/renderer/src/pixai/store'
import {
  makeSettingsBackup,
  parseSettingsBackup,
  type BatchPlan
} from '../src/shared/pixai/library'
import { pixaiLibrary } from './fixtures/pixai-workspace'

function fixture(): {
  store: ReturnType<typeof createPixaiStore>
  storage: { read: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> }
  plan: BatchPlan
  persisted: () => string
} {
  let persisted = JSON.stringify({ ...emptyWorkspace(), library: pixaiLibrary() })
  const storage = {
    read: vi.fn(async () => persisted),
    write: vi.fn(async (text: string) => {
      persisted = text
    })
  }
  const store = createPixaiStore(storage)
  const plan: BatchPlan = {
    id: 'plan1',
    name: '',
    rows: [
      { kind: 'character', id: 'c1' },
      { kind: 'character', id: 'c2' },
      { kind: 'character', id: 'c3' }
    ],
    columns: ['sc1', 'sc2', 'sc3'],
    count: 2,
    exceptions: {},
    order: 'byRow'
  }
  return { store, storage, plan, persisted: () => persisted }
}

describe('PixAIS workspace persistence and atomic actions', () => {
  it('serializes rapid draft saves with later library changes and rolls back a failed draft save', async () => {
    const f = fixture()
    await f.store.getState().hydrate()
    const base = {
      presetId: 'p1',
      characterId: 'c1',
      sceneIds: ['s1'],
      count: 1,
      triggerPosition: 'end' as const
    }
    const first = f.store.getState().saveDraft(base)
    const second = f.store.getState().saveDraft({ ...base, count: 12 })
    const edit = f.store
      .getState()
      .editLibrary((library) => ({
        ...library,
        common: { prompt: 'edited common', negativePrompt: '' }
      }))
    await Promise.all([first, second, edit])
    const before = f.persisted()
    expect(readWorkspace(before).composeDraft?.count).toBe(12)
    expect(readWorkspace(before).library.common.prompt).toBe('edited common')
    f.storage.write.mockRejectedValueOnce(new Error('disk full'))
    await f.store.getState().saveDraft({ ...base, count: 7 })
    expect(f.persisted()).toBe(before)
    expect(f.store.getState().workspace.composeDraft?.count).toBe(12)
    expect(f.store.getState().error).toContain('저장하지 못했습니다')
    expect(f.store.getState().draftSaving).toBe(false)
  })
  it('retains current composition, trigger order and image settings across a fresh store', async () => {
    const f = fixture()
    await f.store.getState().hydrate()
    const draft = {
      presetId: 'p1',
      characterId: 'c2',
      sceneIds: ['s2', 's1'],
      count: 7,
      triggerPosition: 'end' as const,
      imageOptions: {
        aspectRatio: '5:3',
        size: '1.5k' as const,
        batchSize: 4 as const,
        mode: 'ultra' as const
      }
    }
    await f.store.getState().commit((w) => ({ ...w, composeDraft: draft }))
    await f.store.getState().reserve(f.plan)
    await f.store.getState().register()
    const fresh = createPixaiStore(f.storage)
    await fresh.getState().hydrate()
    expect(fresh.getState().ready).toBe(true)
    expect(fresh.getState().workspace.composeDraft).toEqual(draft)
    expect(fresh.getState().workspace.jobs).toHaveLength(18)
    expect(fresh.getState().workspace.library.characters).toEqual(pixaiLibrary().characters)
  })
  it('retains incomplete repeat input and loaded scene snapshots without selecting replacement materials', async () => {
    const f = fixture()
    await f.store.getState().hydrate()
    const card = {
      ...pixaiLibrary().sceneCards![0],
      extra: { prompt: 'saved extra', negativePrompt: 'saved negative' }
    }
    await f.store.getState().commit((w) => ({
      ...w,
      composeDraft: {
        presetId: 'removed-preset',
        characterId: 'removed-character',
        sceneIds: ['s1'],
        count: NaN,
        triggerPosition: 0,
        card
      }
    }))
    const reloaded = readWorkspace(f.persisted())
    expect(reloaded.composeDraft?.count).toBeNaN()
    expect(reloaded.composeDraft?.presetId).toBe('removed-preset')
    expect(reloaded.composeDraft?.card).toEqual(card)
    expect(reloaded.composeDraft?.triggerPosition).toBe(0)
    expect(
      readWorkspace(JSON.stringify({ ...emptyWorkspace(), library: pixaiLibrary() })).composeDraft
    ).toBeUndefined()
  })
  it('reserves 3 × 3, registers 18 frozen jobs once and reloads the same IDs', async () => {
    const f = fixture()
    await f.store.getState().hydrate()
    const result = await f.store.getState().reserve(f.plan)
    expect(result.totals).toMatchObject({ pairs: 9, jobs: 18, images: 72 })
    expect(f.store.getState().workspace.library.reservations).toHaveLength(9)
    await f.store.getState().register()
    expect(f.store.getState().workspace.library.reservations).toHaveLength(0)
    expect(f.store.getState().workspace.jobs).toHaveLength(18)
    const ids = f.store.getState().workspace.jobs.map((job) => job.request.id)
    expect(new Set(ids).size).toBe(18)
    const reloaded = readWorkspace(f.persisted())
    expect(reloaded.jobs.map((job) => job.request.id)).toEqual(ids)
    expect(reloaded.jobs[1].request.composition.reservation.repeat).toBe(2)
    expect(reloaded.jobs[0].request.prompt).toBe('quality, trigger, alice, smile')
    await expect(f.store.getState().register()).rejects.toThrow('등록할 예약이 없습니다')
  })
  it('rejects concurrent saves and preserves both memory and disk on failed reservation or registration', async () => {
    const f = fixture()
    await f.store.getState().hydrate()
    const before = f.persisted()
    let rejectWrite!: (error: Error) => void
    f.storage.write.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectWrite = reject
        })
    )
    const pending = f.store.getState().reserve(f.plan)
    expect(f.store.getState().busy).toBe(true)
    await expect(f.store.getState().reserve(f.plan)).rejects.toThrow('저장 중')
    rejectWrite(new Error('disk full'))
    await expect(pending).rejects.toThrow('저장하지 못했습니다')
    expect(f.persisted()).toBe(before)
    expect(f.store.getState().workspace.library.reservations).toEqual([])
    expect(f.store.getState().busy).toBe(false)
    await f.store.getState().reserve(f.plan)
    const reserved = f.persisted()
    f.storage.write.mockRejectedValueOnce(new Error('disk full'))
    await expect(f.store.getState().register()).rejects.toThrow('저장하지 못했습니다')
    expect(f.persisted()).toBe(reserved)
    expect(f.store.getState().workspace.library.reservations).toHaveLength(9)
    expect(f.store.getState().workspace.jobs).toEqual([])
  })
  it('imports and exports script settings without losing library/options, preview revision or registered jobs', async () => {
    const f = fixture()
    await f.store.getState().hydrate()
    await f.store
      .getState()
      .reserve({ ...f.plan, rows: [f.plan.rows[0]], columns: ['sc1'], count: 1 })
    await f.store.getState().register()
    const beforeJobs = f.store.getState().workspace.jobs
    const backup = makeSettingsBackup(
      pixaiLibrary(),
      {
        maxCredits: null,
        filePrefix: 'test',
        repeat: 2,
        imageCount: 1,
        api: { aspectRatio: '5:3', size: '1k' }
      },
      { appVersion: '0.9.12', exportedAt: '2026-10-10T00:00:00Z' },
      'script'
    )
    const parsed = parseSettingsBackup(JSON.stringify(backup))
    const revision = f.store.getState().revision
    await f.store.getState().importBackup(parsed, revision)
    expect(f.store.getState().workspace.jobs).toEqual(beforeJobs)
    expect(readWorkspace(f.persisted()).jobs[0].options.imageCount).toBe(4)
    expect(readWorkspace(f.persisted()).options.imageCount).toBe(1)
    expect(f.store.getState().workspace.library).toEqual(parsed.library)
    expect(f.store.getState().workspace.options).toEqual(parsed.options)
    await expect(f.store.getState().importBackup(parsed, revision)).rejects.toThrow(
      '미리보기 후 자료가 바뀌었습니다'
    )
    expect(
      parseSettingsBackup(
        JSON.stringify(
          makeSettingsBackup(
            f.store.getState().workspace.library,
            f.store.getState().workspace.options,
            { appVersion: 'test', exportedAt: new Date().toISOString() },
            'script'
          )
        )
      ).library
    ).toEqual(parsed.library)
  })
  it('fails closed on unreadable data and can retry without overwriting it', async () => {
    const f = fixture()
    f.storage.read.mockResolvedValueOnce('{invalid')
    await f.store.getState().hydrate()
    expect(f.store.getState().ready).toBe(false)
    await expect(f.store.getState().editLibrary((library) => library)).rejects.toThrow(
      '먼저 불러와'
    )
    expect(f.storage.write).not.toHaveBeenCalled()
    await f.store.getState().hydrate()
    expect(f.store.getState().ready).toBe(true)
  })
  it('counts existing jobs toward the 1000 limit without partially adding reservations', async () => {
    const f = fixture()
    await f.store.getState().hydrate()
    await f.store.getState().reserve({ ...f.plan, count: 100 })
    await f.store.getState().register()
    const before = f.persisted()
    await expect(f.store.getState().reserve({ ...f.plan, count: 20 })).rejects.toThrow('1,000')
    expect(f.persisted()).toBe(before)
    expect(f.store.getState().workspace.library.reservations).toEqual([])
  })
})
