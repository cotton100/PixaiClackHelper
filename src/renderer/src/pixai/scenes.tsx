import { useUnsavedNavigation } from './unsaved-navigation'
import { RatioMark } from './ratio-mark'
import { useEffect, useState } from 'react'
import { SceneThumbnailView } from './scene-thumbnails'
import { useSceneThumbnails } from './use-scene-thumbnails'
import { Copy, FolderPlus, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import {
  batchCellKey,
  batchRowKey,
  normalizeBatchPlan,
  type BatchPlan,
  type BatchRow,
  type SceneCard,
  type Folder,
  stripFolder
} from '@shared/pixai/library'
import {
  defaultBatchName,
  expandBatchPlan,
  refreshSceneCard,
  resolveBatchRow
} from '@shared/pixai/batch-reserve'
import {
  ImagePicker,
  ImageSummary,
  StageChips,
  PromptFields,
  SortableItem,
  SortableItems,
  SplitPanes
} from './controls'
import { savePaneUI, type PixaiStore } from './store'
import { ChunkList } from './chunk-list'
import { resolveImageOptions } from '@shared/pixai/generation-options'

const newPlan = (): BatchPlan => ({
  id: crypto.randomUUID(),
  name: '',
  rows: [],
  columns: [],
  count: 1,
  exceptions: {},
  order: 'byRow'
})
export function Scenes({
  store,
  onOpen,
  initialEditId
}: {
  store: PixaiStore
  onOpen: (card: SceneCard) => void
  initialEditId?: string
}): React.JSX.Element {
  const thumbnails = useSceneThumbnails()
  const guard = useUnsavedNavigation()
  const sceneView = store().workspace.options.ui?.sceneView ?? 'grid'
  function setSceneView(sceneView: 'grid' | 'list'): void {
    void store
      .getState()
      .commit((current) => ({
        ...current,
        options: { ...current.options, ui: { ...current.options.ui, sceneView } }
      }))
      .catch(() => {})
  }
  const { workspace, busy } = store()
  const { library, options } = workspace
  const [plan, setPlan] = useState<BatchPlan>(newPlan)
  const [createdAt] = useState(Date.now)
  const [rowSearch, setRowSearch] = useState('')
  const [search, setSearch] = useState('')
  const [folder, setFolder] = useState('all')
  const [editorTab, setEditorTab] = useState('chunks')
  const [editId, setEditId] = useState(initialEditId ?? '')
  const [creating, setCreating] = useState<SceneCard | null>(null)
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [refresh, setRefresh] = useState<
    (ReturnType<typeof refreshSceneCard> & { revision: number }) | null
  >(null)
  const [planId, setPlanId] = useState('')
  const [folderName, setFolderName] = useState('')
  const [showFolder, setShowFolder] = useState(false)
  const [removeId, setRemoveId] = useState('')
  const cards = library.sceneCards ?? []
  const rows: BatchRow[] = [
    ...library.characters.map((character): BatchRow => ({ kind: 'character', id: character.id })),
    ...(library.casts ?? []).map((cast): BatchRow => ({ kind: 'cast', id: cast.id }))
  ]
  const orderedRows = [
    ...plan.rows,
    ...rows.filter(
      (row) => !plan.rows.some((selected) => batchRowKey(row) === batchRowKey(selected))
    )
  ]
  const rowItems = orderedRows.map((row) => {
    const resolved = resolveBatchRow(library, row)
    return {
      id: batchRowKey(row),
      name: resolved.name,
      folderId: library.characters.find((character) => character.id === resolved.characterId)
        ?.folderId,
      row,
      resolved
    }
  })
  const visibleRows = rowItems
    .filter((item) => item.name.toLowerCase().includes(rowSearch.toLowerCase()))
    .map((item) => item.row)
  const visibleCards = cards.filter(
    (card) =>
      card.name.toLowerCase().includes(search.toLowerCase()) &&
      (folder === 'all' || (card.folderId ?? '') === folder)
  )
  const orderedCards = [
    ...plan.columns
      .map((id) => cards.find((card) => card.id === id))
      .filter((card): card is SceneCard => !!card && visibleCards.includes(card)),
    ...visibleCards.filter((card) => !plan.columns.includes(card.id))
  ]
  const automaticName = defaultBatchName(plan.rows.length, plan.columns.length, createdAt)
  const preview = (() => {
    try {
      return {
        expansion: expandBatchPlan(library, plan, {
          batchSize: options.imageCount,
          batchId: 'preview',
          now: createdAt,
          idFactory: () => 'preview'
        }),
        error: ''
      }
    } catch (error) {
      return {
        expansion: null,
        error: error instanceof Error ? error.message : '수량을 확인해 주세요.'
      }
    }
  })()
  const totals = preview.expansion?.totals
  if (totals && preview.expansion)
    totals.images = preview.expansion.reservations.reduce(
      (sum, reservation) =>
        sum +
        reservation.count *
          resolveImageOptions(reservation.imageOptions, options, plan.imageOptions).batchSize!,
      0
    )
  const activeExceptions = Object.entries(plan.exceptions).filter(([key]) =>
    plan.rows.some((row) => plan.columns.some((id) => key === batchCellKey(batchRowKey(row), id)))
  )
  const batchCounts = new Map<number, number>()
  for (const reservation of preview.expansion?.reservations ?? []) {
    const size = resolveImageOptions(
      reservation.imageOptions,
      options,
      plan.imageOptions
    ).batchSize!
    batchCounts.set(size, (batchCounts.get(size) ?? 0) + reservation.count)
  }
  const totalJobs =
    workspace.jobs.length +
    library.reservations.reduce((sum, item) => sum + item.count, 0) +
    (totals?.jobs ?? 0)
  function toggleRow(row: BatchRow): void {
    const key = batchRowKey(row)
    setPlan({
      ...plan,
      rows: plan.rows.some((item) => batchRowKey(item) === key)
        ? plan.rows.filter((item) => batchRowKey(item) !== key)
        : [...plan.rows, row]
    })
  }
  function toggleColumn(id: string): void {
    setPlan({
      ...plan,
      columns: plan.columns.includes(id)
        ? plan.columns.filter((item) => item !== id)
        : [...plan.columns, id]
    })
  }
  async function run(action: () => Promise<unknown>, message = ''): Promise<void> {
    try {
      await action()
      if (message) setNotice(message)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '저장하지 못했습니다.')
    }
  }
  function saveCard(card: SceneCard, newFolder?: Folder): Promise<void> {
    return store.getState().editLibrary((current) => ({
      ...current,
      ...(newFolder ? { sceneFolders: [...(current.sceneFolders ?? []), newFolder] } : {}),
      sceneCards: (current.sceneCards ?? []).some((item) => item.id === card.id)
        ? current.sceneCards!.map((item) => (item.id === card.id ? card : item))
        : [...(current.sceneCards ?? []), card]
    }))
  }
  async function reserve(register = false): Promise<void> {
    if (saving || busy) return
    setSaving(true)
    setNotice('')
    try {
      const result = await store.getState().reserve(plan, register)
      setNotice(
        register
          ? '예약 후 로컬 대기열에 등록했습니다. 유료 생성은 대기열에서 시작하세요.'
          : `${result.totals.pairs}조합 ${result.totals.jobs}작업을 예약했습니다 · 묶음 「${result.batch.name}」. 조합 예약 탭에서 대기열에 등록하세요.`
      )
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '예약하지 못했습니다.')
    } finally {
      setSaving(false)
    }
  }
  const renderRow = ({ id: key, row, resolved }: (typeof rowItems)[number]): React.JSX.Element => {
    const selected = plan.rows.some((item) => batchRowKey(item) === key)
    const preset = library.presets.find((item) => item.id === resolved.presetId)
    const content = (
      <div className={`px-choice ${selected ? 'is-selected' : ''}`}>
        <label className="px-check">
          <input
            type="checkbox"
            aria-label={`행 ${resolved.name}`}
            checked={selected}
            onChange={() => toggleRow(row)}
          />
          <span>
            <strong>{resolved.name}</strong>
            <small>
              {row.kind === 'cast' ? '저장 출연' : '캐릭터'}
              {selected
                ? ` · ${plan.rows.findIndex((item) => batchRowKey(item) === key) + 1}번째`
                : ''}
            </small>
          </span>
        </label>
        {preset ? (
          <small>{preset.name}</small>
        ) : row.kind === 'character' ? (
          <select
            aria-label={`${resolved.name} 이번 구성 프리셋`}
            value={row.presetId ?? ''}
            onChange={(event) => {
              const next = { ...row, presetId: event.target.value }
              setPlan({
                ...plan,
                rows: selected
                  ? plan.rows.map((item) => (batchRowKey(item) === key ? next : item))
                  : [...plan.rows, next]
              })
            }}
          >
            <option value="">프리셋 선택</option>
            {library.presets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        ) : (
          <small className="px-error">프리셋 연결을 확인해 주세요.</small>
        )}
      </div>
    )
    return selected ? (
      <SortableItem key={key} id={key} name={resolved.name}>
        {content}
      </SortableItem>
    ) : (
      <div key={key}>{content}</div>
    )
  }
  return (
    <>
      {guard.dialog}
      <SplitPanes
        name="씬"
        widths={workspace.options.ui?.paneRatios?.scenes ?? workspace.widths.scenes}
        collapsed={
          (creating || editId) && workspace.options.ui?.collapsedPane?.scenes === 2
            ? 0
            : workspace.options.ui?.collapsedPane?.scenes
        }
        labels={['누구', '어떤 장면', '수량·편집']}
        onCollapse={(index) => void savePaneUI(store, 'scenes', undefined, index).catch(() => {})}
        onSave={(widths) => void savePaneUI(store, 'scenes', widths).catch(() => {})}
      >
        <section className="px-pane" aria-label="누구">
          <header>
            <h2>1. 캐릭터 선택</h2>
            <span>{plan.rows.length}명 선택</span>
          </header>
          <input
            aria-label="캐릭터·출연 검색"
            placeholder="캐릭터·출연 검색"
            value={rowSearch}
            onChange={(event) => setRowSearch(event.target.value)}
          />
          <div className="px-toolbar">
            <button
              onClick={() =>
                setPlan({
                  ...plan,
                  rows: [
                    ...plan.rows,
                    ...visibleRows.filter(
                      (row) => !plan.rows.some((item) => batchRowKey(item) === batchRowKey(row))
                    )
                  ]
                })
              }
            >
              행 전체 선택
            </button>
            <button onClick={() => setPlan({ ...plan, rows: [] })}>행 선택 해제</button>
            <small>현재 목록 {visibleRows.length}개</small>
          </div>
          <div className="px-scroll">
            <SortableItems
              ids={plan.rows.map(batchRowKey)}
              onReorder={(ids) =>
                setPlan({
                  ...plan,
                  rows: ids.map((key) => plan.rows.find((row) => batchRowKey(row) === key)!)
                })
              }
            >
              {!!plan.rows.length && (
                <div className="px-selected-rows">
                  <h3>선택 순서 · 끌어서 변경</h3>
                  {plan.rows.map((row) => {
                    const item = rowItems.find((item) => item.id === batchRowKey(row))
                    return item ? <div key={item.id}>{renderRow(item)}</div> : null
                  })}
                </div>
              )}
              <ChunkList
                chunks={rowItems}
                folders={library.characterFolders ?? []}
                label="캐릭터"
                search={rowSearch}
                render={(item) =>
                  plan.rows.some((row) => batchRowKey(row) === item.id) ? null : renderRow(item)
                }
              />
            </SortableItems>
            {!rows.length && (
              <p className="px-empty">라이브러리에서 캐릭터와 기본 프리셋을 먼저 저장해 주세요.</p>
            )}
          </div>
          <small>
            체크한 순서대로 순회합니다. 선택한 행의 손잡이를 끌어 순서를 바꿀 수 있습니다.
          </small>
        </section>
        <section className="px-pane" aria-label="어떤 장면">
          <header>
            <h2>2. 씬 선택</h2>
            <span>{plan.columns.length}씬 선택</span>
          </header>
          <small
            className="px-scene-help"
            title="씬은 표정·행동 청크와 문구를 묶은 장면입니다. 체크하면 각 캐릭터마다 별도 생성합니다."
          >
            캐릭터 × 씬, 쌍마다 별도 생성
          </small>
          <div className="px-scene-tools">
            <button
              className="px-primary"
              disabled={busy}
              onClick={() =>
                guard.request(() => {
                  setEditorTab('chunks')
                  setCreating({
                    id: crypto.randomUUID(),
                    name: '',
                    sceneIds: [],
                    chunks: [],
                    ...(folder !== 'all' && folder ? { folderId: folder } : {})
                  })
                  setEditId('')
                  setRefresh(null)
                })
              }
            >
              <Plus size={16} />새 씬 만들기
            </button>{' '}
            <div className="px-toolbar" aria-label="씬 보기 방식">
              <button aria-pressed={sceneView === 'grid'} onClick={() => setSceneView('grid')}>
                격자
              </button>
              <button aria-pressed={sceneView === 'list'} onClick={() => setSceneView('list')}>
                목록
              </button>
            </div>
          </div>
          <div className="px-inline">
            <input
              aria-label="씬 검색"
              placeholder="씬 검색"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button aria-label="새 씬 그룹" onClick={() => setShowFolder(!showFolder)}>
              <FolderPlus size={18} />
              그룹 만들기
            </button>
          </div>
          <div className="px-group-chips" aria-label="씬 그룹 필터">
            {[
              { id: 'all', name: '모든 씬 그룹' },
              ...(library.sceneFolders ?? []),
              { id: '', name: '미분류' }
            ].map((group) => (
              <button
                key={group.id}
                aria-pressed={folder === group.id}
                onClick={() => setFolder(group.id)}
              >
                {group.name}{' '}
                <small>
                  {
                    cards.filter((card) => group.id === 'all' || (card.folderId ?? '') === group.id)
                      .length
                  }
                </small>
              </button>
            ))}
          </div>
          {showFolder && (
            <form
              className="px-inline"
              onSubmit={(event) => {
                event.preventDefault()
                if (!folderName.trim()) return
                void run(async () => {
                  const id = crypto.randomUUID()
                  await store.getState().editLibrary((current) => ({
                    ...current,
                    sceneFolders: [...(current.sceneFolders ?? []), { id, name: folderName.trim() }]
                  }))
                  setFolderName('')
                  setShowFolder(false)
                })
              }}
            >
              <input
                aria-label="새 씬 그룹 이름"
                value={folderName}
                onChange={(event) => setFolderName(event.target.value)}
              />
              <button disabled={busy}>만들기</button>
            </form>
          )}
          <div className="px-toolbar">
            <button
              onClick={() =>
                setPlan({
                  ...plan,
                  columns: [...new Set([...plan.columns, ...visibleCards.map((card) => card.id)])]
                })
              }
            >
              씬 전체 선택
            </button>
            <button onClick={() => setPlan({ ...plan, columns: [] })}>씬 선택 해제</button>
            <small>현재 목록 {visibleCards.length}개</small>
          </div>
          <div className="px-scroll">
            <div className={'px-scene-collection is-' + sceneView}>
              <SortableItems
                grid={sceneView === 'grid'}
                ids={plan.columns}
                onReorder={(columns) => setPlan({ ...plan, columns })}
              >
                {orderedCards.map((card) => {
                  const selected = plan.columns.includes(card.id)
                  const content = (
                    <article className={`px-scene-card ${selected ? 'is-selected' : ''}`}>
                      <SceneThumbnailView
                        name={card.name}
                        image={thumbnails.images.find((image) => image.sceneId === card.id)}
                        error={thumbnails.error}
                      />
                      <small className="px-group-name">
                        {library.sceneFolders?.find((group) => group.id === card.folderId)?.name ??
                          '미분류'}{' '}
                        · {card.chunks.length ? `${card.chunks.length}청크` : '직접 문구'}
                      </small>
                      <label className="px-check">
                        <input
                          type="checkbox"
                          aria-label={`씬 ${card.name}`}
                          checked={selected}
                          onChange={() => toggleColumn(card.id)}
                        />
                        <strong>
                          {selected ? `${plan.columns.indexOf(card.id) + 1}. ` : ''}
                          {card.name}
                        </strong>
                      </label>
                      {card.sceneIds.some(
                        (id) => !library.scenes.some((chunk) => chunk.id === id)
                      ) && <small className="px-warning">청크 연결 끊김 · 사본 유지</small>}
                      <small>
                        {card.imageOptions ? (
                          <>
                            <RatioMark ratio={card.imageOptions.aspectRatio} /> ·{' '}
                            {card.imageOptions.size}
                          </>
                        ) : (
                          '구성 공통값 따름'
                        )}
                      </small>
                      <details className="px-card-menu">
                        <summary aria-label={card.name + ' 메뉴'}>
                          ⋯ <span className="px-visually-hidden">작업</span>
                        </summary>
                        <div
                          className="px-menu-items"
                          onClick={(event) => {
                            if ((event.target as HTMLElement).closest('button'))
                              event.currentTarget.closest('details')?.removeAttribute('open')
                          }}
                        >
                          <button onClick={() => onOpen(card)}>조합으로 열기</button>
                          <button
                            aria-label={`${card.name} 편집`}
                            onClick={() => {
                              setRefresh(null)
                              guard.request(() => {
                                setCreating(null)
                                setEditId(card.id)
                                setEditorTab('chunks')
                              })
                            }}
                          >
                            <Pencil size={15} />
                            편집
                          </button>
                          <button
                            aria-label={`${card.name} 복제`}
                            disabled={busy}
                            onClick={() =>
                              void run(
                                () =>
                                  store.getState().editLibrary((current) => ({
                                    ...current,
                                    sceneCards: [
                                      ...(current.sceneCards ?? []),
                                      {
                                        ...card,
                                        id: crypto.randomUUID(),
                                        name: `${card.name} 사본`
                                      }
                                    ]
                                  })),
                                '씬을 복제했습니다.'
                              )
                            }
                          >
                            <Copy size={15} />
                            복제
                          </button>
                          <button
                            aria-label={`${card.name} 최신 청크로 갱신`}
                            onClick={() => {
                              setRefresh({
                                ...refreshSceneCard(library, card.id),
                                revision: store.getState().revision
                              })
                              // Refresh affects the saved card, never the active draft.
                            }}
                          >
                            <RefreshCw size={15} />
                            최신 청크로 갱신
                          </button>
                          <button
                            aria-label={`${card.name} 삭제`}
                            onClick={() => setRemoveId(card.id)}
                          >
                            <Trash2 size={15} />
                            삭제
                          </button>
                          <button
                            onClick={() =>
                              guard.request(() => {
                                setCreating(null)
                                setEditId(card.id)
                                setEditorTab('group')
                              })
                            }
                          >
                            그룹 이동
                          </button>
                        </div>
                      </details>
                      {removeId === card.id && (
                        <div className="px-confirm">
                          <p>이 씬을 삭제할까요? 기존 예약 사본은 유지됩니다.</p>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await store.getState().editLibrary((current) => ({
                                  ...current,
                                  sceneCards: current.sceneCards?.filter(
                                    (item) => item.id !== card.id
                                  )
                                }))
                                setRemoveId('')
                                setPlan({
                                  ...plan,
                                  columns: plan.columns.filter((id) => id !== card.id)
                                })
                              })
                            }
                          >
                            씬 삭제 확인
                          </button>
                          <button onClick={() => setRemoveId('')}>취소</button>
                        </div>
                      )}
                      {refresh?.card.id === card.id && (
                        <div className="px-confirm">
                          <h3>최신 청크와 비교</h3>
                          {refresh.changes.length ? (
                            refresh.changes.map((change) => (
                              <div key={`${change.id}-${change.field}`}>
                                <strong>
                                  {change.field === 'name'
                                    ? '이름'
                                    : change.field === 'prompt'
                                      ? '프롬프트'
                                      : '네거티브'}
                                </strong>
                                <del>{change.before || '(비어 있음)'}</del>
                                <ins>{change.after || '(비어 있음)'}</ins>
                              </div>
                            ))
                          ) : (
                            <p>변경된 문구가 없습니다.</p>
                          )}
                          {refresh.missing.length > 0 && (
                            <p>
                              연결이 끊긴 청크 {refresh.missing.length}개는 저장된 사본을
                              유지합니다.
                            </p>
                          )}
                          <button
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await store.getState().editLibrary((current) => {
                                  if (store.getState().revision !== refresh.revision)
                                    throw new Error(
                                      '비교 후 자료가 바뀌었습니다. 최신 청크로 갱신을 다시 눌러 주세요.'
                                    )
                                  return {
                                    ...current,
                                    sceneCards: current.sceneCards?.map((item) =>
                                      item.id === refresh.card.id ? refresh.card : item
                                    )
                                  }
                                })
                                setRefresh(null)
                              }, '최신 청크로 갱신했습니다.')
                            }
                          >
                            변경 내용 적용
                          </button>
                          <button onClick={() => setRefresh(null)}>취소</button>
                        </div>
                      )}
                    </article>
                  )
                  return selected ? (
                    <SortableItem key={card.id} id={card.id} name={card.name}>
                      {content}
                    </SortableItem>
                  ) : (
                    <div key={card.id}>{content}</div>
                  )
                })}
              </SortableItems>
            </div>
            {plan.columns
              .filter((id) => !cards.some((card) => card.id === id))
              .map((id) => (
                <p className="px-error" key={id}>
                  삭제된 씬: {id}
                  <button onClick={() => toggleColumn(id)}>선택 해제</button>
                </p>
              ))}
            {!cards.length && (
              <p className="px-empty">
                위의 「새 씬 만들기」로 첫 장면을 만들어 보세요. 예: 미소 청크 + 손 흔들기 청크.
              </p>
            )}
          </div>
        </section>
        <section className="px-pane px-batch-controls" aria-label="수량·순서">
          {creating || cards.find((card) => card.id === editId) ? (
            <SceneEditor
              editorTab={editorTab}
              setEditorTab={setEditorTab}
              key={creating?.id ?? editId}
              card={creating ?? cards.find((card) => card.id === editId)!}
              store={store}
              guard={guard}
              onSave={async (card, group) => {
                await saveCard(card, group)
                setCreating(null)
                setEditId(card.id)
              }}
              onClose={() => {
                setCreating(null)
                setEditId('')
              }}
              onNotice={setNotice}
            />
          ) : (
            <>
              <header>
                <h2>3. 수량 확인·예약</h2>
                <StageChips stage={1} />
              </header>
              <div className="px-scroll">
                <p className="px-hint">
                  ① 캐릭터 체크 → ② 씬 체크 → ③ 아래에서 예약. 예약 후 조합 예약 탭에서 대기열에
                  등록하세요.
                </p>
                <details className="px-batch-detail">
                  <summary>묶음: {plan.name.trim() || automaticName}</summary>
                  <label>
                    묶음 이름
                    <input
                      aria-label="묶음 이름"
                      placeholder={automaticName}
                      value={plan.name}
                      onChange={(event) => setPlan({ ...plan, name: event.target.value })}
                    />
                  </label>
                  <h3>조합별 조정</h3>
                  <small>빈칸은 공통 반복 수, 0은 제외입니다.</small>
                  <div className="px-toolbar">
                    <span>
                      예외 {activeExceptions.length} · 제외{' '}
                      {activeExceptions.filter(([, count]) => count === 0).length}
                    </span>
                    <button onClick={() => setPlan({ ...plan, exceptions: {} })}>
                      예외 전부 지우기
                    </button>
                  </div>
                  <div className="px-matrix">
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">캐릭터 / 씬</th>
                          {plan.columns.map((id) => (
                            <th scope="col" key={id}>
                              {cards.find((card) => card.id === id)?.name ?? '삭제된 씬'}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {plan.rows.map((row) => {
                          const resolved = resolveBatchRow(library, row)
                          return (
                            <tr key={resolved.key}>
                              <th scope="row">{resolved.name}</th>
                              {plan.columns.map((id) => {
                                const key = batchCellKey(resolved.key, id)
                                return (
                                  <td
                                    key={id}
                                    className={
                                      Object.hasOwn(plan.exceptions, key) ? 'has-exception' : ''
                                    }
                                  >
                                    <input
                                      aria-label={`${resolved.name} × ${cards.find((card) => card.id === id)?.name ?? id} 반복 수`}
                                      type="number"
                                      min={0}
                                      max={100}
                                      placeholder={String(plan.count)}
                                      value={plan.exceptions[key] ?? ''}
                                      onChange={(event) => {
                                        const exceptions = { ...plan.exceptions }
                                        if (event.target.value === '') delete exceptions[key]
                                        else exceptions[key] = Number(event.target.value)
                                        setPlan({ ...plan, exceptions })
                                      }}
                                    />
                                  </td>
                                )
                              })}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </details>
                <label>
                  공통 반복 수
                  <input
                    aria-label="공통 반복 수"
                    type="number"
                    min={1}
                    max={100}
                    value={Number.isFinite(plan.count) ? plan.count : ''}
                    onChange={(event) =>
                      setPlan({
                        ...plan,
                        count: event.target.value === '' ? NaN : Number(event.target.value)
                      })
                    }
                  />
                </label>
                <p>
                  작업당 {options.imageCount || '4장 기준 추정'}
                  {options.imageCount ? '장' : ''}{' '}
                  <small>조합 예약 탭에서 기본값 변경 · 아래에서 구성별 지정</small>
                </p>
                <fieldset>
                  <legend>순회 순서</legend>
                  <div className="px-toolbar">
                    <button
                      aria-pressed={plan.order === 'byRow'}
                      onClick={() => setPlan({ ...plan, order: 'byRow' })}
                    >
                      캐릭터별
                    </button>
                    <button
                      aria-pressed={plan.order === 'byColumn'}
                      onClick={() => setPlan({ ...plan, order: 'byColumn' })}
                    >
                      씬별
                    </button>
                  </div>
                </fieldset>
                <ImageSummary
                  value={plan.imageOptions}
                  label="구성 공통 이미지 설정"
                  inheritLabel="씬 설정 따름 · 씬에 없으면 기본값"
                  onChange={(imageOptions) => setPlan({ ...plan, imageOptions })}
                />
                <div aria-live="polite">
                  {preview.error && <p className="px-error">{preview.error}</p>}
                  {preview.expansion?.problems.map((problem, index) => (
                    <p
                      key={index}
                      className={problem.level === 'error' ? 'px-error' : 'px-warning'}
                    >
                      {problem.message}
                    </p>
                  ))}
                  {notice && <p role="status">{notice}</p>}
                </div>
                <div className="px-plan-save">
                  <h3>구성 저장·불러오기</h3>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          store.getState().editLibrary((current) => {
                            const saved = normalizeBatchPlan(
                              { ...plan, name: plan.name.trim() || automaticName },
                              crypto.randomUUID()
                            )
                            return {
                              ...current,
                              batchPlans: [...(current.batchPlans ?? []), saved]
                            }
                          }),
                        '현재 구성을 저장했습니다.'
                      )
                    }
                  >
                    현재 구성 저장
                  </button>
                  <select
                    aria-label="저장한 구성"
                    value={planId}
                    onChange={(event) => setPlanId(event.target.value)}
                  >
                    <option value="">저장한 구성 선택</option>
                    {library.batchPlans?.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={!planId}
                    onClick={() => {
                      const saved = library.batchPlans?.find((item) => item.id === planId)
                      if (saved) {
                        setPlan(structuredClone(saved))
                        setNotice('구성을 불러왔습니다. 재료와 수량을 확인해 주세요.')
                      }
                    }}
                  >
                    구성 불러오기
                  </button>
                </div>
              </div>
              <footer>
                {' '}
                <div className="px-totals" aria-live="polite">
                  {totals
                    ? `${totals.pairs}조합 · ${totals.jobs}작업 · ${totals.images}장`
                    : '수량 확인 필요'}
                </div>
                {batchCounts.size > 1 && (
                  <small>
                    혼합 배치:{' '}
                    {[...batchCounts]
                      .map(([size, count]) => size + '장 × ' + count + '작업')
                      .join(' · ')}
                  </small>
                )}
                <small>장수는 로컬 계산값입니다. 서버 동시 처리와 시드는 별도입니다.</small>
                {totalJobs > 1000 && (
                  <p className="px-error">
                    기존 대기열·예약을 포함해 {totalJobs}작업입니다. 1,000작업 이하로 줄여 주세요.
                  </p>
                )}
                <button
                  className="px-primary"
                  disabled={busy || saving || !plan.rows.length || !plan.columns.length}
                  onClick={() => void reserve()}
                >
                  {saving ? '예약 저장 중…' : '선택 조합 전부 예약'}
                </button>
                <button
                  disabled={busy || saving || !plan.rows.length || !plan.columns.length}
                  onClick={() => void reserve(true)}
                >
                  예약 후 바로 등록
                </button>
                <small>이미지 설정: 씬 → 구성 공통값 → 기본값 순으로 적용</small>
              </footer>
            </>
          )}
        </section>
      </SplitPanes>
    </>
  )
}

function SceneEditor({
  editorTab,
  setEditorTab,
  card,
  store,
  onSave,
  onClose,
  onNotice,
  guard
}: {
  editorTab: string
  setEditorTab: (tab: string) => void
  guard: ReturnType<typeof useUnsavedNavigation>
  card: SceneCard
  store: PixaiStore
  onSave: (card: SceneCard, folder?: Folder) => Promise<void>
  onClose: () => void
  onNotice: (text: string) => void
}): React.JSX.Element {
  const { workspace, busy } = store()
  const [draft, setDraft] = useState(card)
  const [newFolder, setNewFolder] = useState('')
  const [chunkSearch, setChunkSearch] = useState('')
  const [error, setError] = useState('')
  const dirty = JSON.stringify(draft) !== JSON.stringify(card) || !!newFolder
  useEffect(
    () =>
      guard.register(
        dirty,
        () => save(),
        () => {
          setDraft(card)
          setNewFolder('')
          setError('')
        }
      ),
    [dirty, draft, newFolder, card]
  )
  async function save(copy = false): Promise<boolean> {
    try {
      if (!draft.name.trim()) throw new Error('씬 이름을 입력해 주세요.')
      if (!draft.chunks.length && !draft.extra?.prompt.trim())
        throw new Error('청크를 고르거나 씬 문구를 입력해 주세요.')
      let value = copy ? { ...draft, id: crypto.randomUUID(), name: draft.name + ' 사본' } : draft
      if (newFolder.trim()) {
        const folderId = crypto.randomUUID()
        value = { ...value, folderId }
        await onSave(value, { id: folderId, name: newFolder.trim() })
      } else await onSave(value)
      setNewFolder('')
      setDraft(value)
      setError('')
      onNotice('씬을 저장했습니다.')
      return true
    } catch (error) {
      setError(error instanceof Error ? error.message : '씬을 저장하지 못했습니다.')
      return false
    }
  }
  return (
    <form
      className="px-editor px-editor-layout"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <header>
        <h2>씬 편집</h2>
        <small>{dirty ? '저장 안 됨' : '저장됨'}</small>
        <button type="button" onClick={() => guard.request(onClose)}>
          닫기
        </button>
      </header>
      <div className="px-subtabs">
        {['chunks', 'text', 'group'].map((tab, i) => (
          <button
            type="button"
            key={tab}
            aria-pressed={editorTab === tab}
            onClick={() => setEditorTab(tab)}
          >
            {['청크', '문구·이미지', '그룹'][i]}
          </button>
        ))}
      </div>
      <div className="px-scroll">
        <label>
          씬 이름
          <input
            aria-label="씬 이름"
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </label>
        <div hidden={editorTab !== 'group'}>
          <label>
            씬 그룹
            <select
              aria-label="씬 그룹 이동"
              value={draft.folderId ?? ''}
              onChange={(event) => {
                const next = { ...draft }
                if (event.target.value) next.folderId = event.target.value
                else delete next.folderId
                setDraft(next)
              }}
            >
              <option value="">미분류</option>
              {workspace.library.sceneFolders?.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            새 그룹에 저장
            <input
              aria-label="새 씬 그룹에 저장"
              value={newFolder}
              placeholder="새 그룹 이름 (선택)"
              onChange={(event) => setNewFolder(event.target.value)}
            />
          </label>
        </div>
        <div hidden={editorTab !== 'chunks'}>
          {!!draft.chunks.length && (
            <>
              <h3>선택한 청크 · 합치는 순서</h3>
              <small>손잡이로 순서를 바꿀 수 있습니다. 문구 수정은 이 씬에만 적용됩니다.</small>
              <SortableItems
                ids={draft.sceneIds}
                onReorder={(ids) =>
                  setDraft({
                    ...draft,
                    sceneIds: ids,
                    chunks: ids.map((id) => draft.chunks.find((chunk) => chunk.id === id)!)
                  })
                }
              >
                {draft.chunks.map((chunk) => (
                  <SortableItem key={chunk.id} id={chunk.id} name={chunk.name}>
                    <details>
                      <summary>
                        {chunk.name}
                        <small>
                          {(() => {
                            const original = workspace.library.scenes.find(
                              (item) => item.id === chunk.id
                            )
                            return !original
                              ? '원본 연결 없음'
                              : original.prompt === chunk.prompt &&
                                  original.negativePrompt === chunk.negativePrompt
                                ? '원본과 같음'
                                : '사본 수정됨'
                          })()}
                        </small>
                      </summary>
                      <PromptFields
                        prompt={chunk.prompt}
                        negativePrompt={chunk.negativePrompt}
                        onChange={(text) =>
                          setDraft({
                            ...draft,
                            chunks: draft.chunks.map((item) =>
                              item.id === chunk.id ? { ...item, ...text } : item
                            )
                          })
                        }
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const chunks = draft.chunks.filter((item) => item.id !== chunk.id)
                          setDraft({
                            ...draft,
                            chunks,
                            sceneIds: chunks.map((item) => item.id),
                            triggerPosition:
                              typeof draft.triggerPosition === 'number'
                                ? Math.min(draft.triggerPosition, chunks.length + 2)
                                : (draft.triggerPosition ?? 1)
                          })
                        }}
                      >
                        씬에서 빼기
                      </button>
                    </details>
                  </SortableItem>
                ))}
              </SortableItems>
            </>
          )}
          <h3>씬에 넣을 청크</h3>
          <input
            aria-label="씬 편집 청크 검색"
            placeholder="청크 검색"
            value={chunkSearch}
            onChange={(event) => setChunkSearch(event.target.value)}
          />
          <div className="px-scene-chunk-picker">
            <ChunkList
              chunks={workspace.library.scenes}
              folders={workspace.library.chunkFolders}
              search={chunkSearch}
              render={(chunk) => (
                <label className="px-check">
                  <input
                    type="checkbox"
                    aria-label={`씬에 넣기 ${chunk.name}`}
                    checked={draft.sceneIds.includes(chunk.id)}
                    onChange={(event) => {
                      const chunks = event.target.checked
                        ? [...draft.chunks, stripFolder(chunk)]
                        : draft.chunks.filter((item) => item.id !== chunk.id)
                      setDraft({
                        ...draft,
                        chunks,
                        sceneIds: chunks.map((item) => item.id),
                        triggerPosition:
                          typeof draft.triggerPosition === 'number'
                            ? Math.min(draft.triggerPosition, chunks.length + 2)
                            : (draft.triggerPosition ?? 1)
                      })
                    }}
                  />
                  <span>{chunk.name}</span>
                </label>
              )}
            />
          </div>
        </div>
        <div hidden={editorTab !== 'text'}>
          <ImagePicker
            label="씬 이미지 설정"
            inheritLabel="구성 공통값 따름"
            value={draft.imageOptions}
            onChange={(value) => {
              const next = { ...draft }
              if (value) next.imageOptions = value
              else delete next.imageOptions
              setDraft(next)
            }}
          />
          <fieldset className="px-scene-text">
            <legend>씬 문구 · 직접 입력해도 됩니다</legend>
            <PromptFields
              {...(draft.extra ?? { prompt: '', negativePrompt: '' })}
              onChange={(extra) => setDraft({ ...draft, extra })}
            />
          </fieldset>
        </div>
      </div>
      <footer>
        {error && (
          <p role="alert" className="px-error">
            {error}
          </p>
        )}
        <div className="px-toolbar">
          <button className="px-primary" disabled={busy}>
            씬 저장
          </button>
          <button type="button" disabled={busy} onClick={() => void save(true)}>
            복제해서 저장
          </button>
          <small>저장 전에는 목록에 반영되지 않습니다.</small>
        </div>
      </footer>
    </form>
  )
}
