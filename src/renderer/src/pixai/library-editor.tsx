import { deleteCommonPreset, resolvePresetCommon, type CommonPreset } from '@shared/pixai/library'
import { CommonEditor } from './common-editor'
import { MaterialPreview } from './material-preview'
import { bulkMaterials, deleteMaterialFolder, renameMaterialFolder } from './library-actions'
import { useUnsavedNavigation } from './unsaved-navigation'
import { useEffect, useState } from 'react'
import { Copy, FolderPlus, ListChecks, Plus, Trash2 } from 'lucide-react'
import type { Cast, Character, Chunk, Folder, Library, Preset } from '@shared/pixai/library'
import { PromptFields, SortableItem, SortableItems, SplitPanes } from './controls'
import { savePaneUI, type PixaiStore } from './store'
import { ChunkList } from './chunk-list'
import { ModelLinkInput } from './model-link'

type Kind = 'characters' | 'presets' | 'scenes'
type Material = Character | Chunk | Preset
const labels = { characters: '캐릭터', presets: '프리셋', scenes: '청크' }
export function LibraryEditor({ store }: { store: PixaiStore }): React.JSX.Element {
  const { workspace, busy } = store()
  const [kind, setKind] = useState<Kind>('characters')
  const [selected, setSelected] = useState('')
  const [creating, setCreating] = useState<Material | null>(null)
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState('')
  const [foldersOpen, setFoldersOpen] = useState(false)
  const [common, setCommon] = useState(false)
  const [commonId, setCommonId] = useState('')
  const [newCommon, setNewCommon] = useState<CommonPreset | null>(null)
  const commonItem =
    newCommon ?? workspace.library.commonPresets?.find((item) => item.id === commonId)
  if (commonId && !workspace.library.commonPresets?.some((item) => item.id === commonId)) {
    setCommonId('')
  }
  const [selectMode, setSelectMode] = useState(false)
  const [selection, setSelection] = useState<string[]>([])
  const [moveFolder, setMoveFolder] = useState('')
  const [newFolderName, setNewFolderName] = useState('')
  const [bulkDelete, setBulkDelete] = useState(false)
  const guard = useUnsavedNavigation()
  const list = workspace.library[kind]
  const item = creating ?? list.find((entry) => entry.id === selected)
  async function edit(update: (library: Library) => Library): Promise<void> {
    try {
      await store.getState().editLibrary(update)
      setNotice('저장했습니다.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '저장하지 못했습니다.')
      throw error
    }
  }
  async function bulk(action: 'move' | 'duplicate' | 'delete'): Promise<void> {
    await store
      .getState()
      .editLibrary((library) =>
        bulkMaterials(library, kind, selection, action, moveFolder, newFolderName)
      )
    setSelection([])
    setBulkDelete(false)
    setNewFolderName('')
    setSelected('')
    setCreating(null)
  }
  function create(): void {
    if (common) {
      setNewCommon({ id: crypto.randomUUID(), name: '', prompt: '', negativePrompt: '' })
      return
    }
    const id = crypto.randomUUID()
    setCreating(
      kind === 'presets'
        ? {
            id,
            name: '',
            model: { id: '', versionId: '', name: '' },
            loras: [],
            prompt: '',
            negativePrompt: ''
          }
        : { id, name: '', prompt: '', negativePrompt: '' }
    )
    setSelected('')
  }
  return (
    <>
      {guard.dialog}
      <SplitPanes
        name="라이브러리"
        widths={workspace.options.ui?.paneRatios?.library ?? workspace.widths.library}
        collapsed={workspace.options.ui?.collapsedPane?.library}
        labels={['라이브러리', '편집', '맥락']}
        onCollapse={(index) => void savePaneUI(store, 'library', undefined, index).catch(() => {})}
        onSave={(widths) => void savePaneUI(store, 'library', widths).catch(() => {})}
      >
        <section className="px-pane">
          <header>
            <h2>라이브러리</h2>
            <div className="px-library-add-actions px-button-pair">
              <button disabled={busy} onClick={() => guard.request(create)}>
                <Plus size={16} />
                추가
              </button>
              {!common && kind !== 'presets' && (
                <button
                  disabled={busy}
                  aria-expanded={foldersOpen}
                  aria-pressed={foldersOpen}
                  aria-controls="library-folder-tools"
                  onClick={() => setFoldersOpen(!foldersOpen)}
                >
                  <FolderPlus size={16} />
                  폴더 추가
                </button>
              )}
            </div>
          </header>
          <div className="px-subtabs">
            {(['characters', 'presets', 'scenes'] as const).map((id) => (
              <button
                key={id}
                aria-pressed={!common && kind === id}
                onClick={() =>
                  guard.request(() => {
                    setCommon(false)
                    setSelection([])
                    setSelectMode(false)
                    setKind(id)
                    setSelected('')
                    setCreating(null)
                    setSearch('')
                    setFoldersOpen(false)
                  })
                }
              >
                {labels[id]}
              </button>
            ))}
            <button
              aria-pressed={common}
              onClick={() =>
                guard.request(() => {
                  setCommon(true)
                  setSearch('')
                  setSelection([])
                })
              }
            >
              공통문
            </button>
          </div>
          <input
            aria-label="라이브러리 검색"
            placeholder={common ? '공통문 세트 검색' : `${labels[kind]} 검색`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {!common && (
            <div className="px-select-bar" data-active={selectMode}>
              <button
                aria-pressed={selectMode}
                onClick={() => {
                  setSelectMode(!selectMode)
                  setSelection([])
                }}
              >
                <ListChecks size={16} />
                선택 모드
              </button>
              <small>
                {selectMode
                  ? `${selection.length}개 선택 · 이동·복제·삭제 대상`
                  : '항목을 누르면 편집합니다. 여러 개를 옮기거나 지우려면 선택 모드를 켜세요.'}
              </small>
            </div>
          )}
          {!common && selectMode && (
            <div className="px-bulk-tools" aria-label="선택 항목 작업">
              <div className="px-toolbar">
                <button
                  onClick={() =>
                    setSelection(
                      list
                        .filter((item) => item.name.toLowerCase().includes(search.toLowerCase()))
                        .map((item) => item.id)
                    )
                  }
                >
                  목록 전체 선택
                </button>
                <button onClick={() => setSelection([])}>선택 해제</button>
                <span className="px-toolbar-gap" aria-hidden="true" />
                <button
                  disabled={!selection.length || busy}
                  onClick={() => guard.request(() => void bulk('duplicate').catch(() => {}))}
                >
                  <Copy size={14} />
                  선택 복제
                </button>
                <button disabled={!selection.length || busy} onClick={() => setBulkDelete(true)}>
                  <Trash2 size={14} />
                  선택 삭제
                </button>
              </div>
              {kind !== 'presets' && (
                <details className="px-bulk-move">
                  <summary>
                    폴더로 이동 <small>끌어다 놓거나 폴더 머리의 「여기로」를 눌러도 됩니다</small>
                  </summary>
                  <div className="px-inline">
                    <select
                      aria-label="선택 항목 이동 폴더"
                      value={moveFolder}
                      onChange={(event) => setMoveFolder(event.target.value)}
                    >
                      <option value="">미분류</option>
                      {(kind === 'characters'
                        ? (workspace.library.characterFolders ?? [])
                        : workspace.library.chunkFolders
                      ).map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folder.name}
                        </option>
                      ))}
                      <option value="new">새 폴더…</option>
                    </select>
                    {moveFolder === 'new' && (
                      <input
                        aria-label="이동할 새 폴더 이름"
                        placeholder="새 폴더 이름"
                        value={newFolderName}
                        onChange={(event) => setNewFolderName(event.target.value)}
                      />
                    )}
                    <button
                      disabled={
                        !selection.length || busy || (moveFolder === 'new' && !newFolderName.trim())
                      }
                      onClick={() => guard.request(() => void bulk('move').catch(() => {}))}
                    >
                      선택 항목 이동
                    </button>
                  </div>
                </details>
              )}
              {bulkDelete && (
                <div role="alertdialog" aria-label="선택 재료 삭제" className="px-confirm">
                  <p>{selection.length}개를 삭제할까요? 씬·예약 사본은 유지됩니다.</p>
                  <button onClick={() => guard.request(() => void bulk('delete').catch(() => {}))}>
                    선택 삭제 확인
                  </button>
                  <button onClick={() => setBulkDelete(false)}>취소</button>
                </div>
              )}
            </div>
          )}
          {common && (
            <div className="px-scroll" aria-label="공통문 세트 목록">
              {[
                { id: '', name: '기본 공통문', ...workspace.library.common },
                ...(workspace.library.commonPresets ?? [])
              ]
                .filter((entry) => entry.name.toLowerCase().includes(search.toLowerCase()))
                .map((entry) => (
                  <button
                    key={entry.id}
                    className="px-library-item"
                    aria-label={entry.name}
                    aria-pressed={!newCommon && commonId === entry.id}
                    onClick={() =>
                      guard.request(() => {
                        setCommonId(entry.id)
                        setNewCommon(null)
                      })
                    }
                  >
                    <strong>{entry.name}</strong>
                    <MaterialPreview item={entry} library={workspace.library} />
                  </button>
                ))}
            </div>
          )}
          <div className="px-scroll" hidden={common}>
            {kind !== 'presets' && foldersOpen && (
              <div id="library-folder-tools">
                <MaterialFolders key={`folders:${kind}`} store={store} kind={kind} guard={guard} />
              </div>
            )}
            {kind !== 'presets' ? (
              <ChunkList
                key={kind}
                chunks={workspace.library[kind]}
                folders={
                  kind === 'scenes'
                    ? workspace.library.chunkFolders
                    : (workspace.library.characterFolders ?? [])
                }
                label={labels[kind]}
                search={search}
                selectedIds={selectMode ? selection : undefined}
                onSelectionChange={setSelection}
                disabled={busy}
                onRenameFolder={(id, name) =>
                  guard.request(
                    () =>
                      void edit((library) => renameMaterialFolder(library, kind, id, name)).catch(
                        () => {}
                      )
                  )
                }
                onDeleteFolder={(id) =>
                  guard.request(
                    () =>
                      void edit((library) => deleteMaterialFolder(library, kind, id)).catch(
                        () => {}
                      )
                  )
                }
                onReorder={(ids) => {
                  guard.request(
                    () =>
                      void edit((library) => {
                        let at = 0
                        const moved = new Set(ids)
                        const ordered = ids.map((id) =>
                          library[kind].find((chunk) => chunk.id === id)!
                        )
                        return {
                          ...library,
                          [kind]: library[kind].map((chunk) =>
                            moved.has(chunk.id) ? ordered[at++] : chunk
                          )
                        }
                      }).catch(() => {})
                  )
                }}
                onMoveItems={(ids, folderId) =>
                  guard.request(
                    () =>
                      void edit((library) =>
                        bulkMaterials(library, kind, ids, 'move', folderId, '')
                      ).catch(() => {})
                  )
                }
                render={(chunk) => (
                  <div className="px-material-row">
                    {selectMode && (
                      <input
                        type="checkbox"
                        aria-label={chunk.name + ' 일괄 선택'}
                        checked={selection.includes(chunk.id)}
                        onChange={() =>
                          setSelection(
                            selection.includes(chunk.id)
                              ? selection.filter((id) => id !== chunk.id)
                              : [...selection, chunk.id]
                          )
                        }
                      />
                    )}
                    <button
                      className="px-library-item"
                      aria-pressed={selected === chunk.id}
                      onClick={() =>
                        guard.request(() => {
                          setSelected(chunk.id)
                          setCreating(null)
                        })
                      }
                    >
                      <strong>{chunk.name}</strong>
                      <MaterialPreview item={chunk} />
                    </button>
                  </div>
                )}
              />
            ) : (
              <SortableItems
                ids={list.map((entry) => entry.id)}
                onReorder={(ids) => {
                  void edit((library) => ({
                    ...library,
                    [kind]: ids.map((id) => library[kind].find((entry) => entry.id === id)!)
                  })).catch(() => {})
                }}
              >
                {list
                  .filter((entry) => entry.name.toLowerCase().includes(search.toLowerCase()))
                  .map((entry) => (
                    <SortableItem key={entry.id} id={entry.id} name={entry.name}>
                      <div className="px-material-row">
                        {selectMode && (
                          <input
                            type="checkbox"
                            aria-label={entry.name + ' 일괄 선택'}
                            checked={selection.includes(entry.id)}
                            onChange={() =>
                              setSelection(
                                selection.includes(entry.id)
                                  ? selection.filter((id) => id !== entry.id)
                                  : [...selection, entry.id]
                              )
                            }
                          />
                        )}
                        <button
                          className="px-library-item"
                          aria-label={entry.name}
                          aria-pressed={selected === entry.id}
                          onClick={() =>
                            guard.request(() => {
                              setSelected(entry.id)
                              setCreating(null)
                            })
                          }
                        >
                          <strong>{entry.name || `이름 없는 ${labels[kind]}`}</strong>
                          <MaterialPreview item={entry} library={workspace.library} />
                        </button>
                      </div>
                    </SortableItem>
                  ))}
              </SortableItems>
            )}
            {!list.length && (
              <p className="px-empty">
                추가 버튼으로 {labels[kind]}를 만들거나 설정에서 백업을 가져오세요.
              </p>
            )}
          </div>
        </section>
        <section className="px-pane">
          <header>
            <h2>{common ? '공통문' : labels[kind] + ' 편집'}</h2>
          </header>
          {common ? (
            <div className="px-scroll">
              <CommonEditor
                key={commonItem ? `set:${commonItem.id}` : 'default'}
                store={store}
                guard={guard}
                item={commonItem ?? { id: '', name: '기본 공통문', ...workspace.library.common }}
                isNew={!!newCommon}
                onSave={async (value) => {
                  await edit((library) =>
                    value.id
                      ? {
                          ...library,
                          commonPresets: library.commonPresets?.some(
                            (entry) => entry.id === value.id
                          )
                            ? library.commonPresets.map((entry) =>
                                entry.id === value.id ? value : entry
                              )
                            : [...(library.commonPresets ?? []), value]
                        }
                      : {
                          ...library,
                          common: { prompt: value.prompt, negativePrompt: value.negativePrompt }
                        }
                  )
                  setNewCommon(null)
                  setCommonId(value.id)
                }}
                onDuplicate={(value) => {
                  setNewCommon({ ...value, id: crypto.randomUUID(), name: value.name + ' 사본' })
                }}
                onDelete={async () => {
                  await edit((library) => deleteCommonPreset(library, commonId))
                  setCommonId('')
                  setNewCommon(null)
                }}
              />
            </div>
          ) : item ? (
            <MaterialEditor
              key={`${kind}:${item.id}`}
              store={store}
              kind={kind}
              guard={guard}
              item={item}
              isNew={!!creating}
              onSave={async (value, folder) => {
                await edit((library) => ({
                  ...library,
                  ...(folder
                    ? {
                        [kind === 'characters' ? 'characterFolders' : 'chunkFolders']: [
                          ...(kind === 'characters'
                            ? (library.characterFolders ?? [])
                            : library.chunkFolders),
                          folder
                        ]
                      }
                    : {}),
                  [kind]: library[kind].some((entry) => entry.id === value.id)
                    ? library[kind].map((entry) => (entry.id === value.id ? value : entry))
                    : [...library[kind], value]
                }))
                setCreating(null)
                setSelected(value.id)
              }}
              onDelete={async () => {
                await edit((library) => ({
                  ...library,
                  [kind]: library[kind].filter((entry) => entry.id !== item.id)
                }))
                setSelected('')
                setCreating(null)
              }}
              onDuplicate={async () => {
                const latest =
                  store.getState().workspace.library[kind].find((entry) => entry.id === item.id) ??
                  item
                const copy = { ...latest, id: crypto.randomUUID(), name: `${latest.name} 사본` }
                await edit((library) => ({ ...library, [kind]: [...library[kind], copy] }))
                setSelected(copy.id)
              }}
            />
          ) : (
            <p className="px-empty">왼쪽 목록에서 편집할 항목을 고르세요.</p>
          )}
          {notice && <p role="status">{notice}</p>}
        </section>
        <section className="px-pane">
          <header>
            <h2>연결된 자료</h2>
          </header>
          <div className="px-scroll">
            {common ? (
              <>
                <p>
                  모델·LoRA 프리셋 편집에서 이 공통문 세트를 연결하세요. 연결한 세트가 기본 공통문을
                  대신하며, 프리셋 자체의 추가 문구는 함께 적용됩니다.
                </p>
                <h3>{commonItem?.name || '기본 공통문'} 사용 프리셋</h3>
                {workspace.library.presets
                  .filter((preset) => (preset.commonPresetId ?? '') === (commonItem?.id ?? ''))
                  .map((preset) => (
                    <p key={preset.id}>
                      <strong>{preset.name}</strong>
                      <MaterialPreview item={preset} library={workspace.library} />
                    </p>
                  ))}
                <small>등록된 예약은 공통문을 수정하거나 삭제해도 당시 문구를 유지합니다.</small>
              </>
            ) : kind === 'characters' && item && !creating ? (
              <CastEditor key={item.id} store={store} character={item as Character} guard={guard} />
            ) : item ? (
              <MaterialContext kind={kind} item={item} library={workspace.library} />
            ) : (
              <p className="px-empty">재료를 고르면 연결된 자료를 보여 줍니다.</p>
            )}
          </div>
        </section>
      </SplitPanes>
    </>
  )
}

