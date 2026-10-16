import {
  batchRowKey,
  type BatchPlan,
  type BatchRow,
  type Library,
  type SceneCard
} from '@shared/pixai/library'

/** Append new selections in list order without changing the existing generation order. */
export function selectSceneColumns(plan: BatchPlan, ids: string[], selected: boolean): BatchPlan {
  const targets = new Set(ids)
  return {
    ...plan,
    columns: selected
      ? [...new Set([...plan.columns, ...ids])]
      : plan.columns.filter((id) => !targets.has(id))
  }
}

export function selectSceneRows(plan: BatchPlan, rows: BatchRow[], ids: string[]): BatchPlan {
  const selected = new Set(ids)
  const kept = plan.rows.filter((row) => selected.has(batchRowKey(row)))
  const keptIds = new Set(kept.map(batchRowKey))
  return {
    ...plan,
    rows: [
      ...kept,
      ...rows.filter((row) => selected.has(batchRowKey(row)) && !keptIds.has(batchRowKey(row)))
    ]
  }
}

export function draggedSceneIds(
  activeId: string,
  selectedIds: string[],
  cards: SceneCard[]
): string[] {
  const existing = new Set(cards.map((card) => card.id))
  if (!existing.has(activeId)) return []
  return [...new Set(selectedIds.includes(activeId) ? selectedIds : [activeId])].filter((id) =>
    existing.has(id)
  )
}

/** Folder changes only affect live cards. Saved plans and frozen reservations retain their identity. */
export function moveSceneCards(library: Library, ids: string[], folderId: string): Library {
  if (folderId && !library.sceneFolders?.some((folder) => folder.id === folderId)) {
    throw new Error('이동할 씬 그룹이 없습니다. 목록을 다시 확인해 주세요.')
  }
  const selected = new Set(ids)
  return {
    ...library,
    sceneCards: library.sceneCards?.map((card) => {
      if (!selected.has(card.id) || (card.folderId ?? '') === folderId) return card
      const next = { ...card }
      if (folderId) next.folderId = folderId
      else delete next.folderId
      return next
    })
  }
}

export function renameSceneFolder(library: Library, id: string, name: string): Library {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('씬 그룹 이름을 입력해 주세요.')
  if (!library.sceneFolders?.some((folder) => folder.id === id)) {
    throw new Error('이름을 바꿀 씬 그룹이 없습니다.')
  }
  return {
    ...library,
    sceneFolders: library.sceneFolders.map((folder) =>
      folder.id === id ? { ...folder, name: trimmed } : folder
    )
  }
}

export function removeSceneFolder(library: Library, id: string): Library {
  if (!id || !library.sceneFolders?.some((folder) => folder.id === id)) {
    throw new Error('삭제할 씬 그룹이 없습니다.')
  }
  const moved = moveSceneCards(
    library,
    (library.sceneCards ?? []).filter((card) => card.folderId === id).map((card) => card.id),
    ''
  )
  return { ...moved, sceneFolders: library.sceneFolders.filter((folder) => folder.id !== id) }
}
