import { describe, expect, it } from 'vitest'
import { pixaiLibrary } from './fixtures/pixai-workspace'
import {
  backupSelection,
  makeTransferBackup,
  parseTransferBackup
} from '../src/shared/pixai/backup-transfer'
import { expandReservations, makeSettingsBackup } from '../src/shared/pixai/library'
import { expandBatchPlan } from '../src/shared/pixai/batch-reserve'
import { createPixaiStore, emptyWorkspace } from '../src/renderer/src/pixai/store'

const meta = { appVersion: 'test', exportedAt: '2026-10-16T00:00:00.000Z' }

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

async function memoryStore(library = folderLibrary()): Promise<{
  store: ReturnType<typeof createPixaiStore>
  restart: () => Promise<ReturnType<typeof createPixaiStore>>
}> {
  let saved = JSON.stringify({ ...emptyWorkspace(), library })
  const storage = {
    read: async () => saved,
    write: async (value: string) => {
      saved = value
    }
  }
  const restart = async (): Promise<ReturnType<typeof createPixaiStore>> => {
    const next = createPixaiStore(storage)
    await next.getState().hydrate()
    return next
  }
  return { store: await restart(), restart }
}

describe('folder backups through save and restart', () => {
  it('appends a colliding scene folder and preserves edited scene snapshots separately from live chunks', async () => {
    const original = folderLibrary()
    const { store, restart } = await memoryStore(original)
    const source = folderLibrary()
    source.scenes[0].prompt = 'updated live smile'
    source.sceneCards![0].chunks[0].prompt = 'scene-only smile'
    const selection = { ...backupSelection(false), sceneCards: true }
    const file = parseTransferBackup(
      JSON.stringify(
        makeTransferBackup(source, emptyWorkspace().options, selection, meta, {
          sceneCards: ['sf1']
        })
      )
    )
    await store
      .getState()
      .importSelectedBackup(file, selection, 'append', store.getState().revision)
    const restored = (await restart()).getState().workspace.library
    expect(restored).toEqual(store.getState().workspace.library)
    expect(restored.sceneCards!.slice(0, 3)).toEqual(original.sceneCards)
    expect(restored.scenes.slice(0, 3)).toEqual(original.scenes)
    expect(restored.chunkFolders.slice(0, 3)).toEqual(original.chunkFolders)
    expect(restored.sceneFolders!.slice(0, 2)).toEqual(original.sceneFolders)
    const added = restored.sceneCards![3]
    const live = restored.scenes.find((item) => item.id === added.sceneIds[0])!
    expect(added.id).not.toBe('sc1')
    expect(added.folderId).not.toBe('sf1')
    expect(restored.sceneFolders!.find((folder) => folder.id === added.folderId)?.name).toBe(
      '첫 씬'
    )
    expect(live.folderId).not.toBe('f1')
    expect(live.prompt).toBe('updated live smile')
    expect(added.chunks[0].id).toBe(live.id)
    expect(added.chunks[0].prompt).toBe('scene-only smile')
    const expansion = expandBatchPlan(restored, {
      id: 'plan',
      name: '가져온 씬',
      rows: [{ kind: 'character', id: 'c1' }],
      columns: [added.id],
      count: 1,
      exceptions: {},
      order: 'byRow'
    })
    expect(expansion.problems).toEqual([])
    const request = expandReservations({ ...restored, reservations: expansion.reservations })[0]
    expect(request.prompt).toContain('scene-only smile')
    expect(request.prompt).not.toContain('updated live smile')
    expect(original).toEqual(folderLibrary())
  })

  it('replaces only unfiled chunks and selected scene groups, preserving other groups and old reservation text after restart', async () => {
    const original = folderLibrary()
    original.reservations = [
      { id: 'old', presetId: 'p1', characterId: 'c1', sceneIds: ['s3'], count: 2 }
    ]
    const beforePrompts = expandReservations(original).map((request) => request.prompt)
    const { store, restart } = await memoryStore(original)
    const source = folderLibrary()
    source.sceneCards = source.sceneCards!.filter((card) => card.id !== 'sc1')
    source.scenes[2].prompt = 'changed unfiled'
    source.sceneCards[1].chunks[0].prompt = 'changed scene snapshot'
    const selection = { ...backupSelection(false), scenes: true, sceneCards: true }
    const file = parseTransferBackup(
      JSON.stringify(
        makeTransferBackup(source, emptyWorkspace().options, selection, meta, {
          scenes: [''],
          sceneCards: ['sf1', '']
        })
      )
    )
    await store
      .getState()
      .importSelectedBackup(file, selection, 'replace', store.getState().revision)
    const restored = (await restart()).getState().workspace.library
    expect(restored).toEqual(store.getState().workspace.library)
    expect(restored.scenes.slice(0, 2)).toEqual(original.scenes.slice(0, 2))
    expect(restored.scenes[2].prompt).toBe('changed unfiled')
    expect(restored.chunkFolders).toEqual(original.chunkFolders)
    expect(restored.sceneFolders).toHaveLength(2)
    expect(restored.sceneFolders).toContainEqual(original.sceneFolders![0])
    expect(restored.sceneCards!.map((card) => card.id)).toEqual(['sc2', 'sc3'])
    expect(restored.sceneCards![0]).toEqual(original.sceneCards![1])
    expect(restored.sceneCards![1].chunks[0].prompt).toBe('changed scene snapshot')
    expect(restored.reservations[0].snapshot).toBeTruthy()
    expect(expandReservations(restored).map((request) => request.prompt)).toEqual(beforePrompts)
    expect(restored.characters).toEqual(original.characters)
    expect(restored.presets).toEqual(original.presets)
  })

  it('narrows a legacy script backup to one chunk folder, applies it and re-exports a script-compatible full backup', async () => {
    const original = folderLibrary()
    const { store, restart } = await memoryStore(original)
    const source = folderLibrary()
    source.scenes[1].prompt = 'imported wave'
    const legacy = makeSettingsBackup(source, emptyWorkspace().options, meta, 'script')
    const file = parseTransferBackup(JSON.stringify(legacy))
    expect(file.version).toBe(1)
    const selection = { ...backupSelection(false), scenes: true }
    await store
      .getState()
      .importSelectedBackup(file, selection, 'replace', store.getState().revision, {
        scenes: ['f2']
      })
    const restored = (await restart()).getState().workspace
    expect(restored.library.scenes.find((chunk) => chunk.id === 's2')?.prompt).toBe('imported wave')
    expect(restored.library.scenes.find((chunk) => chunk.id === 's1')).toEqual(original.scenes[0])
    expect(restored.library.scenes.find((chunk) => chunk.id === 's3')).toEqual(original.scenes[2])
    expect(restored.library.sceneCards).toEqual(original.sceneCards)
    expect(restored.library.characters).toEqual(original.characters)
    const roundtrip = parseTransferBackup(
      JSON.stringify(makeSettingsBackup(restored.library, restored.options, meta, 'script'))
    )
    expect(roundtrip.backup.library.scenes).toEqual(restored.library.scenes)
    expect(roundtrip.backup.library.chunkFolders).toEqual(restored.library.chunkFolders)
    expect(roundtrip.backup.library.sceneCards ?? []).toEqual([])
    expect(roundtrip.folderSelection).toBeUndefined()
  })
})