function MaterialEditor({
  store,
  kind,
  item,
  isNew,
  onSave,
  onDelete,
  onDuplicate,
  guard
}: {
  guard: ReturnType<typeof useUnsavedNavigation>
  store: PixaiStore
  kind: Kind
  item: Material
  isNew: boolean
  onSave: (item: Material, folder?: Folder) => Promise<void>
  onDelete: () => Promise<void>
  onDuplicate: () => Promise<void>
}): React.JSX.Element {
  const { workspace, busy } = store()
  const [draft, setDraft] = useState(item)
  const [loraKeys, setLoraKeys] = useState(() =>
    'model' in item ? item.loras.map(() => crypto.randomUUID()) : []
  )
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')
  const [newFolder, setNewFolder] = useState('')
  const [baseline, setBaseline] = useState(item)
  const dirtyCount =
    [...new Set([...Object.keys(draft), ...Object.keys(baseline)])].filter(
      (key) =>
        JSON.stringify(draft[key as keyof Material]) !==
        JSON.stringify(baseline[key as keyof Material])
    ).length + (newFolder ? 1 : 0)
  useEffect(
    () =>
      guard.register(dirtyCount > 0, save, () => {
        setDraft(baseline)
        setNewFolder('')
      }),
    [draft, newFolder, dirtyCount]
  )
  // Reconcile external folder moves only while this editor has no pending edits.
  if (!dirtyCount && JSON.stringify(item) !== JSON.stringify(baseline)) {
    setDraft(item)
    setBaseline(item)
  }
  async function save(): Promise<boolean> {
    try {
      if (!draft.name.trim()) throw new Error('이름을 입력해 주세요.')
      let value = draft
      if (kind !== 'presets' && newFolder.trim()) {
        const folderId = crypto.randomUUID()
        value = { ...draft, folderId } as Chunk
        await onSave(value, { id: folderId, name: newFolder.trim() })
      } else await onSave(value)
      setDraft(value)
      setBaseline(value)
      setNewFolder('')
      setError('')
      return true
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '저장하지 못했습니다.')
      return false
    }
  }
  async function run(action: () => Promise<void>): Promise<void> {
    try {
      await action()
      setError('')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '저장하지 못했습니다.')
    }
  }
  return (
    <>
      <form
        className="px-editor px-editor-layout"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <header>
          <strong>{dirtyCount ? `저장 안 됨 · ${dirtyCount}곳` : '저장됨'}</strong>
        </header>
        <div className="px-scroll">
          <label>
            {labels[kind]} 이름
            <input
              aria-label={`${labels[kind]} 이름`}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          {kind !== 'presets' && (
            <>
              <label>
                {labels[kind]} 폴더
                <select
                  aria-label={`${labels[kind]} 폴더 선택`}
                  value={(draft as Chunk).folderId ?? ''}
                  onChange={(event) => {
                    const next = { ...draft } as Chunk
                    if (event.target.value) next.folderId = event.target.value
                    else delete next.folderId
                    setDraft(next)
                  }}
                >
                  <option value="">미분류</option>
                  {(kind === 'characters'
                    ? (workspace.library.characterFolders ?? [])
                    : workspace.library.chunkFolders
                  ).map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                새 폴더에 저장
                <input
                  aria-label="새 폴더에 저장"
                  value={newFolder}
                  onChange={(event) => setNewFolder(event.target.value)}
                  placeholder="비우면 위 폴더 사용"
                />
              </label>
            </>
          )}
          {'model' in draft ? (
            <>
              <details open>
                <summary>모델</summary>
                <ModelLinkInput
                  label="모델"
                  onApply={(info) =>
                    setDraft({
                      ...draft,
                      name: draft.name || info.name,
                      model: {
                        id: info.id,
                        name: info.name || (draft.model.id === info.id ? draft.model.name : ''),
                        versionId: info.versionId
                      }
                    })
                  }
                />
                <label>
                  모델 이름
                  <input
                    value={draft.model.name}
                    onChange={(event) =>
                      setDraft({ ...draft, model: { ...draft.model, name: event.target.value } })
                    }
                  />
                </label>
                <div className="px-inline">
                  <label>
                    모델 ID
                    <input
                      value={draft.model.id}
                      onChange={(event) =>
                        setDraft({ ...draft, model: { ...draft.model, id: event.target.value } })
                      }
                    />
                  </label>
                  <label>
                    모델 버전 ID
                    <input
                      value={draft.model.versionId}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          model: { ...draft.model, versionId: event.target.value }
                        })
                      }
                    />
                  </label>
                </div>
              </details>
              <details open>
                <summary>LoRA</summary>
                {draft.loras.map((lora, index) => (
                  <fieldset key={loraKeys[index]} className="px-lora">
                    <legend>LoRA {index + 1}</legend>
                    <details>
                      <summary>링크·ID·버전</summary>
                      <ModelLinkInput
                        label={`LoRA ${index + 1}`}
                        onApply={(info) =>
                          setDraft({
                            ...draft,
                            loras: draft.loras.map((entry, i) =>
                              i === index
                                ? {
                                    id: info.id,
                                    versionId: info.versionId,
                                    name: info.name || (entry.id === info.id ? entry.name : ''),
                                    weight: entry.weight,
                                    ...(entry.id === info.id && entry.triggerWords
                                      ? { triggerWords: entry.triggerWords }
                                      : {})
                                  }
                                : entry
                            )
                          })
                        }
                      />
                      {(['id', 'versionId'] as const).map((field) => (
                        <label key={field}>
                          {
                            {
                              name: '이름',
                              id: 'LoRA ID',
                              versionId: '버전 ID',
                              triggerWords: '트리거 문구'
                            }[field]
                          }
                          <input
                            value={lora[field] ?? ''}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                loras: draft.loras.map((entry, i) =>
                                  i === index ? { ...entry, [field]: event.target.value } : entry
                                )
                              })
                            }
                          />
                        </label>
                      ))}
                    </details>
                    <div className="px-lora-row">
                      {(['name', 'triggerWords'] as const).map((field) => (
                        <label key={field}>
                          {field === 'name' ? '이름' : '트리거 문구'}
                          <input
                            value={lora[field] ?? ''}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                loras: draft.loras.map((entry, i) =>
                                  i === index ? { ...entry, [field]: event.target.value } : entry
                                )
                              })
                            }
                          />
                        </label>
                      ))}
                      <label>
                        가중치
                        <input
                          type="number"
                          step="0.05"
                          min={-2}
                          max={2}
                          value={Number.isFinite(lora.weight) ? lora.weight : ''}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              loras: draft.loras.map((entry, i) =>
                                i === index
                                  ? {
                                      ...entry,
                                      weight:
                                        event.target.value === '' ? NaN : Number(event.target.value)
                                    }
                                  : entry
                              )
                            })
                          }
                        />
                      </label>
                    </div>
                    <small>
                      트리거는 모델 설명을 확인해 입력하세요. 링크만으로는 자동 확정하지 않습니다.
                    </small>
                    <button
                      type="button"
                      onClick={() => {
                        setLoraKeys(loraKeys.filter((_, i) => i !== index))
                        setDraft({ ...draft, loras: draft.loras.filter((_, i) => i !== index) })
                      }}
                    >
                      이 LoRA 빼기
                    </button>
                  </fieldset>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setLoraKeys([...loraKeys, crypto.randomUUID()])
                    setDraft({
                      ...draft,
                      loras: [...draft.loras, { id: '', name: '', weight: 0.7 }]
                    })
                  }}
                >
                  LoRA 추가
                </button>
              </details>
              <details open>
                <summary>이 프리셋의 공통 문구</summary>
                <label>
                  연결할 공통문 세트
                  <select
                    aria-label="연결할 공통문 세트"
                    value={draft.commonPresetId ?? ''}
                    onChange={(event) => setDraft({ ...draft, commonPresetId: event.target.value })}
                  >
                    <option value="">기본 공통문 사용</option>
                    {(workspace.library.commonPresets ?? []).map((set) => (
                      <option key={set.id} value={set.id}>
                        {set.name}
                      </option>
                    ))}
                  </select>
                </label>
                {draft.commonPresetId &&
                !workspace.library.commonPresets?.some((set) => set.id === draft.commonPresetId) ? (
                  <p role="alert">연결된 공통문 세트가 없습니다. 다시 골라 주세요.</p>
                ) : (
                  <MaterialPreview item={resolvePresetCommon(workspace.library, draft)} />
                )}
                <small>
                  연결한 세트가 기본 공통문을 대신합니다. 아래 문구는 이 프리셋에만 추가됩니다.
                </small>
                <PromptFields
                  prompt={draft.prompt ?? ''}
                  negativePrompt={draft.negativePrompt ?? ''}
                  labels={{
                    prompt: '이 프리셋의 공통 포지',
                    negativePrompt: '이 프리셋의 공통 네거'
                  }}
                  onChange={(value) => setDraft({ ...draft, ...value })}
                />
                <small>위 공통문과 함께 적용됩니다. 비워 두면 공통문 세트만 사용합니다.</small>
              </details>
            </>
          ) : (
            <>
              <PromptFields
                prompt={draft.prompt}
                negativePrompt={draft.negativePrompt}
                onChange={(value) => setDraft({ ...draft, ...value })}
              />
              {kind === 'characters' && (
                <label>
                  기본 모델·LoRA 프리셋
                  <select
                    aria-label="기본 모델·LoRA 프리셋"
                    value={(draft as Character).defaultPresetId ?? ''}
                    onChange={(event) =>
                      setDraft({ ...draft, defaultPresetId: event.target.value })
                    }
                  >
                    <option value="">미지정 (구성마다 선택)</option>
                    {workspace.library.presets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
        </div>
        <footer>
          <div className="px-toolbar">
            <button className="px-primary" disabled={busy}>
              재료 저장
            </button>
            <button
              type="button"
              disabled={!dirtyCount}
              onClick={() => {
                setDraft(baseline)
                setNewFolder('')
              }}
            >
              되돌리기
            </button>
            {!isNew && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => guard.request(() => void run(onDuplicate))}
                >
                  <Copy size={15} />
                  복제
                </button>
                <button type="button" onClick={() => setConfirmDelete(!confirmDelete)}>
                  <Trash2 size={15} />
                  삭제
                </button>
              </>
            )}
          </div>
          {error && (
            <p className="px-error" role="alert">
              {error}
            </p>
          )}
          {confirmDelete && (
            <div className="px-confirm">
              <p>이 재료를 삭제할까요? 씬·예약의 저장된 사본은 남고 연결은 끊어집니다.</p>
              <button type="button" disabled={busy} onClick={() => void run(onDelete)}>
                재료 삭제 확인
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)}>
                취소
              </button>
            </div>
          )}
          <small>다른 항목으로 이동하면 저장 여부를 묻습니다.</small>
        </footer>
      </form>
    </>
  )
}

