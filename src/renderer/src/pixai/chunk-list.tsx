import { useDroppable } from '@dnd-kit/core'
import { Children, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Folder } from 'lucide-react'
import type { Chunk, Folder as ChunkFolder } from '@shared/pixai/library'
import { SortableItem, SortableItems } from './controls'

export function ChunkList<T extends Pick<Chunk, 'id' | 'name' | 'folderId'>>({
  chunks,
  folders,
  search = '',
  render,
  onReorder,
  onMove,
  label = '청크'
}: {
  chunks: T[]
  folders: ChunkFolder[]
  search?: string
  render: (chunk: T) => ReactNode
  onReorder?: (ids: string[]) => void
  onMove?: (id: string, folder: string) => void
  label?: string
}): React.JSX.Element {
  const [opened, setOpened] = useState<string[]>([])
  const content = (
    <div className="px-chunk-groups">
      {[...folders, { id: '', name: '미분류' }].map((folder) => {
        const all = chunks.filter((chunk) => (chunk.folderId ?? '') === folder.id)
        const visible = all.filter((chunk) =>
          chunk.name.toLowerCase().includes(search.toLowerCase())
        )
        if ((search && !visible.length) || (!folder.id && !all.length)) return null
        const open = !!search || opened.includes(folder.id)
        return (
          <FolderDrop
            id={folder.id}
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
                  <>
                    {visible.map((chunk) => (
                      <SortableItem key={chunk.id} id={chunk.id} name={chunk.name}>
                        {render(chunk)}
                      </SortableItem>
                    ))}
                  </>
                ) : (
                  visible.map((chunk) => <div key={chunk.id}>{render(chunk)}</div>)
                )}
                {!all.length && <small>아직 {label}가 없습니다.</small>}
              </div>
            )}
          </FolderDrop>
        )
      })}
    </div>
  )
  return onReorder ? (
    <SortableItems
      ids={chunks.map((chunk) => chunk.id)}
      onReorder={onReorder}
      onDrop={(id, target) => {
        if (!onMove) return false
        if (target.startsWith('folder:')) {
          onMove(id, target.slice(7))
          return true
        }
        const source = chunks.find((chunk) => chunk.id === id),
          destination = chunks.find((chunk) => chunk.id === target)
        if (source && destination && source.folderId !== destination.folderId) {
          onMove(id, destination.folderId ?? '')
          return true
        }
        return false
      }}
    >
      {content}
    </SortableItems>
  ) : (
    content
  )
}
function FolderDrop({
  id,
  children,
  ...props
}: {
  id: string
  children: ReactNode
  className: string
  'aria-label': string
}): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: 'folder:' + id })
  return (
    <section {...props}>
      <div ref={setNodeRef} className={isOver ? 'px-drop-target' : undefined}>
        {Children.toArray(children)[0]}
      </div>
      {Children.toArray(children).slice(1)}
    </section>
  )
}
