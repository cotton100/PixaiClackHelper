import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Folder } from 'lucide-react'
import type { Chunk, Folder as ChunkFolder } from '@shared/pixai/library'
import { SortableItem, SortableItems } from './controls'

export function ChunkList<T extends Chunk>({
  chunks,
  folders,
  search = '',
  render,
  onReorder,
  label = '청크'
}: {
  chunks: T[]
  folders: ChunkFolder[]
  search?: string
  render: (chunk: T) => ReactNode
  onReorder?: (ids: string[]) => void
  label?: string
}): React.JSX.Element {
  const [opened, setOpened] = useState<string[]>([])
  return (
    <div className="px-chunk-groups">
      {[...folders, { id: '', name: '미분류' }].map((folder) => {
        const all = chunks.filter((chunk) => (chunk.folderId ?? '') === folder.id)
        const visible = all.filter((chunk) =>
          chunk.name.toLowerCase().includes(search.toLowerCase())
        )
        if ((search && !visible.length) || (!folder.id && !all.length)) return null
        const open = !!search || opened.includes(folder.id)
        return (
          <section
            className="px-chunk-group"
            key={folder.id}
            aria-label={`${label} 폴더 ${folder.name}`}
          >
            <button
              type="button"
              className="px-folder-heading"
              aria-expanded={open}
              aria-label={`${label} 폴더 ${folder.name}`}
              onClick={() =>
                setOpened(open ? opened.filter((id) => id !== folder.id) : [...opened, folder.id])
              }
            >
              {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <Folder size={17} />
              <strong>{folder.name}</strong>
              <small>{all.length}</small>
            </button>
            {open && (
              <div className="px-folder-content">
                {onReorder ? (
                  <SortableItems ids={all.map((chunk) => chunk.id)} onReorder={onReorder}>
                    {visible.map((chunk) => (
                      <SortableItem key={chunk.id} id={chunk.id} name={chunk.name}>
                        {render(chunk)}
                      </SortableItem>
                    ))}
                  </SortableItems>
                ) : (
                  visible.map((chunk) => <div key={chunk.id}>{render(chunk)}</div>)
                )}
                {!all.length && <small>아직 {label}가 없습니다.</small>}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