function CastEditor({
  store,
  character,
  guard
}: {
  store: PixaiStore
  character: Character
  guard: ReturnType<typeof useUnsavedNavigation>
}): React.JSX.Element {
  const { workspace, busy } = store()
  const blank = (): Cast => ({
    id: crypto.randomUUID(),
    name: `${character.name} · `,
    characterId: character.id,
    presetId: character.defaultPresetId ?? '',
    extra: { prompt: '', negativePrompt: '' }
  })
  const [draft, setDraft] = useState<Cast | null>(null)
  const [removeCast, setRemoveCast] = useState(false)
  const [castBaseline, setCastBaseline] = useState<Cast | null>(null)
  const castDirty = !!draft && JSON.stringify(draft) !== JSON.stringify(castBaseline)
  const [error, setError] = useState('')
  async function saveCast(): Promise<boolean> {
    try {
      if (!draft) return true
      if (!draft.name.trim()) throw new Error('출연 이름을 입력해 주세요.')
      await store.getState().editLibrary((library) => ({
        ...library,
        casts: library.casts?.some((cast) => cast.id === draft.id)
          ? library.casts.map((cast) => (cast.id === draft.id ? draft : cast))
          : [...(library.casts ?? []), draft]
      }))
      setDraft(null)
      setError('')
      return true
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '출연을 저장하지 못했습니다.')
      return false
    }
  }
  useEffect(() => guard.register(castDirty, saveCast, () => setDraft(null)), [draft, castDirty])
  return (
    <div className="px-casts">
      <p>출연은 이 캐릭터에 프리셋·복장 등 추가 문구를 연결한 구성입니다.</p>
      <header>
        <h3>{character.name}의 저장 출연</h3>
        <button
          onClick={() =>
            guard.request(() => {
              setRemoveCast(false)
              setCastBaseline(null)
              setDraft(blank())
            })
          }
        >
          출연으로 저장
        </button>
      </header>
      {workspace.library.casts
        ?.filter((cast) => cast.characterId === character.id)
        .map((cast) => (
          <button
            className="px-library-item"
            key={cast.id}
            onClick={() =>
              guard.request(() => {
                setRemoveCast(false)
                setCastBaseline(cast)
                setDraft(structuredClone(cast))
              })
            }
          >
            <strong>{cast.name}</strong>
            <small>
              {workspace.library.presets.find((preset) => preset.id === cast.presetId)?.name ??
                '프리셋 연결 끊김'}
            </small>
          </button>
        ))}
      {draft && (
        <form
          className="px-editor"
          onSubmit={(event) => {
            event.preventDefault()
            void saveCast()
          }}
        >
          <label>
            출연 이름
            <input
              aria-label="출연 이름"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <label>
            출연 프리셋
            <select
              aria-label="출연 프리셋"
              value={draft.presetId}
              onChange={(event) => setDraft({ ...draft, presetId: event.target.value })}
            >
              <option value="">프리셋 선택</option>
              {workspace.library.presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </label>
          <PromptFields
            {...(draft.extra ?? { prompt: '', negativePrompt: '' })}
            onChange={(extra) => setDraft({ ...draft, extra })}
          />
          <label>
            트리거 위치
            <select
              value={draft.triggerPosition ?? ''}
              onChange={(event) => {
                const next = { ...draft }
                if (!event.target.value) delete next.triggerPosition
                else
                  next.triggerPosition =
                    event.target.value === 'end' ? 'end' : Number(event.target.value)
                setDraft(next)
              }}
            >
              <option value="">씬 설정 / 기본값</option>
              <option value={0}>맨 앞</option>
              <option value={1}>공통문 뒤</option>
              <option value={2}>캐릭터 뒤</option>
              <option value="end">맨 뒤</option>
            </select>
          </label>
          <div className="px-toolbar">
            <button disabled={busy} className="px-primary">
              출연 저장
            </button>
            <button type="button" onClick={() => guard.request(() => setDraft(null))}>
              취소
            </button>
          </div>
          {castBaseline && (
            <button type="button" disabled={busy} onClick={() => setRemoveCast(true)}>
              출연 삭제
            </button>
          )}
          {removeCast && (
            <div role="alertdialog" aria-label="출연 삭제 확인" className="px-confirm">
              <p>이 출연을 삭제할까요? 기존 예약 사본은 유지됩니다.</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void store
                    .getState()
                    .editLibrary((library) => ({
                      ...library,
                      casts: library.casts?.filter((cast) => cast.id !== draft.id)
                    }))
                    .then(() => {
                      setDraft(null)
                      setRemoveCast(false)
                    })
                    .catch(() => setError('출연을 삭제하지 못했습니다.'))
                }}
              >
                출연 삭제 확인
              </button>
              <button type="button" onClick={() => setRemoveCast(false)}>
                취소
              </button>
            </div>
          )}
          {error && <p className="px-error">{error}</p>}
        </form>
      )}
    </div>
  )
}

