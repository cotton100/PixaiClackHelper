import { useDroppable } from '@dnd-kit/core'
import { Children, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderInput, Pencil, Trash2 } from 'lucide-react'
import type { Chunk, Folder as ChunkFolder } from '@shared/pixai/library'
import { SortableItem, SortableItems } from './controls'
import { materialDragIds, toggleFolderSelection } from './library-actions'
import './library-folders.css'

export function ChunkList<T extends Pick<Chunk, 'id' | 'name' | 'folderId'>>({
  chunks,
  folders,
  search = '',
  render,
  onReorder,
  onMove,
  onMoveItems,
  selectedIds,
  onSelectionChange,
  onRenameFolder,
  onDeleteFolder,
  disabled = false,
  label = '청크'
}: {
  chunks: T[]
  folders: ChunkFolder[]
  search?: string
  render: (chunk: T) => ReactNode
  onReorder?: (ids: string[]) => void
  onMove?: (id: string, folder: string) => void
  onMoveItems?: (ids: string[], folder: string) => void
  selectedIds?: string[]
  onSelectionChange?: (ids: string[]) => void
  onRenameFolder?: (id: string, name: string) => void
  onDeleteFolder?: (id: string) => void
  disabled?: boolean
  label?: string
}): React.JSX.Element {
  const [opened, setOpened] = useState<string[]>([])
  const [renaming, setRenaming] = useState<string | null>(null)
  const [folderName, setFolderName] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const canMove = !!onMoveItems || !!onMove
  const selectable = selectedIds !== undefined && !!onSelectionChange
  const folderIds = new Set(folders.map((folder) => folder.id))
  const folderOf = (chunk: T): string =>
    chunk.folderId && folderIds.has(chunk.folderId) ? chunk.folderId : ''
  function move(activeId: string, folderId: string): void {
    if (disabled) return
    if (onMoveItems) onMoveItems(materialDragIds(chunks, selectedIds ?? [], activeId), folderId)
    else onMove?.(activeId, folderId)
  }
  const content = (
    <div className="px-chunk-groups">
      {selectable && (
        <small className="px-folder-selection-help" data-scoped={!!search}>
          {search
            ? '폴더 체크는 검색에 맞는 항목만 선택합니다. 다른 선택은 유지됩니다.'
            : '폴더 체크 = 접힌 항목까지 함께 선택'}
        </small>
      )}
      {[...folders, { id: '', name: '미분류' }].map((folder) => {
        const all = chunks.filter((chunk) => folderOf(chunk) === folder.id)
        const visible = all.filter((chunk) =>
          chunk.name.toLowerCase().includes(search.toLowerCase())
        )
        if (!canMove && ((search && !visible.length) || (!folder.id && !all.length))) return null
        const open = !!search || opened.includes(folder.id)
        return (
          <FolderDrop
            id={folder.id}
            className="px-chunk-group"
            key={folder.id}
            aria-label={`${label} 폴더 ${folder.name}`}
          >
            <div className="px-folder-heading-row">
              {selectable && (
                <FolderSelection
                  name={`${label} 폴더 ${folder.name} 선택`}
                  ids={visible.map((chunk) => chunk.id)}
                  selectedIds={selectedIds}
                  disabled={disabled}
                  onChange={() =>
                    onSelectionChange(
                      toggleFolderSelection(
                        selectedIds,
                        visible.map((chunk) => chunk.id)
                      )
                    )
                  }
                />
              )}
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
                <small>{search ? `${visible.length}/${all.length}` : all.length}</small>
              </button>
              {onMoveItems && !!selectedIds?.length && (
                <button
                  type="button"
                  className="px-folder-action px-folder-move-selection"
                  disabled={disabled}
                  aria-label={`선택 ${selectedIds.length}개를 ${folder.name} 폴더로 이동`}
                  title={`선택한 ${selectedIds.length}개를 이 폴더로 이동 (끌어다 놓아도 됩니다)`}
                  onClick={() => {
                    onMoveItems(
                      chunks
                        .filter((chunk) => selectedIds.includes(chunk.id))
                        .map((chunk) => chunk.id),
                      folder.id
                    )
                  }}
                >
                  <FolderInput size={15} />
                  여기로
                </button>
              )}
              {folder.id && (onRenameFolder || onDeleteFolder) && (
                <span className="px-folder-tools">
                  {onRenameFolder && (
                    <button
                      type="button"
                      className="px-folder-action"
                      aria-label={`${label} 폴더 ${folder.name} 이름 변경`}
                      title="폴더 이름 변경"
                      disabled={disabled}
                      onClick={() => {
                        setRenaming(folder.id)
                        setFolderName(folder.name)
                        setDeleting(null)
                      }}
                    >
                      <Pencil size={15} />
                    </button>
                  )}
                  {onDeleteFolder && (
                    <button
                      type="button"
                      className="px-folder-action"
                      aria-label={`${label} 폴더 ${folder.name} 삭제`}
                      title="폴더 삭제 · 내용은 미분류로 이동"
                      disabled={disabled}
                      onClick={() => {
                        setDeleting(folder.id)
                        setRenaming(null)
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </span>
              )}
            </div>
            {renaming === folder.id && onRenameFolder && (
              <form
                className="px-folder-rename"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!folderName.trim() || disabled) return
                  onRenameFolder(folder.id, folderName.trim())
                  setRenaming(null)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setRenaming(null)
                }}
              >
                <input
                  autoFocus
                  aria-label={`${label} 폴더 새 이름`}
                  value={folderName}
                  onChange={(event) => setFolderName(event.target.value)}
                />
                <button disabled={!folderName.trim() || disabled}>이름 저장</button>
                <button type="button" onClick={() => setRenaming(null)}>
                  취소
                </button>
              </form>
            )}
            {deleting === folder.id && onDeleteFolder && (
              <div
                className="px-confirm"
                role="alertdialog"
                aria-label={`${label} 폴더 삭제 확인`}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setDeleting(null)
                }}
              >
                <p>
                  “{folder.name}” 폴더만 삭제할까요? 안의 {all.length}개 {label}는 미분류로
                  옮깁니다.
                </p>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    onDeleteFolder(folder.id)
                    setDeleting(null)
                  }}
                >
                  폴더만 삭제
                </button>
                <button type="button" onClick={() => setDeleting(null)}>
                  취소
                </button>
              </div>
            )}
            {open && (
              <div className="px-folder-content">
                {onReorder ? (
                  <>
                    {visible.map((chunk) => (
                      <SortableItem
                        key={chunk.id}
                        id={chunk.id}
                        name={chunk.name}
                        disabled={disabled}
                      >
                        {render(chunk)}
                      </SortableItem>
                    ))}
                  </>
                ) : (
                  visible.map((chunk) => <div key={chunk.id}>{render(chunk)}</div>)
                )}
                {!all.length && <small>아직 {label}가 없습니다.</small>}
                {!!all.length && !visible.length && <small>검색에 맞는 항목이 없습니다.</small>}
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
      onReorder={(ids) => {
        if (!disabled) onReorder(ids)
      }}
      dragLabel={(id) => `${materialDragIds(chunks, selectedIds ?? [], id).length}개 ${label} 이동`}
      onDrop={(id, target) => {
        if (disabled) return true
        if (!canMove) return false
        if (target.startsWith('folder:')) {
          move(id, target.slice(7))
          return true
        }
        const source = chunks.find((chunk) => chunk.id === id),
          destination = chunks.find((chunk) => chunk.id === target)
        if (
          source &&
          destination &&
          (folderOf(source) !== folderOf(destination) ||
            (selectedIds?.includes(id) && selectedIds.length > 1))
        ) {
          move(id, folderOf(destination))
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

function FolderSelection({
  name,
  ids,
  selectedIds,
  disabled,
  onChange
}: {
  name: string
  ids: string[]
  selectedIds: string[]
  disabled: boolean
  onChange: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  const count = ids.filter((id) => selectedIds.includes(id)).length
  const mixed = count > 0 && count < ids.length
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed
  }, [mixed])
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={name}
      aria-checked={mixed ? 'mixed' : !!ids.length && count === ids.length}
      title={`${ids.length}개 항목 선택`}
      checked={!!ids.length && count === ids.length}
      disabled={disabled || !ids.length}
      onChange={onChange}
    />
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
