import { describe, expect, it } from 'vitest'
import { pixaiLibrary } from './fixtures/pixai-workspace'
import {
  expandReservations,
  exportForScript,
  makeSettingsBackup,
  normalizeSnapshot,
  parseSettingsBackup,
  strictLibrary
} from '../src/shared/pixai/library'
import {
  backupSelection,
  makeTransferBackup,
  parseTransferBackup,
  prepareBackupImport,
  selectBackupLibrary
} from '../src/shared/pixai/backup-transfer'
import { createPixaiStore, emptyWorkspace } from '../src/renderer/src/pixai/store'
import { assertCompatible, DATA_EPOCH } from '../src/shared/pixai/updates'

const meta = { appVersion: 'test', exportedAt: '2026-11-08T00:00:00.000Z' }

function folderLibrary(): ReturnType<typeof pixaiLibrary> {
  const library = pixaiLibrary()
  library.presetFolders = [
    { id: 'pf1', name: '화풍' },
    { id: 'pf2', name: '다른 모델' },
    { id: 'pf-empty', name: '빈 폴더' }
  ]
  library.commonPresetFolders = [
    { id: 'cf1', name: '품질' },
    { id: 'cf2', name: '보조' },
    { id: 'cf-empty', name: '빈 공통문 폴더' }
  ]
  library.commonPresets = [
    { id: 'cp1', name: '밝은 문구', prompt: 'bright', negativePrompt: 'dark', folderId: 'cf1' },
    { id: 'cp2', name: '선명한 문구', prompt: 'sharp', negativePrompt: 'blur', folderId: 'cf2' },
    { id: 'cp0', name: '미분류 문구', prompt: 'unfiled', negativePrompt: '' }
  ]
  library.presets[0].folderId = 'pf1'
  library.presets[0].commonPresetId = 'cp1'
  library.presets.push({
    ...structuredClone(library.presets[0]),
    id: 'p2',
    name: '다른 프리셋',
    folderId: 'pf2',
    commonPresetId: 'cp2'
  })
  return library
}

const options = emptyWorkspace().options
const selectedPresets = { ...backupSelection(false), presets: true }
const selectedCommon = { ...backupSelection(false), commonPresets: true }
const idFactory = (): (() => string) => {
  let value = 0
  return () => `import-${++value}`
}

