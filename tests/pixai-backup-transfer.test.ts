import { describe, expect, it, vi } from 'vitest'
import { pixaiLibrary } from './fixtures/pixai-workspace'
import {
  backupSelection,
  backupFolderChoices,
  makeTransferBackup,
  parseTransferBackup,
  prepareBackupImport,
  selectBackupLibrary,
  type BackupSelection
} from '../src/shared/pixai/backup-transfer'
import {
  expandReservations,
  makeSettingsBackup,
  strictLibrary,
  type BatchPlan
} from '../src/shared/pixai/library'
import { expandBatchPlan } from '../src/shared/pixai/batch-reserve'
import { createPixaiStore, emptyWorkspace, readWorkspace } from '../src/renderer/src/pixai/store'

const options = emptyWorkspace().options
const meta = { appVersion: 'test', exportedAt: '2026-10-16T00:00:00.000Z' }
const select = (...keys: Array<keyof BackupSelection>): BackupSelection => ({
  ...backupSelection(false),
  ...Object.fromEntries(keys.map((k) => [k, true]))
})
const ids = (): (() => string) => {
  let n = 0
  return () => `new-${++n}`
}
const plan: BatchPlan = {
  id: 'plan',
  name: '묶음',
  rows: [
    { kind: 'character', id: 'c1' },
    { kind: 'cast', id: 'cast1' }
  ],
  columns: ['sc1', 'sc2'],
  exceptions: { 'cast:cast1|sc2': 0 },
  count: 2,
  order: 'byColumn'
}

function folderLibrary(): ReturnType<typeof pixaiLibrary> {
  const library = pixaiLibrary()
  library.chunkFolders = [
    { id: 'f1', name: '표정' },
    { id: 'f2', name: '동작' },
    { id: 'empty', name: '빈 폴더' }
  ]
  library.sceneFolders = [
    { id: 'sf1', name: '첫 씬' },
    { id: 'sf2', name: '다른 씬' }
  ]
  library.scenes[0].folderId = 'f1'
  library.scenes[1].folderId = 'f2'
  library.sceneCards![0].folderId = 'sf1'
  library.sceneCards![1].folderId = 'sf2'
  return library
}

