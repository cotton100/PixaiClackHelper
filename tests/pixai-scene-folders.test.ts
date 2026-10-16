import { describe, expect, it } from 'vitest'
import { type BatchPlan, type Library } from '../src/shared/pixai/library'
import { expandBatchPlan } from '../src/shared/pixai/batch-reserve'
import {
  draggedSceneIds,
  moveSceneCards,
  removeSceneFolder,
  renameSceneFolder,
  selectSceneColumns,
  selectSceneRows
} from '../src/renderer/src/pixai/scene-actions'
import { pixaiLibrary } from './fixtures/pixai-workspace'

function plan(): BatchPlan {
  return {
    id: 'plan',
    name: 'Saved order',
    rows: [{ kind: 'character', id: 'c1' }],
    columns: ['sc3', 'sc1'],
    count: 2,
    exceptions: { 'character:c1|sc1': 0 },
    order: 'byColumn'
  }
}

function fixture(): Library {
  const library = pixaiLibrary()
  library.sceneFolders = [
    { id: 'f1', name: '첫 그룹' },
    { id: 'f2', name: '다음 그룹' }
  ]
  library.sceneCards![0].folderId = 'f1'
  library.sceneCards![1].folderId = 'f1'
  library.sceneCards![2].folderId = 'f2'
  library.batchPlans = [plan()]
  library.reservations = expandBatchPlan(library, plan(), {
    batchId: 'frozen',
    now: 1,
    batchSize: 1,
    idFactory: () => 'r1'
  }).reservations
  return library
}

describe('scene folder operations', () => {
  it('selects a folder once after existing columns and only deselects its matching cards', () => {
    const original = plan()
    const selected = selectSceneColumns(original, ['sc1', 'sc2', 'sc2'], true)
    expect(selected.columns).toEqual(['sc3', 'sc1', 'sc2'])
    expect(selectSceneColumns(selected, ['sc1', 'sc2'], false).columns).toEqual(['sc3'])
    expect(selectSceneColumns(selected, ['sc1'], false).columns).toEqual(['sc3', 'sc2'])
    expect(selected.exceptions).toBe(original.exceptions)
    expect(selected.rows).toBe(original.rows)
    expect(original.columns).toEqual(['sc3', 'sc1'])
  })

  it('keeps row preset overrides and selection order during folder selection', () => {
    const original = { ...plan(), rows: [{ kind: 'character' as const, id: 'c2', presetId: 'p2' }] }
    const rows = [
      { kind: 'character' as const, id: 'c1' },
      { kind: 'character' as const, id: 'c2' }
    ]
    const selected = selectSceneRows(original, rows, ['character:c1', 'character:c2'])
    expect(selected.rows).toEqual([original.rows[0], rows[0]])
    expect(selectSceneRows(selected, rows, ['character:c1']).rows).toEqual([rows[0]])
  })

  it('moves the selected set from a selected handle and a single unselected card otherwise', () => {
    const library = fixture()
    expect(draggedSceneIds('sc1', ['sc3', 'missing', 'sc1', 'sc1'], library.sceneCards!)).toEqual([
      'sc3',
      'sc1'
    ])
    expect(draggedSceneIds('sc2', ['sc3', 'sc1'], library.sceneCards!)).toEqual(['sc2'])
    expect(draggedSceneIds('missing', ['sc1'], library.sceneCards!)).toEqual([])
    const before = structuredClone(library)
    const moved = moveSceneCards(library, ['sc3', 'sc1'], 'f2')
    expect(moved.sceneCards!.map((card) => [card.id, card.folderId])).toEqual([
      ['sc1', 'f2'],
      ['sc2', 'f1'],
      ['sc3', 'f2']
    ])
    expect(moved.sceneCards![0].chunks).toBe(library.sceneCards![0].chunks)
    expect(moved.sceneCards![1]).toBe(library.sceneCards![1])
    expect(moved.sceneCards![2]).toBe(library.sceneCards![2])
    expect(moved.reservations).toBe(library.reservations)
    expect(moved.batchPlans).toBe(library.batchPlans)
    expect(library).toEqual(before)
    expect(
      expandBatchPlan(moved, plan(), {
        batchId: 'frozen',
        now: 1,
        batchSize: 1,
        idFactory: () => 'r1'
      })
    ).toEqual(
      expandBatchPlan(library, plan(), {
        batchId: 'frozen',
        now: 1,
        batchSize: 1,
        idFactory: () => 'r1'
      })
    )
  })

  it('renames a folder and removes only its grouping, preserving scenes and reservations', () => {
    const library = fixture()
    const renamed = renameSceneFolder(library, 'f1', '  새 이름  ')
    expect(renamed.sceneFolders).toEqual([{ id: 'f1', name: '새 이름' }, library.sceneFolders![1]])
    expect(renamed.sceneCards).toBe(library.sceneCards)
    const removed = removeSceneFolder(renamed, 'f1')
    expect(removed.sceneFolders).toEqual([library.sceneFolders![1]])
    expect(removed.sceneCards).toEqual(
      library.sceneCards!.map((card) => {
        const next = { ...card }
        if (next.folderId === 'f1') delete next.folderId
        return next
      })
    )
    expect(removed.reservations).toBe(library.reservations)
    expect(removed.batchPlans).toBe(library.batchPlans)
    expect(removed.scenes).toBe(library.scenes)
  })

  it('rejects stale folder targets and empty renames before changing cards', () => {
    const library = fixture()
    const before = structuredClone(library)
    expect(() => moveSceneCards(library, ['sc1'], 'gone')).toThrow('이동할 씬 그룹이 없습니다')
    expect(() => renameSceneFolder(library, 'f1', ' ')).toThrow('이름을 입력')
    expect(() => removeSceneFolder(library, '')).toThrow('삭제할 씬 그룹이 없습니다')
    expect(() => removeSceneFolder(library, 'gone')).toThrow('삭제할 씬 그룹이 없습니다')
    expect(library).toEqual(before)
  })
})
