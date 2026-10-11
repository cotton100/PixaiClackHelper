import type { Library, Character, Chunk } from '@shared/pixai/library'
type Kind = 'characters' | 'presets' | 'scenes'
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
