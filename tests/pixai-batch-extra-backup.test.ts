import { describe, expect, it } from 'vitest'
import { pixaiLibrary } from './fixtures/pixai-workspace'
import {
  backupSelection,
  makeTransferBackup,
  parseTransferBackup,
  prepareBackupImport,
  selectBackupLibrary,
  type BackupSelection
} from '../src/shared/pixai/backup-transfer'
import { expandBatchPlan } from '../src/shared/pixai/batch-reserve'
import { expandReservations, type BatchPlan, type Library } from '../src/shared/pixai/library'
import { emptyWorkspace } from '../src/renderer/src/pixai/store'

const options = emptyWorkspace().options
const meta = { appVersion: 'test', exportedAt: '2026-10-26T00:00:00.000Z' }
const select = (...keys: Array<keyof BackupSelection>): BackupSelection => ({
  ...backupSelection(false),
  ...Object.fromEntries(keys.map((key) => [key, true]))
})
const ids = (): (() => string) => {
  let next = 0
  return () => `imported-${++next}`
}

function sourceLibrary(): Library {
  const library = pixaiLibrary()
  library.chunkFolders = [
    { id: 'scene-folder', name: '씬 청크' },
    { id: 'extra-folder', name: '추가 청크' },
    { id: 'unrelated-folder', name: '다른 폴더' }
  ]
  library.scenes[0].folderId = 'scene-folder'
  library.scenes[1].folderId = 'unrelated-folder'
  library.scenes[2].folderId = 'extra-folder'
  library.scenes[2].negativePrompt = 'extra negative'
  const plan: BatchPlan = {
    id: 'plan',
    name: '추가 청크 구성',
    rows: [{ kind: 'character', id: 'c1' }],
    columns: ['sc1'],
    count: 1,
    exceptions: {},
    order: 'byRow',
    extraChunkIds: ['s3', 's1'],
    promptOrder: ['extraChunks', 'scene', 'character']
  }
  library.batchPlans = [plan]
  library.reservations = expandBatchPlan(library, plan, {
    idFactory: () => 'reservation'
  }).reservations
  return library
}

const prompts = (library: Library): Array<[string, string]> =>
  expandReservations(library).map((request) => [request.prompt, request.negativePrompt])

describe('batch additional chunks in selective backups', () => {
  it('includes extra chunks and their folders when only the saved plan is selected', () => {
    const source = sourceLibrary()
    const selection = select('batchPlans')
    const selected = selectBackupLibrary(source, selection)
    expect(selected.library.scenes.map((chunk) => chunk.id)).toEqual(['s1', 's3'])
    expect(selected.library.chunkFolders.map((folder) => folder.id)).toEqual([
      'scene-folder',
      'extra-folder'
    ])
    expect(selected.dependencies.scenes).toBe(2)
    expect(selected.library.reservations).toEqual([])
    const file = makeTransferBackup(source, options, selection, meta)
    expect(parseTransferBackup(JSON.stringify(file)).backup.library.batchPlans).toEqual(
      source.batchPlans
    )
    const plan = file.backup.library.batchPlans![0]
    const expanded = expandBatchPlan(file.backup.library, plan)
    expect(expanded.problems.filter((problem) => problem.level === 'error')).toEqual([])
    expect(prompts({ ...file.backup.library, reservations: expanded.reservations })).toEqual(
      prompts(source)
    )
  })

  it('remaps plan and frozen additional chunk IDs together without changing the composed text', () => {
    const source = sourceLibrary()
    const selection = select('batchPlans', 'reservations')
    const result = prepareBackupImport(
      source,
      makeTransferBackup(source, options, selection, meta),
      selection,
      'append',
      ids()
    ).library
    expect(result.batchPlans![0]).toEqual(source.batchPlans![0])
    expect(result.reservations[0]).toEqual(source.reservations[0])
    const plan = result.batchPlans![1]
    const reservation = result.reservations[1]
    const snapshot = reservation.snapshot!
    expect(plan.extraChunkIds).toEqual(snapshot.extraChunks!.map((chunk) => chunk.id))
    expect(plan.extraChunkIds).not.toEqual(source.batchPlans![0].extraChunkIds)
    expect(snapshot.extraChunks![1].id).toBe(snapshot.chunks[0].id)
    expect(snapshot.extraChunks!.every((chunk) => chunk.folderId === undefined)).toBe(true)
    expect(plan.promptOrder).toEqual(source.batchPlans![0].promptOrder)
    expect(prompts(result)).toEqual([...prompts(source), ...prompts(source)])
    const expanded = expandBatchPlan(result, plan)
    expect(expanded.problems.filter((problem) => problem.level === 'error')).toEqual([])
    expect(prompts({ ...result, reservations: expanded.reservations })).toEqual(prompts(source))
  })

  it('includes live extra dependencies for reservation-only backups while preserving the frozen copy', () => {
    const source = sourceLibrary()
    const before = prompts(source)
    source.scenes[2].prompt = 'new live text'
    const selection = select('reservations')
    const file = makeTransferBackup(source, options, selection, meta)
    expect(file.backup.library.scenes.map((chunk) => chunk.id)).toEqual(['s1', 's3'])
    expect(file.backup.library.scenes.find((chunk) => chunk.id === 's3')?.prompt).toBe(
      'new live text'
    )
    expect(file.backup.library.reservations[0].snapshot!.extraChunks![0].prompt).toBe('angry')
    expect(prompts(file.backup.library)).toEqual(before)
  })

  it('keeps deleted extra materials in snapshots and does not bind them to matching live IDs on import', () => {
    const source = sourceLibrary()
    const before = prompts(source)
    source.scenes = source.scenes.filter((chunk) => chunk.id !== 's3')
    const selection = select('reservations')
    const file = makeTransferBackup(source, options, selection, meta)
    expect(file.backup.library.scenes.some((chunk) => chunk.id === 's3')).toBe(false)
    const current = pixaiLibrary()
    current.scenes[2].prompt = 'unrelated current text'
    const result = prepareBackupImport(current, file, selection, 'append', ids()).library
    const frozenExtra = result.reservations[0].snapshot!.extraChunks![0]
    expect(frozenExtra.id).not.toBe('s3')
    expect(result.scenes.some((chunk) => chunk.id === frozenExtra.id)).toBe(false)
    expect(result.scenes.find((chunk) => chunk.id === 's3')?.prompt).toBe('unrelated current text')
    expect(prompts(result)).toEqual(before)
  })

  it('preserves queued reservation snapshots when replacing the selected extra chunk folder', () => {
    const current = sourceLibrary()
    const before = prompts(current)
    const source = sourceLibrary()
    source.scenes[2].prompt = 'replacement prompt'
    source.scenes[2].negativePrompt = 'replacement negative'
    const selection = select('scenes')
    const file = makeTransferBackup(source, options, selection, meta, { scenes: ['extra-folder'] })
    const result = prepareBackupImport(current, file, selection, 'replace', ids()).library
    expect(result.scenes.find((chunk) => chunk.id === 's3')?.prompt).toBe('replacement prompt')
    expect(result.reservations).toEqual(current.reservations)
    expect(result.batchPlans).toEqual(current.batchPlans)
    expect(prompts(result)).toEqual(before)
    const newReservations = expandBatchPlan(result, result.batchPlans![0]).reservations
    const next = prompts({ ...result, reservations: newReservations })[0]
    expect(next[0]).toContain('replacement prompt')
    expect(next[1]).toContain('replacement negative')
    expect(next[0]).not.toContain('angry')
  })
})