describe('preset and common prompt folders', () => {
  it.each(['presets', 'commonPresets'] as const)(
    'keeps %s folder positions during a scoped replacement',
    (category) => {
      const original = folderLibrary()
      const folderKey = category === 'presets' ? 'presetFolders' : 'commonPresetFolders'
      const target = original[folderKey]![0].id
      const selection = { ...backupSelection(false), [category]: true }
      const source = structuredClone(original)
      source[folderKey]![0].name = '교체한 폴더'
      const file = makeTransferBackup(source, options, selection, meta, { [category]: [target] })
      const result = prepareBackupImport(original, file, selection, 'replace', idFactory()).library
      expect(result[folderKey]?.map((folder) => folder.id)).toEqual(
        original[folderKey]?.map((folder) => folder.id)
      )
      expect(result[folderKey]![0].name).toBe('교체한 폴더')
      expect(original[folderKey]![0].name).not.toBe('교체한 폴더')
    }
  )
  it('does not introduce new folder keys into legacy selection backups or imports', () => {
    const old = pixaiLibrary()
    const selected = selectBackupLibrary(old, selectedPresets).library
    expect(selected).not.toHaveProperty('presetFolders')
    expect(selected).not.toHaveProperty('commonPresetFolders')
    const file = makeTransferBackup(old, options, selectedPresets, meta)
    const restored = prepareBackupImport(old, file, selectedPresets, 'append', idFactory()).library
    expect(restored).not.toHaveProperty('presetFolders')
    expect(restored).not.toHaveProperty('commonPresetFolders')
  })
  it('keeps old libraries unchanged and validates new folder keys and references', () => {
    const old = pixaiLibrary()
    expect(strictLibrary(old)).not.toHaveProperty('presetFolders')
    expect(strictLibrary(old)).not.toHaveProperty('commonPresetFolders')
    const source = folderLibrary()
    expect(strictLibrary(source)).toEqual(source)
    expect(() => strictLibrary({ ...source, presetFolders: [] })).toThrow('폴더가 없습니다')
    expect(() => strictLibrary({ ...source, commonPresetFolders: [] })).toThrow('폴더가 없습니다')
    expect(() =>
      strictLibrary({
        ...source,
        presetFolders: [...source.presetFolders!, source.presetFolders![0]]
      })
    ).toThrow('중복')
    expect(() =>
      strictLibrary({ ...source, commonPresetFolders: [{ id: 'cf1', name: ' ', unknown: true }] })
    ).toThrow()
  })

  it('preserves folder order and membership through full backup, editing, save and restart', async () => {
    const source = folderLibrary()
    const backup = makeSettingsBackup(source, options, meta)
    expect(parseSettingsBackup(JSON.stringify(backup)).library).toEqual(source)
    let saved = JSON.stringify({ ...emptyWorkspace(), library: source })
    const storage = {
      read: async () => saved,
      write: async (text: string) => {
        saved = text
      }
    }
    const store = createPixaiStore(storage)
    await store.getState().hydrate()
    await store.getState().editLibrary((library) => ({
      ...library,
      presetFolders: [...library.presetFolders!].reverse(),
      commonPresetFolders: [...library.commonPresetFolders!].reverse(),
      presets: [...library.presets].reverse()
    }))
    const restart = createPixaiStore(storage)
    await restart.getState().hydrate()
    expect(restart.getState().workspace.library).toEqual(store.getState().workspace.library)
    expect(restart.getState().workspace.library.presetFolders?.[0].id).toBe('pf-empty')
    expect(restart.getState().workspace.library.commonPresets?.[0].folderId).toBe('cf1')
  })

  it('includes linked common sets and their folders while preserving selected empty folders', () => {
    const source = folderLibrary()
    const picked = selectBackupLibrary(source, selectedPresets, { presets: ['pf1', 'pf-empty'] })
    expect(picked.library.presets.map((item) => item.id)).toEqual(['p1'])
    expect(picked.library.presetFolders?.map((folder) => folder.id)).toEqual(['pf1', 'pf-empty'])
    expect(picked.library.commonPresets?.map((item) => item.id)).toEqual(['cp1'])
    expect(picked.library.commonPresetFolders?.map((folder) => folder.id)).toEqual(['cf1'])
    expect(picked.dependencies.commonPresets).toBe(1)
    const file = makeTransferBackup(source, options, selectedPresets, meta, { presets: ['pf1'] })
    expect(parseTransferBackup(JSON.stringify(file))).toEqual(file)
    expect(
      selectBackupLibrary(source, selectedCommon, { commonPresets: [''] }).library.commonPresets
    ).toEqual([source.commonPresets![2]])
    const empty = selectBackupLibrary(source, selectedCommon, { commonPresets: ['cf-empty'] })
    expect(empty.library.commonPresets).toEqual([])
    expect(empty.library.commonPresetFolders).toEqual([source.commonPresetFolders![2]])
  })

  it('keeps registered jobs usable after their live preset and common folders are removed', async () => {
    const source = folderLibrary()
    source.reservations = [
      { id: 'r1', presetId: 'p1', characterId: 'c1', sceneIds: ['s1'], count: 1 }
    ]
    let saved = JSON.stringify({ ...emptyWorkspace(), library: source })
    const storage = {
      read: async () => saved,
      write: async (text: string) => {
        saved = text
      }
    }
    const store = createPixaiStore(storage)
    await store.getState().hydrate()
    await store.getState().register()
    const before = store.getState().workspace.jobs[0].request
    await store.getState().editLibrary((library) => ({
      ...library,
      presets: library.presets.map((preset) => {
        const next = { ...preset }
        delete next.folderId
        return next
      }),
      commonPresets: library.commonPresets!.map((preset) => {
        const next = { ...preset }
        delete next.folderId
        return next
      }),
      presetFolders: [],
      commonPresetFolders: []
    }))
    const restart = createPixaiStore(storage)
    await restart.getState().hydrate()
    expect(restart.getState().error).toBe('')
    const after = restart.getState().workspace.jobs[0].request
    expect([after.id, after.prompt, after.negativePrompt, after.configuration]).toEqual([
      before.id,
      before.prompt,
      before.negativePrompt,
      before.configuration
    ])
    expect(after.composition.preset).not.toHaveProperty('folderId')
  })

  it('remaps colliding folders and linked common sets on append without touching the originals', () => {
    const original = folderLibrary()
    const file = makeTransferBackup(original, options, selectedPresets, meta, { presets: ['pf1'] })
    const result = prepareBackupImport(
      original,
      file,
      selectedPresets,
      'append',
      idFactory()
    ).library
    expect(result.presets.slice(0, 2)).toEqual(original.presets)
    expect(result.presetFolders?.slice(0, 3)).toEqual(original.presetFolders)
    expect(result.commonPresets?.slice(0, 3)).toEqual(original.commonPresets)
    expect(result.commonPresetFolders?.slice(0, 3)).toEqual(original.commonPresetFolders)
    const added = result.presets[2]
    const common = result.commonPresets!.find((item) => item.id === added.commonPresetId)!
    expect(added.id).not.toBe('p1')
    expect(added.folderId).not.toBe('pf1')
    expect(result.presetFolders?.find((folder) => folder.id === added.folderId)?.name).toBe('화풍')
    expect(common.id).not.toBe('cp1')
    expect(common.folderId).not.toBe('cf1')
    expect(result.commonPresetFolders?.find((folder) => folder.id === common.folderId)?.name).toBe(
      '품질'
    )
    expect(common.prompt).toBe('bright')
    expect(original).toEqual(folderLibrary())
  })

  it('replaces one preset folder without changing other folders or previously reserved prompts', () => {
    const original = folderLibrary()
    original.reservations = [
      { id: 'r1', presetId: 'p1', characterId: 'c1', sceneIds: ['s1'], count: 1 }
    ]
    const before = expandReservations(original)[0]
    const source = folderLibrary()
    source.presets[0].name = '수정한 프리셋'
    source.commonPresets![0].prompt = 'changed bright'
    const file = makeTransferBackup(source, options, selectedPresets, meta, { presets: ['pf1'] })
    const result = prepareBackupImport(
      original,
      file,
      selectedPresets,
      'replace',
      idFactory()
    ).library
    expect(result.presets.find((item) => item.id === 'p2')).toEqual(original.presets[1])
    expect(result.presetFolders).toContainEqual(original.presetFolders![1])
    expect(result.commonPresets).toContainEqual(original.commonPresets![0])
    expect(result.presets.find((item) => item.id === 'p1')?.name).toBe('수정한 프리셋')
    expect(result.reservations[0].snapshot?.preset).not.toHaveProperty('folderId')
    const after = expandReservations(result)[0]
    expect([after.prompt, after.negativePrompt]).toEqual([before.prompt, before.negativePrompt])
    expect(result.reservations[0].snapshot?.common.prompt).toBe('bright')
  })

  it('rejects a scoped common-folder replacement that would break retained preset links', () => {
    const original = folderLibrary()
    const source = folderLibrary()
    source.commonPresets = source.commonPresets!.filter((item) => item.id !== 'cp1')
    delete source.presets[0].commonPresetId
    const file = makeTransferBackup(source, options, selectedCommon, meta, {
      commonPresets: ['cf1']
    })
    expect(() =>
      prepareBackupImport(original, file, selectedCommon, 'replace', idFactory())
    ).toThrow('남겨 둔 프리셋')
    expect(original).toEqual(folderLibrary())
  })

  it('strips live preset folders from frozen snapshots and reports legacy-export folder loss', () => {
    const source = folderLibrary()
    const snapshot = normalizeSnapshot({
      common: source.common,
      preset: source.presets[0],
      character: source.characters[0],
      chunks: [source.scenes[0]]
    })
    expect(snapshot.preset).not.toHaveProperty('folderId')
    expect(snapshot.preset.model).toEqual(source.presets[0].model)
    expect(snapshot.preset.loras).toEqual(source.presets[0].loras)
    const exported = exportForScript(source)
    expect(exported.library).not.toHaveProperty('presetFolders')
    expect(exported.library).not.toHaveProperty('commonPresetFolders')
    expect(exported.library.presets[0]).not.toHaveProperty('folderId')
    expect(exported.dropped.keys).toEqual(
      expect.arrayContaining(['presets.folderId', 'presetFolders', 'commonPresetFolders'])
    )
    expect(strictLibrary(exported.library)).toEqual(exported.library)
  })

  it('blocks installing a previous data-epoch release over the new folder format', () => {
    expect(DATA_EPOCH).toBe(11)
    expect(() =>
      assertCompatible(
        {
          format: 1,
          version: '0.1.24',
          dataEpoch: 10,
          minReadableDataEpoch: 1,
          databaseVersion: 19,
          file: 'PixaiClackHelper-0.1.24-setup.exe',
          size: 1,
          sha512: 'unused'
        },
        19
      )
    ).toThrow('현재 자료 형식')
  })
})
