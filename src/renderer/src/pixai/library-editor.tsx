import { useState } from 'react'
import { Copy, Plus, Trash2 } from 'lucide-react'
import type { Cast, Character, Chunk, Folder, Library, Preset } from '@shared/pixai/library'
import { PromptFields, SortableItem, SortableItems, SplitPanes } from './controls'
import type { PixaiStore } from './store'
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
  function create(): void {
    const id = crypto.randomUUID()
    setCreating(
      kind === 'presets'
        ? { id, name: '', model: { id: '', versionId: '', name: '' }, loras: [] }
        : { id, name: '', prompt: '', negativePrompt: '' }
    )
    setSelected('')
  }
  return (
    <SplitPanes
      name="라이브러리"
      widths={workspace.widths.library}
      onSave={(widths) => {
        void store
          .getState()
          .commit((current) => ({ ...current, widths: { ...current.widths, library: widths } }))
          .catch(() => {})
      }}
    >
      <section className="px-pane">
        <header>
          <h2>라이브러리</h2>
          <button disabled={busy} onClick={create}>
            <Plus size={16} />
            추가
          </button>
        </header>
        <div className="px-subtabs">
          {(['characters', 'presets', 'scenes'] as const).map((id) => (
            <button
              key={id}
              aria-pressed={kind === id}
              onClick={() => {
                setKind(id)
                setSelected('')
                setCreating(null)
                setSearch('')
              }}
            >
              {labels[id]}
            </button>
          ))}
        </div>
        <input
          aria-label="라이브러리 검색"
          placeholder={`${labels[kind]} 검색`}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="px-scroll">
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
              onReorder={(ids) => {
                void edit((library) => {
                  let at = 0
                  const moved = new Set(ids)
                  const ordered = ids.map((id) => library[kind].find((chunk) => chunk.id === id)!)
                  return {
                    ...library,
                    [kind]: library[kind].map((chunk) =>
                      moved.has(chunk.id) ? ordered[at++] : chunk
                    )
                  }
                }).catch(() => {})
              }}
              render={(chunk) => (
                <button
                  className="px-library-item"
                  aria-pressed={selected === chunk.id}
                  onClick={() => {
                    setSelected(chunk.id)
                    setCreating(null)
                  }}
                >
                  <strong>{chunk.name}</strong>
                  <small>{chunk.prompt || '문구 없음'}</small>
                </button>
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
                    <button
                      className="px-library-item"
                      aria-pressed={selected === entry.id}
                      onClick={() => {
                        setSelected(entry.id)
                        setCreating(null)
                      }}
                    >
                      <strong>{entry.name || `이름 없는 ${labels[kind]}`}</strong>
                      <small>
                        {'model' in entry
                          ? `${entry.model.name} · LoRA ${entry.loras.length}`
                          : 'folderId' in entry
                            ? (workspace.library.chunkFolders.find(
                                (folder) => folder.id === entry.folderId
                              )?.name ?? '미분류')
                            : '프롬프트 편집'}
                      </small>
                    </button>
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
          <h2>{labels[kind]} 편집</h2>
        </header>
        {item ? (
          <MaterialEditor
            key={`${kind}:${item.id}`}
            store={store}
            kind={kind}
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
              const copy = { ...item, id: crypto.randomUUID(), name: `${item.name} 사본` }
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
          <h2>공통문·폴더</h2>
        </header>
        <CommonEditor store={store} />
        {kind !== 'presets' && <MaterialFolders key={kind} store={store} kind={kind} />}
      </section>
    </SplitPanes>
  )
}

function MaterialEditor({
  store,
  kind,
  item,
  isNew,
  onSave,
  onDelete,
  onDuplicate
}: {
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
        className="px-editor"
        onSubmit={(event) => {
          event.preventDefault()
          void run(async () => {
            if (!draft.name.trim()) throw new Error('이름을 입력해 주세요.')
            if (kind !== 'presets' && newFolder.trim()) {
              const folderId = crypto.randomUUID()
              await onSave(
                { ...(draft as Chunk), folderId },
                { id: folderId, name: newFolder.trim() }
              )
              setDraft({ ...draft, folderId } as Chunk)
              setNewFolder('')
            } else await onSave(draft)
          })
        }}
      >
        <label>
          {labels[kind]} 이름
          <input
            aria-label={`${labels[kind]} 이름`}
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </label>
        {'model' in draft ? (
          <>
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
                    setDraft({ ...draft, model: { ...draft.model, versionId: event.target.value } })
                  }
                />
              </label>
            </div>
            <h3>LoRA</h3>
            {draft.loras.map((lora, index) => (
              <fieldset key={loraKeys[index]} className="px-lora">
                <legend>LoRA {index + 1}</legend>
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
                {(['name', 'id', 'versionId', 'triggerWords'] as const).map((field) => (
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
                                weight: event.target.value === '' ? NaN : Number(event.target.value)
                              }
                            : entry
                        )
                      })
                    }
                  />
                </label>
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
                setDraft({ ...draft, loras: [...draft.loras, { id: '', name: '', weight: 0.7 }] })
              }}
            >
              LoRA 추가
            </button>
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
                  onChange={(event) => setDraft({ ...draft, defaultPresetId: event.target.value })}
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
          </>
        )}
        <div className="px-toolbar">
          <button className="px-primary" disabled={busy}>
            재료 저장
          </button>
          {!isNew && (
            <>
              <button type="button" disabled={busy} onClick={() => void run(onDuplicate)}>
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
      </form>
      {kind === 'characters' && !isNew && (
        <CastEditor store={store} character={item as Character} />
      )}
    </>
  )
}

function CastEditor({
  store,
  character
}: {
  store: PixaiStore
  character: Character
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
  const [error, setError] = useState('')
  return (
    <div className="px-casts">
      <header>
        <h3>저장 출연</h3>
        <button onClick={() => setDraft(blank())}>출연으로 저장</button>
      </header>
      {workspace.library.casts
        ?.filter((cast) => cast.characterId === character.id)
        .map((cast) => (
          <button
            className="px-library-item"
            key={cast.id}
            onClick={() => setDraft(structuredClone(cast))}
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
            void (async () => {
              try {
                if (!draft.name.trim()) throw new Error('출연 이름을 입력해 주세요.')
                await store.getState().editLibrary((library) => ({
                  ...library,
                  casts: library.casts?.some((cast) => cast.id === draft.id)
                    ? library.casts.map((cast) => (cast.id === draft.id ? draft : cast))
                    : [...(library.casts ?? []), draft]
                }))
                setDraft(null)
                setError('')
              } catch (failure) {
                setError(failure instanceof Error ? failure.message : '출연을 저장하지 못했습니다.')
              }
            })()
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
            <button type="button" onClick={() => setDraft(null)}>
              취소
            </button>
          </div>
          {error && <p className="px-error">{error}</p>}
        </form>
      )}
    </div>
  )
}

function CommonEditor({ store }: { store: PixaiStore }): React.JSX.Element {
  const { workspace, busy } = store()
  const [value, setValue] = useState(workspace.library.common)
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void store
          .getState()
          .editLibrary((library) => ({ ...library, common: value }))
          .catch(() => {})
      }}
    >
      <PromptFields {...value} onChange={setValue} />
      <button disabled={busy}>공통문 저장</button>
    </form>
  )
}

function MaterialFolders({
  store,
  kind
}: {
  store: PixaiStore
  kind: 'characters' | 'scenes'
}): React.JSX.Element {
  const { workspace, busy } = store()
  const [name, setName] = useState('')
  const key = kind === 'characters' ? 'characterFolders' : 'chunkFolders'
  const folders = workspace.library[key] ?? []
  return (
    <div className="px-folders">
      <h3>{labels[kind]} 폴더</h3>
      <form
        className="px-inline"
        onSubmit={(event) => {
          event.preventDefault()
          if (name.trim())
            void store
              .getState()
              .editLibrary((library) => ({
                ...library,
                [key]: [...(library[key] ?? []), { id: crypto.randomUUID(), name: name.trim() }]
              }))
              .then(() => setName(''))
              .catch(() => {})
        }}
      >
        <input
          aria-label={`새 ${labels[kind]} 폴더 이름`}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button disabled={busy}>폴더 추가</button>
      </form>
      <SortableItems
        ids={folders.map((folder) => folder.id)}
        onReorder={(ids) => {
          void store
            .getState()
            .editLibrary((library) => ({
              ...library,
              [key]: ids.map((id) => library[key]!.find((folder) => folder.id === id)!)
            }))
            .catch(() => {})
        }}
      >
        {folders.map((folder) => (
          <SortableItem id={folder.id} key={folder.id} name={folder.name}>
            <span>{folder.name}</span>
          </SortableItem>
        ))}
      </SortableItems>
    </div>
  )
}