function MaterialFolders({
  store,
  kind,
  guard
}: {
  store: PixaiStore
  kind: 'characters' | 'scenes'
  guard: ReturnType<typeof useUnsavedNavigation>
}): React.JSX.Element {
  const { workspace, busy } = store()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const key = kind === 'characters' ? 'characterFolders' : 'chunkFolders'
  const folders = workspace.library[key] ?? []
  return (
    <div className="px-folders">
      <h3>{labels[kind]} 폴더</h3>
      <form
        className="px-inline"
        onSubmit={(event) => {
          event.preventDefault()
          if (name.trim() && !busy)
            guard.request(
              () =>
                void store
                  .getState()
                  .editLibrary((library) => ({
                    ...library,
                    [key]: [...(library[key] ?? []), { id: crypto.randomUUID(), name: name.trim() }]
                  }))
                  .then(() => {
                    setName('')
                    setError('')
                  })
                  .catch((failure) =>
                    setError(
                      failure instanceof Error ? failure.message : '폴더를 만들지 못했습니다.'
                    )
                  )
            )
        }}
      >
        <input
          aria-label={`새 ${labels[kind]} 폴더 이름`}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button disabled={busy || !name.trim()}>폴더 만들기</button>
      </form>
      {error && <p role="alert">{error}</p>}
      <SortableItems
        ids={folders.map((folder) => folder.id)}
        onReorder={(ids) => {
          guard.request(
            () =>
              void store
                .getState()
                .editLibrary((library) => ({
                  ...library,
                  [key]: ids.map((id) => library[key]!.find((folder) => folder.id === id)!)
                }))
                .catch((failure) =>
                  setError(
                    failure instanceof Error ? failure.message : '순서를 저장하지 못했습니다.'
                  )
                )
          )
        }}
      >
        {folders.map((folder) => (
          <SortableItem id={folder.id} key={folder.id} name={folder.name} disabled={busy}>
            <span>{folder.name}</span>
          </SortableItem>
        ))}
      </SortableItems>
    </div>
  )
}

