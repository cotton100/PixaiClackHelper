import type { Library, Character, Chunk } from '@shared/pixai/library'
type Kind = 'characters' | 'presets' | 'scenes'

/** Dragging an unchecked item must not silently include a different selection. */
export function materialDragIds(
  items: { id: string }[],
  selectedIds: string[],
  activeId: string
): string[] {
  const selected = new Set(selectedIds.includes(activeId) ? selectedIds : [activeId])
  return items.filter((item) => selected.has(item.id)).map((item) => item.id)
}

/** A folder checkbox affects only the current search results, retaining other selections. */
export function toggleFolderSelection(selectedIds: string[], visibleIds: string[]): string[] {
  const visible = new Set(visibleIds)
  return visibleIds.every((id) => selectedIds.includes(id))
    ? selectedIds.filter((id) => !visible.has(id))
    : [...selectedIds, ...visibleIds.filter((id) => !selectedIds.includes(id))]
}

export function renameMaterialFolder(
  library: Library,
  kind: 'characters' | 'scenes',
  id: string,
  name: string
): Library {
  const key = kind === 'characters' ? 'characterFolders' : 'chunkFolders'
  if (!name.trim()) throw new Error('폴더 이름을 입력해 주세요.')
  if (!(library[key] ?? []).some((folder) => folder.id === id))
    throw new Error('이름을 바꿀 폴더를 확인해 주세요.')
  return {
    ...library,
    [key]: library[key]!.map((folder) =>
      folder.id === id ? { ...folder, name: name.trim() } : folder
    )
  }
}

export function deleteMaterialFolder(
  library: Library,
  kind: 'characters' | 'scenes',
  id: string
): Library {
  if (!id) return library
  const key = kind === 'characters' ? 'characterFolders' : 'chunkFolders'
  return {
    ...library,
    [key]: (library[key] ?? []).filter((folder) => folder.id !== id),
    [kind]: library[kind].map((item) => {
      if (item.folderId !== id) return item
      const next = { ...item }
      delete next.folderId
      return next
    })
  }
}
export function bulkMaterials(
  library: Library,
  kind: Kind,
  ids: string[],
  action: 'move' | 'duplicate' | 'delete',
  folderId = '',
  name = ''
): Library {
  const selected = new Set(ids)
  const current = library[kind]
  if (!current.some((item) => selected.has(item.id))) return library
  if (action === 'delete')
    return { ...library, [kind]: current.filter((item) => !selected.has(item.id)) }
  if (action === 'duplicate')
    return {
      ...library,
      [kind]: [
        ...current,
        ...current
          .filter((item) => selected.has(item.id))
          .map((item) => ({
            ...structuredClone(item),
            id: crypto.randomUUID(),
            name: item.name + ' 사본'
          }))
      ]
    }
  if (kind === 'presets') return library
  const key = kind === 'characters' ? 'characterFolders' : 'chunkFolders'
  let folders = library[key] ?? []
  if (folderId === 'new') {
    if (!name.trim()) throw new Error('새 폴더 이름을 입력해 주세요.')
    folderId = crypto.randomUUID()
    folders = [...folders, { id: folderId, name: name.trim() }]
  }
  if (folderId && !folders.some((folder) => folder.id === folderId))
    throw new Error('이동할 폴더를 확인해 주세요.')
  return {
    ...library,
    [key]: folders,
    [kind]: current.map((item) => {
      if (!selected.has(item.id)) return item
      const next = { ...item } as Character | Chunk
      if (folderId) next.folderId = folderId
      else delete next.folderId
      return next
    })
  }
}