describe('selective backups and isolated imports', () => {
  it('exports chosen folders and unfiled items with counts, keeping empty selected folders', () => {
    const source = folderLibrary()
    expect(backupFolderChoices(source, 'scenes')).toEqual([
      { id: 'f1', name: '표정', count: 1 },
      { id: 'f2', name: '동작', count: 1 },
      { id: 'empty', name: '빈 폴더', count: 0 },
      { id: '', name: '미분류', count: 1 }
    ])
    const file = makeTransferBackup(source, options, select('scenes'), meta, {
      scenes: ['f1', 'empty', '']
    })
    expect(file.version).toBe(2)
    expect(file.backup.library.scenes.map((x) => x.id)).toEqual(['s1', 's3'])
    expect(file.backup.library.chunkFolders.map((x) => x.id)).toEqual(['f1', 'empty'])
    expect(parseTransferBackup(JSON.stringify(file))).toEqual(file)
    expect(makeTransferBackup(source, options, select('scenes'), meta).version).toBe(1)
  })

  it('replaces only the selected folder, even when the file also carries dependency chunks', () => {
    const source = folderLibrary()
    source.scenes[0].prompt = 'changed smile'
    source.sceneCards![0].sceneIds = ['s2']
    source.sceneCards![0].chunks = [{ ...source.scenes[1], folderId: undefined }]
    delete source.sceneCards![0].chunks[0].folderId
    const selection = select('scenes', 'sceneCards')
    const scopes = { scenes: ['f1'], sceneCards: ['sf1'] }
    const file = makeTransferBackup(source, options, selection, meta, scopes)
    expect(selectBackupLibrary(source, selection, scopes).dependencies).toEqual({ scenes: 1 })
    const original = folderLibrary()
    const result = prepareBackupImport(original, file, selection, 'replace', ids())
    expect(result.library.scenes.find((x) => x.id === 's1')?.prompt).toBe('changed smile')
    expect(result.library.scenes.find((x) => x.id === 's2')).toEqual(original.scenes[1])
    expect(result.library.scenes.find((x) => x.id === 's3')).toEqual(original.scenes[2])
    expect(result.library.sceneCards!.find((x) => x.id === 'sc2')).toEqual(original.sceneCards![1])
    expect(result.library.sceneCards!.find((x) => x.id === 'sc3')).toEqual(original.sceneCards![2])
    expect(result.library.chunkFolders.find((x) => x.id === 'f2')).toEqual(original.chunkFolders[1])
    const importedCard = result.library.sceneCards!.find((x) => x.id === 'sc1')!
    expect(importedCard.sceneIds[0]).not.toBe('s2')
    expect(result.library.scenes.find((x) => x.id === importedCard.sceneIds[0])?.prompt).toBe(
      'wave'
    )
    expect(result.dependencies).toEqual({ scenes: 1 })
    expect(result.library.scenes).toHaveLength(4)
    expect(original).toEqual(folderLibrary())
  })

  it('clears an explicitly selected empty folder while preserving all other folders and materials', () => {
    const source = folderLibrary()
    source.scenes = source.scenes.filter((x) => x.folderId !== 'f1')
    const file = makeTransferBackup(source, options, select('scenes'), meta, { scenes: ['f1'] })
    const original = folderLibrary()
    const result = prepareBackupImport(original, file, select('scenes'), 'replace', ids()).library
    expect(result.scenes).toEqual(original.scenes.slice(1))
    expect(result.chunkFolders).toContainEqual(original.chunkFolders[0])
    expect(result.chunkFolders).toHaveLength(3)
    expect(result.sceneCards).toEqual(original.sceneCards)
  })

  it('replaces unfiled materials only and permits narrowing old whole-category backups', () => {
    const source = folderLibrary()
    source.scenes[2].prompt = 'new unfiled'
    const original = folderLibrary()
    const file = makeTransferBackup(source, options, select('scenes'), meta)
    const result = prepareBackupImport(original, file, select('scenes'), 'replace', ids(), {
      scenes: ['']
    }).library
    expect(result.scenes.slice(0, 2)).toEqual(original.scenes.slice(0, 2))
    expect(result.scenes[2].prompt).toBe('new unfiled')
    expect(result.chunkFolders).toEqual(original.chunkFolders)
  })

  it('allocates new IDs for incoming selected items that collide with retained materials', () => {
    const source = folderLibrary()
    source.scenes[0].prompt = 'incoming'
    const original = folderLibrary()
    original.scenes[0].folderId = 'f2'
    const file = makeTransferBackup(source, options, select('scenes'), meta, { scenes: ['f1'] })
    const result = prepareBackupImport(original, file, select('scenes'), 'replace', ids()).library
    expect(result.scenes.find((x) => x.id === 's1')).toEqual(original.scenes[0])
    expect(result.scenes.find((x) => x.prompt === 'incoming')?.id).not.toBe('s1')
    expect(result.scenes).toHaveLength(4)
  })

  it('appends chosen folder copies without changing same-name or same-ID originals', () => {
    const source = folderLibrary()
    const file = makeTransferBackup(source, options, select('sceneCards'), meta, {
      sceneCards: ['sf1']
    })
    const result = prepareBackupImport(source, file, select('sceneCards'), 'append', ids()).library
    expect(result.sceneCards!.slice(0, 3)).toEqual(source.sceneCards)
    expect(result.sceneFolders!.slice(0, 2)).toEqual(source.sceneFolders)
    expect(result.sceneCards![3].folderId).not.toBe('sf1')
    expect(result.sceneFolders![2].id).toBe(result.sceneCards![3].folderId)
    expect(result.scenes).toHaveLength(4)
  })

  it('rejects unknown/empty scopes and prevents widening a partial backup into replacement', () => {
    const source = folderLibrary()
    const selection = select('scenes')
    const file = makeTransferBackup(source, options, selection, meta, { scenes: ['f1'] })
    expect(() => makeTransferBackup(source, options, selection, meta, { scenes: [] })).toThrow(
      '폴더'
    )
    expect(() =>
      makeTransferBackup(source, options, selection, meta, { scenes: ['missing'] })
    ).toThrow('폴더')
    expect(() => parseTransferBackup(JSON.stringify({ ...file, version: 1 }))).toThrow('형식')
    expect(() =>
      parseTransferBackup(JSON.stringify({ ...file, folderSelection: { scenes: [] } }))
    ).toThrow('폴더')
    expect(() =>
      parseTransferBackup(JSON.stringify({ ...file, folderSelection: { scenes: ['f1', 'f1'] } }))
    ).toThrow('폴더')
    expect(() =>
      prepareBackupImport(source, file, selection, 'replace', ids(), { scenes: [''] })
    ).toThrow('폴더')
    const sceneFile = makeTransferBackup(source, options, select('sceneCards'), meta, {
      sceneCards: ['sf1']
    })
    expect(() =>
      prepareBackupImport(source, sceneFile, select('scenes'), 'replace', ids())
    ).toThrow('폴더')
  })

  it('exports scenes with their edited snapshots, needed live chunks and folder order only', () => {
    const library = pixaiLibrary()
    library.sceneCards = library.sceneCards!.slice(0, 1)
    library.sceneCards[0].chunks[0].prompt = 'edited smile'
    library.chunkFolders = [
      { id: 'f1', name: '표정' },
      { id: 'f2', name: '빈 폴더' }
    ]
    library.scenes[0].folderId = 'f1'
    const selection = select('sceneCards')
    const file = makeTransferBackup(
      library,
      { ...options, filePrefix: 'private-name' },
      selection,
      meta
    )
    expect(file.backup.library.scenes.map((x) => x.id)).toEqual(['s1'])
    expect(file.backup.library.chunkFolders).toEqual([library.chunkFolders[0]])
    expect(file.backup.library.sceneCards![0].chunks[0].prompt).toBe('edited smile')
    expect(file.backup.library.presets).toEqual([])
    expect(file.backup.library.characters).toEqual([])
    expect(file.backup.library.common.prompt).toBe('')
    expect(JSON.stringify(file)).not.toContain('private-name')
    expect(parseTransferBackup(JSON.stringify(file))).toEqual(file)
    expect(selectBackupLibrary(library, selection).dependencies).toEqual({ scenes: 1 })
  })

  it('includes empty folders when selecting a whole material category', () => {
    const library = pixaiLibrary()
    library.characterFolders = [{ id: 'empty', name: '빈 폴더' }]
    expect(selectBackupLibrary(library, select('characters')).library.characterFolders).toEqual(
      library.characterFolders
    )
  })

  it('reads old app/script backups and refuses unknown / dangerous metadata or keys', () => {
    const legacy = makeSettingsBackup(pixaiLibrary(), options, meta)
    expect(parseTransferBackup(JSON.stringify(legacy)).selection).toEqual(backupSelection())
    const file = makeTransferBackup(pixaiLibrary(), options, select('scenes'), meta)
    expect(() => parseTransferBackup(JSON.stringify({ ...file, version: 2 }))).toThrow()
    expect(() => parseTransferBackup(JSON.stringify({ ...file, token: 'dummy' }))).toThrow()
    expect(() =>
      parseTransferBackup(JSON.stringify({ ...file, selection: { scenes: true } }))
    ).toThrow()
    expect(() =>
      parseTransferBackup(JSON.stringify(file).replace('"version":1', '"__proto__":{},"version":1'))
    ).toThrow()
    expect(() => parseTransferBackup(' '.repeat(5 * 1024 * 1024 + 1))).toThrow('5MiB')
    expect(() =>
      makeTransferBackup(
        pixaiLibrary(),
        { ...options, api: { apiKey: 'dummy' } },
        select('options'),
        meta
      )
    ).toThrow()
  })

  it('appends collisions without altering originals or external model/LoRA IDs', () => {
    const original = pixaiLibrary()
    const incoming = pixaiLibrary()
    incoming.common.prompt = 'imported quality'
    incoming.characters[0].prompt = 'new alice'
    const file = makeTransferBackup(incoming, options, select('characters'), meta)
    const result = prepareBackupImport(original, file, select('characters'), 'append', ids())
    expect(result.library.characters.slice(0, 3)).toEqual(original.characters)
    const added = result.library.characters[3]
    expect(added.id).not.toBe('c1')
    const preset = result.library.presets.find((p) => p.id === added.defaultPresetId)!
    expect(preset.model).toEqual(original.presets[0].model)
    expect(preset.loras).toEqual(original.presets[0].loras)
    expect(result.library.common).toEqual(original.common)
    expect(result.library.commonPresets!.find((x) => x.id === preset.commonPresetId)?.prompt).toBe(
      'imported quality'
    )
    expect(original).toEqual(pixaiLibrary())
  })

  it('remaps rows, casts, folder references, plan exceptions and frozen reservations together', () => {
    const source = pixaiLibrary()
    source.casts = [{ id: 'cast1', name: '의상', characterId: 'c2', presetId: 'p1' }]
    source.batchPlans = [plan]
    source.characterFolders = [{ id: 'f', name: '캐릭터' }]
    source.characters[0].folderId = 'f'
    source.reservations = expandBatchPlan(source, plan, { idFactory: ids() }).reservations
    const before = expandReservations(source).map((x) => x.prompt)
    const selection = select('batchPlans', 'reservations')
    const file = makeTransferBackup(source, options, selection, meta)
    const result = prepareBackupImport(pixaiLibrary(), file, selection, 'append', ids()).library
    const nextPlan = result.batchPlans![0]
    expect(expandBatchPlan(result, nextPlan).totals.jobs).toBe(6)
    expect(Object.values(nextPlan.exceptions)).toEqual([0])
    expect(nextPlan.rows[1].id).toBe(result.casts![0].id)
    expect(result.casts![0].characterId).not.toBe('c2')
    expect(
      result.reservations.every((r) => result.sceneCards!.some((c) => c.id === r.sourceSceneId))
    ).toBe(true)
    expect(expandReservations(result).map((x) => x.prompt)).toEqual(before)
    expect(result.characters.find((c) => c.id === nextPlan.rows[0].id)?.folderId).toBe(
      result.characterFolders![0].id
    )
  })

  it('replaces chunks only and freezes retained reservations before replacing their text', () => {
    const original = pixaiLibrary()
    original.reservations = [
      { id: 'r1', presetId: 'p1', characterId: 'c1', sceneIds: ['s1'], count: 1 }
    ]
    const before = expandReservations(original)[0].prompt
    const source = pixaiLibrary()
    source.scenes[0].prompt = 'changed'
    const file = makeTransferBackup(source, options, select('scenes'), meta)
    const result = prepareBackupImport(original, file, select('scenes'), 'replace').library
    expect(result.scenes).toEqual(source.scenes)
    expect(result.characters).toEqual(original.characters)
    expect(result.presets).toEqual(original.presets)
    expect(result.sceneCards).toEqual(original.sceneCards)
    expect(result.reservations[0].snapshot).toBeTruthy()
    expect(expandReservations(result)[0].prompt).toBe(before)
  })

  it('replacement dependencies append instead of wiping unselected categories', () => {
    const source = pixaiLibrary()
    source.sceneCards = source.sceneCards!.slice(0, 1)
    const file = makeTransferBackup(source, options, select('sceneCards'), meta)
    const result = prepareBackupImport(pixaiLibrary(), file, select('sceneCards'), 'replace', ids())
    expect(result.library.sceneCards).toHaveLength(1)
    expect(result.library.scenes.slice(0, 3)).toEqual(pixaiLibrary().scenes)
    expect(result.library.scenes).toHaveLength(4)
    expect(result.library.sceneCards![0].sceneIds).toEqual([result.library.scenes[3].id])
  })

  it('freezes legacy reservations with foldered materials before a partial replacement', () => {
    const original = pixaiLibrary()
    original.chunkFolders = [{ id: 'f1', name: '표정' }]
    original.characterFolders = [{ id: 'cf1', name: '캐릭터' }]
    original.scenes[0].folderId = 'f1'
    original.characters[0].folderId = 'cf1'
    original.reservations = [
      { id: 'r1', presetId: 'p1', characterId: 'c1', sceneIds: ['s1'], count: 2 }
    ]
    const before = expandReservations(original).map((x) => x.prompt)
    const source = pixaiLibrary()
    source.scenes[0].prompt = 'new smile'
    const selection = select('scenes')
    const imported = prepareBackupImport(
      original,
      makeTransferBackup(source, options, selection, meta),
      selection,
      'replace'
    ).library
    expect(imported.reservations[0].snapshot!.chunks[0].folderId).toBeUndefined()
    expect(imported.reservations[0].snapshot!.character.folderId).toBeUndefined()
    expect(expandReservations(imported).map((x) => x.prompt)).toEqual(before)
    expect(original.scenes[0].folderId).toBe('f1')
  })

  it('supports explicit empty-category clearing but blocks removing a still-linked common set', () => {
    const source = pixaiLibrary()
    source.scenes = []
    const file = makeTransferBackup(source, options, select('scenes'), meta)
    expect(
      prepareBackupImport(pixaiLibrary(), file, select('scenes'), 'replace').library.scenes
    ).toEqual([])
    const original = pixaiLibrary()
    original.commonPresets = [{ id: 'linked', name: '공통', prompt: 'test', negativePrompt: '' }]
    original.presets[0].commonPresetId = 'linked'
    expect(() =>
      prepareBackupImport(
        original,
        makeTransferBackup(source, options, select('commonPresets'), meta),
        select('commonPresets'),
        'replace'
      )
    ).toThrow('남겨 둔 프리셋')
  })

  it('does not bind missing source materials to existing IDs during append', () => {
    const source = pixaiLibrary()
    source.characters[0].defaultPresetId = 'missing'
    const existing = pixaiLibrary()
    existing.presets[0].id = 'missing'
    const result = prepareBackupImport(
      existing,
      makeTransferBackup(source, options, select('characters'), meta),
      select('characters'),
      'append',
      ids()
    ).library
    expect(result.characters[3].defaultPresetId).not.toBe('missing')
  })

  it('preserves imported default when also replacing named common sets', () => {
    const source = pixaiLibrary()
    source.common.prompt = 'source default'
    const selection = select('presets', 'commonPresets')
    const result = prepareBackupImport(
      pixaiLibrary(),
      makeTransferBackup(source, options, selection, meta),
      selection,
      'replace',
      ids()
    ).library
    expect(
      result.commonPresets!.find((x) => x.id === result.presets[0].commonPresetId)?.prompt
    ).toBe('source default')
  })

  it('commits imports atomically, retains queued jobs/options and rejects stale previews', async () => {
    let persisted = JSON.stringify({ ...emptyWorkspace(), library: pixaiLibrary() })
    const storage = {
      read: async () => persisted,
      write: vi.fn(async (value: string) => {
        persisted = value
      })
    }
    const store = createPixaiStore(storage)
    await store.getState().hydrate()
    await store.getState().reserve({ ...plan, rows: [{ kind: 'character', id: 'c1' }] }, true)
    const before = structuredClone(store.getState().workspace)
    const selection = select('scenes')
    const source = pixaiLibrary()
    source.scenes[0].prompt = 'new'
    const file = makeTransferBackup(source, { ...options, repeat: 9 }, selection, meta)
    const at = store.getState().revision
    storage.write.mockRejectedValueOnce(new Error('disk full'))
    await expect(
      store.getState().importSelectedBackup(file, selection, 'replace', at)
    ).rejects.toThrow('저장하지 못했습니다')
    expect(store.getState().workspace).toEqual(before)
    await store.getState().importSelectedBackup(file, selection, 'replace', at)
    expect(store.getState().workspace.jobs).toEqual(before.jobs)
    expect(store.getState().workspace.options).toEqual(before.options)
    expect(readWorkspace(persisted).jobs).toEqual(before.jobs)
    await expect(
      store.getState().importSelectedBackup(file, selection, 'replace', at)
    ).rejects.toThrow('미리보기 후')
  })

  it('rejects over-capacity appends without dropping recent history', () => {
    const source = pixaiLibrary()
    source.combinations = Array.from({ length: 30 }, (_, n) => ({
      id: `h${n}`,
      presetId: 'p1',
      characterId: 'c1',
      sceneIds: ['s1'],
      count: 1,
      favorite: false,
      name: '',
      at: n
    }))
    const file = makeTransferBackup(source, options, select('combinations'), meta)
    expect(() =>
      prepareBackupImport(source, file, select('combinations'), 'append', ids())
    ).toThrow('50개')
    expect(strictLibrary(source).combinations).toHaveLength(30)
  })
})