function MaterialContext({
  kind,
  item,
  library
}: {
  kind: Kind
  item: Material
  library: Library
}): React.JSX.Element {
  if (kind === 'presets') {
    const preset = item as Preset
    const uses = [
      ...library.characters.filter((c) => c.defaultPresetId === item.id),
      ...(library.casts ?? []).filter((c) => c.presetId === item.id)
    ]
    return (
      <>
        <h3>이 프리셋을 쓰는 곳</h3>
        {uses.length ? (
          uses.map((use) => <p key={use.id}>{use.name}</p>)
        ) : (
          <p>기본 프리셋으로 연결된 자료 없음</p>
        )}
        <h3>합쳐질 공통 포지</h3>
        <p className="px-preview-text">
          {[resolvePresetCommon(library, preset).prompt, preset.prompt]
            .filter(Boolean)
            .join(', ') || '(비어 있음)'}
        </p>
        <h3>합쳐질 공통 네거</h3>
        <p className="px-preview-text">
          {[resolvePresetCommon(library, preset).negativePrompt, preset.negativePrompt]
            .filter(Boolean)
            .join(', ') || '(비어 있음)'}
        </p>
      </>
    )
  }
  const cards = library.sceneCards?.filter((card) => card.sceneIds.includes(item.id)) ?? []
  return (
    <>
      <h3>이 청크를 쓰는 씬</h3>
      {cards.length ? cards.map((card) => <p key={card.id}>{card.name}</p>) : <p>연결된 씬 없음</p>}
      <small>원본을 수정해도 씬·예약의 저장된 사본은 유지됩니다.</small>
    </>
  )
}
