import { MaterialPreview } from './material-preview'
import { RatioMark } from './ratio-mark'
import { useState } from 'react'
import { Star, X } from 'lucide-react'
import {
  composePrompts,
  normalizeSnapshot,
  presetHasText,
  resolvePresetCommon,
  type Combination,
  type Reservation
} from '@shared/pixai/library'
import { makeSceneCard } from '@shared/pixai/batch-reserve'
import { ImageSummary, StageChips, SortableItem, SortableItems, SplitPanes } from './controls'
import { savePaneUI, type PixaiStore } from './store'
import type { ComposeDraft } from './composition'
import { ChunkList } from './chunk-list'
import { resolveImageOptions } from '@shared/pixai/generation-options'
import { GenerationSettings } from './generation-settings'

export function Compose({
  store,
  draft,
  onChange,
  onSceneCreated
}: {
  store: PixaiStore
  draft: ComposeDraft
  onChange: (draft: ComposeDraft) => void
  onSceneCreated: (id: string) => void
}): React.JSX.Element {
  const { workspace, busy } = store()
  const { library } = workspace
  const imageOptions = resolveImageOptions(draft.imageOptions, workspace.options)
  const [search, setSearch] = useState('')
  const [materialTab, setMaterialTab] = useState('chunks')
  const [saveDefaults, setSaveDefaults] = useState(false)
  const [tab, setTab] = useState<'reservations' | 'recent' | 'favorites'>('reservations')
  const [notice, setNotice] = useState('')
  const preset = library.presets.find((item) => item.id === draft.presetId)
  const character = library.characters.find((item) => item.id === draft.characterId)
  const chunks = draft.sceneIds.map(
    (id) =>
      draft.card?.chunks.find((item) => item.id === id) ??
      library.scenes.find((item) => item.id === id)
  )
  const completeChunks = chunks.filter((item): item is NonNullable<typeof item> => !!item)
  // The preset's own common text rides inside the common block, so the trigger index is unchanged.
  const commonName =
    library.commonPresets?.find((item) => item.id === preset?.commonPresetId)?.name ?? '기본 공통문'
  const commonLabel = preset && presetHasText(preset) ? commonName + ' + 프리셋 문구' : commonName
  const prompts = composePrompts(
    resolvePresetCommon(library, preset),
    character ?? { prompt: '', negativePrompt: '' },
    completeChunks,
    preset ?? { loras: [] },
    draft.triggerPosition === 'end'
      ? 'end'
      : Math.min(draft.triggerPosition, completeChunks.length + 2),
    draft.card?.extra ? { scene: draft.card.extra } : {}
  )
  function toggle(id: string): void {
    const ids = draft.sceneIds.includes(id)
      ? draft.sceneIds.filter((item) => item !== id)
      : [...draft.sceneIds, id]
    onChange({
      ...draft,
      sceneIds: ids,
      triggerPosition:
        draft.triggerPosition === 'end' ? 'end' : Math.min(draft.triggerPosition, ids.length + 2)
    })
  }
  async function run(action: () => Promise<void>, message = ''): Promise<void> {
    try {
      await action()
      if (message) setNotice(message)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '저장하지 못했습니다.')
    }
  }
  function validate(): void {
    if (!preset || !character) throw new Error('프리셋과 캐릭터를 골라 주세요.')
    if (chunks.some((chunk) => !chunk)) throw new Error('연결이 끊긴 청크를 확인해 주세요.')
    if (!Number.isInteger(draft.count) || draft.count < 1 || draft.count > 100)
      throw new Error('생성 횟수는 1~100의 정수여야 합니다.')
  }
  function combination(favorite: boolean, at: number): Combination {
    validate()
    return {
      id: crypto.randomUUID(),
      presetId: draft.presetId,
      characterId: draft.characterId,
      sceneIds: draft.sceneIds,
      count: draft.count,
      triggerPosition: draft.triggerPosition,
      imageOptions,
      favorite,
      name: `${character!.name} · ${completeChunks.map((chunk) => chunk.name).join(' · ')}`,
      at
    }
  }
  function load(item: Combination): void {
    // Missing IDs remain visible and block reservation; do not substitute material.
    onChange({
      presetId: item.presetId,
      characterId: item.characterId,
      sceneIds: item.sceneIds,
      count: item.count,
      triggerPosition: item.triggerPosition ?? 1,
      imageOptions: item.imageOptions
    })
    setNotice('조합을 불러왔습니다. 재료와 순서를 확인해 주세요.')
  }
  async function reserve(at: number): Promise<void> {
    validate()
    const history = combination(false, at)
    const reservation: Reservation = {
      id: crypto.randomUUID(),
      presetId: draft.presetId,
      characterId: draft.characterId,
      sceneIds: draft.sceneIds,
      ...(draft.card ? { sourceSceneId: draft.card.id } : {}),
      count: draft.count,
      triggerPosition: draft.triggerPosition,
      imageOptions,
      snapshot: normalizeSnapshot({
        common: resolvePresetCommon(library, preset),
        preset,
        character,
        chunks: completeChunks.map(({ id, name, prompt, negativePrompt }) => ({
          id,
          name,
          prompt,
          negativePrompt
        })),
        ...(draft.card?.extra ? { extras: { scene: draft.card.extra } } : {})
      })
    }
    await store.getState().editLibrary((current) => {
      if (
        workspace.jobs.length +
          current.reservations.reduce((sum, item) => sum + item.count, 0) +
          draft.count >
        1000
      )
        throw new Error('대기열과 예약을 합쳐 1,000작업까지 담을 수 있습니다.')
      return {
        ...current,
        reservations: [...current.reservations, reservation],
        combinations: [
          ...(current.combinations ?? []).filter((item) => item.favorite),
          ...(current.combinations ?? []).filter((item) => !item.favorite).slice(-49),
          ...(!draft.card?.extra ? [history] : [])
        ]
      }
    })
  }
  const order = ['common', 'character', ...draft.sceneIds.map((id) => `chunk:${id}`)]
  order.splice(
    draft.triggerPosition === 'end' ? order.length : draft.triggerPosition,
    0,
    'triggers'
  )
  return (
    <SplitPanes
      name="조합"
      widths={workspace.options.ui?.paneRatios?.compose ?? workspace.widths.compose}
      collapsed={workspace.options.ui?.collapsedPane?.compose}
      labels={['조합 재료', '순서·미리보기', '예약·기록']}
      onCollapse={(index) => void savePaneUI(store, 'compose', undefined, index).catch(() => {})}
      onSave={(widths) => void savePaneUI(store, 'compose', widths).catch(() => {})}
    >
      <section className="px-pane" aria-label="조합 재료">
        <header>
          <h2>조합 재료</h2>
        </header>
        <div className="px-scroll px-material-body">
          <div className="px-selection-summary">
            <button onClick={() => setMaterialTab('presets')}>
              프리셋 <strong>{preset?.name || '선택해 주세요'}</strong>
            </button>
            <button onClick={() => setMaterialTab('characters')}>
              캐릭터 <strong>{character?.name || '선택해 주세요'}</strong>
            </button>
            <button onClick={() => setMaterialTab('chunks')}>
              청크 <strong>{draft.sceneIds.length}개 선택</strong>
            </button>
          </div>
          <ImageSummary
            value={imageOptions}
            allowInherit={false}
            scope={
              JSON.stringify(imageOptions) ===
              JSON.stringify(resolveImageOptions(undefined, workspace.options))
                ? '이 예약에 적용 · 기본값과 같음'
                : '이 예약만 · 기본값과 다름'
            }
            onChange={(next) => {
              if (!next) return
              if (!saveDefaults) {
                onChange({ ...draft, imageOptions: next })
                return
              }
              void run(async () => {
                await store.getState().commit((current) => ({
                  ...current,
                  options: {
                    ...current.options,
                    imageCount: next.batchSize,
                    api: {
                      ...current.options.api,
                      aspectRatio: next.aspectRatio,
                      size: next.size,
                      mode: next.mode
                    }
                  },
                  composeDraft: { ...draft, imageOptions: next }
                }))
              })
            }}
          >
            <fieldset className="px-toolbar">
              <legend>이미지 설정 적용 범위</legend>
              <label className="px-check">
                <input
                  type="radio"
                  name="image-scope"
                  checked={!saveDefaults}
                  onChange={() => setSaveDefaults(false)}
                />
                이 예약만
              </label>
              <label className="px-check">
                <input
                  type="radio"
                  name="image-scope"
                  checked={saveDefaults}
                  onChange={() => setSaveDefaults(true)}
                />
                기본값으로도 저장
              </label>
            </fieldset>
            <small>기본값 저장을 선택한 뒤 변경한 값부터 적용됩니다. 기존 예약은 유지됩니다.</small>
          </ImageSummary>
          <GenerationSettings store={store} />
          <div className="px-subtabs" aria-label="조합 재료 종류">
            {['presets', 'characters', 'chunks'].map((id, i) => (
              <button
                key={id}
                aria-pressed={materialTab === id}
                onClick={() => {
                  setMaterialTab(id)
                  setSearch('')
                }}
              >
                {['프리셋', '캐릭터', '청크'][i]}
              </button>
            ))}
          </div>
          <input
            aria-label="조합 청크 검색"
            placeholder="현재 재료 검색"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {materialTab === 'presets' && (
            <div aria-label="프리셋 선택" className="px-material-list">
              {library.presets
                .filter((item) => item.name.toLowerCase().includes(search.toLowerCase()))
                .map((item) => (
                  <button
                    key={item.id}
                    className="px-material-pick"
                    aria-label={item.name}
                    aria-pressed={draft.presetId === item.id}
                    onClick={() => onChange({ ...draft, presetId: item.id })}
                  >
                    <strong>{item.name}</strong>
                    <MaterialPreview item={item} library={library} />
                  </button>
                ))}
            </div>
          )}
          {materialTab === 'characters' && (
            <ChunkList
              chunks={library.characters}
              folders={library.characterFolders ?? []}
              label="캐릭터"
              search={search}
              render={(item) => (
                <button
                  className="px-material-pick"
                  aria-label={item.name}
                  aria-pressed={draft.characterId === item.id}
                  onClick={() =>
                    onChange({
                      ...draft,
                      characterId: item.id,
                      presetId: item.defaultPresetId || draft.presetId
                    })
                  }
                >
                  <strong>{item.name}</strong>
                  <MaterialPreview item={item} library={library} />
                </button>
              )}
            />
          )}
          <div hidden={materialTab !== 'chunks'}>
            <div className="px-toolbar">
              <span>청크 {draft.sceneIds.length}개 선택</span>
              <button
                onClick={() =>
                  onChange({ ...draft, sceneIds: [], triggerPosition: 1, card: undefined })
                }
              >
                청크 선택 해제
              </button>
            </div>
            {!!completeChunks.length && (
              <details open className="px-selected-materials">
                <summary>선택한 청크 · 합쳐지는 순서</summary>
                {completeChunks.map((chunk, i) => (
                  <button
                    key={chunk.id}
                    onClick={() => toggle(chunk.id)}
                    aria-label={chunk.name + ' 선택 해제'}
                  >
                    {i + 1}. {chunk.name} ×
                  </button>
                ))}
              </details>
            )}
            <div>
              {[{ id: '', name: '미분류' }, ...library.chunkFolders].map((folder) => {
                const items = library.scenes.filter(
                  (chunk) =>
                    (chunk.folderId ?? '') === folder.id &&
                    chunk.name.toLowerCase().includes(search.toLowerCase())
                )
                if (!items.length) return null
                return (
                  <details key={folder.id} open={search ? true : undefined} className="px-folder">
                    <summary>
                      {folder.name}{' '}
                      <small>
                        {items.filter((item) => draft.sceneIds.includes(item.id)).length}/
                        {items.length}
                      </small>
                    </summary>
                    {items.map((chunk) => (
                      <label
                        key={chunk.id}
                        className={`px-check px-choice ${draft.sceneIds.includes(chunk.id) ? 'is-selected' : ''}`}
                      >
                        <input
                          aria-label={`청크 ${chunk.name}`}
                          type="checkbox"
                          checked={draft.sceneIds.includes(chunk.id)}
                          onChange={() => toggle(chunk.id)}
                        />
                        <span className="px-material-copy">
                          <strong>{chunk.name}</strong>
                          <MaterialPreview item={chunk} />
                        </span>
                      </label>
                    ))}
                  </details>
                )
              })}
              {!library.scenes.length && (
                <p className="px-empty">
                  설정에서 스크립트 백업을 가져오거나 라이브러리에서 청크를 만들어 주세요.
                </p>
              )}
            </div>
          </div>
        </div>
      </section>
      <section className="px-pane" aria-label="순서·미리보기">
        <header>
          <h2>순서·미리보기</h2>
        </header>
        <div className="px-scroll">
          {draft.card && (
            <div className="px-banner">
              씬 「{draft.card.name}」의 저장된 문구를 사용합니다.
              <button onClick={() => onChange({ ...draft, card: undefined })}>씬 연결 해제</button>
            </div>
          )}
          <div className="px-order">
            <SortableItems
              ids={order}
              onReorder={(ids) => {
                // Common and character stay in order; chunks and the trigger block move.
                const materials = ids.filter((id) => id !== 'triggers')
                if (materials[0] !== 'common' || materials[1] !== 'character') {
                  setNotice('공통문과 캐릭터는 앞에 고정됩니다. 청크와 트리거 순서를 바꿔 주세요.')
                  return
                }
                onChange({
                  ...draft,
                  sceneIds: materials.slice(2).map((id) => id.slice(6)),
                  triggerPosition:
                    ids.indexOf('triggers') === ids.length - 1 ? 'end' : ids.indexOf('triggers')
                })
              }}
            >
              {order.map((id) => (
                <SortableItem
                  key={id}
                  id={id}
                  name={
                    id === 'triggers'
                      ? 'LoRA 트리거'
                      : id === 'common'
                        ? commonLabel
                        : id === 'character'
                          ? '캐릭터'
                          : (completeChunks.find((chunk) => `chunk:${chunk.id}` === id)?.name ??
                            '누락 청크')
                  }
                >
                  <div className="px-order-row">
                    <span>
                      {id === 'common'
                        ? commonLabel
                        : id === 'character'
                          ? character?.name || '캐릭터 미선택'
                          : id === 'triggers'
                            ? 'LoRA 트리거'
                            : (completeChunks.find((chunk) => `chunk:${chunk.id}` === id)?.name ??
                              '연결이 끊긴 청크')}
                    </span>
                    {id.startsWith('chunk:') && (
                      <button
                        aria-label={`${id.slice(6)} 청크 빼기`}
                        onClick={() => toggle(id.slice(6))}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </SortableItem>
              ))}
            </SortableItems>
          </div>
          {preset && presetHasText(preset) && (
            <small>
              프리셋 「{preset.name}」의 공통 포지·네거가 공통문 블록에 포함됩니다. 미리보기와
              예약에 같은 문구가 들어갑니다.
            </small>
          )}
          <label>
            LoRA 트리거 위치
            <select
              value={draft.triggerPosition}
              onChange={(event) =>
                onChange({
                  ...draft,
                  triggerPosition: event.target.value === 'end' ? 'end' : Number(event.target.value)
                })
              }
            >
              {Array.from({ length: draft.sceneIds.length + 3 }, (_, i) => (
                <option key={i} value={i}>
                  {i === 0
                    ? '맨 앞'
                    : i === 1
                      ? '공통문 뒤'
                      : i === 2
                        ? '캐릭터 뒤'
                        : `${i - 2}번째 청크 뒤`}
                </option>
              ))}
              <option value="end">맨 뒤 (씬 추가 문구 포함)</option>
            </select>
          </label>
          <label>
            전송 미리보기
            <textarea readOnly value={prompts.prompt} />
          </label>
          <details>
            <summary>네거티브 미리보기</summary>
            <textarea readOnly aria-label="네거티브 미리보기" value={prompts.negativePrompt} />
          </details>
        </div>
        <footer>
          <button
            disabled={busy || !draft.sceneIds.length}
            onClick={() =>
              void run(async () => {
                const card = makeSceneCard(library, {
                  sceneIds: draft.sceneIds,
                  triggerPosition: draft.triggerPosition,
                  imageOptions,
                  extra: draft.card?.extra
                })
                await store.getState().editLibrary((current) => ({
                  ...current,
                  sceneCards: [...(current.sceneCards ?? []), card]
                }))
                onSceneCreated(card.id)
              })
            }
          >
            이 조합으로 씬 만들기
          </button>
          <small>
            청크 순서·트리거 위치·비율을 저장합니다. 캐릭터와 프리셋은 씬에 포함하지 않습니다.
          </small>
        </footer>
      </section>
      <section className="px-pane" aria-label="예약·기록">
        <header>
          <h2>예약·기록</h2>
          <StageChips stage={1} />
        </header>
        <label>
          이 조합의 생성 횟수
          <input
            aria-label="조합 생성 횟수"
            type="number"
            min={1}
            max={100}
            value={Number.isFinite(draft.count) ? draft.count : ''}
            onChange={(event) =>
              onChange({
                ...draft,
                count: event.target.value === '' ? NaN : Number(event.target.value)
              })
            }
          />
        </label>
        <div className="px-toolbar">
          <button
            className="px-primary px-grow"
            disabled={busy}
            onClick={() => {
              const at = Date.now()
              void run(() => reserve(at), '조합을 예약했습니다. 아직 생성하지 않았습니다.')
            }}
          >
            이 조합 예약 추가
          </button>
          <button
            disabled={busy || !!draft.card?.extra}
            title={
              draft.card?.extra ? '씬 추가 문구는 씬 카드로 보관해 주세요.' : '현재 조합 즐겨찾기'
            }
            aria-label="현재 조합 즐겨찾기"
            onClick={() => {
              const at = Date.now()
              void run(
                () =>
                  store.getState().editLibrary((current) => ({
                    ...current,
                    combinations: [...(current.combinations ?? []), combination(true, at)]
                  })),
                '즐겨찾기에 저장했습니다.'
              )
            }}
          >
            <Star size={18} />
          </button>
        </div>
        <div className="px-subtabs">
          {(['reservations', 'recent', 'favorites'] as const).map((id, i) => (
            <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>
              {['예약', '최근', '즐겨찾기'][i]}
            </button>
          ))}
        </div>
        <div className="px-scroll">
          {tab === 'reservations' ? (
            <ReservationList store={store} onNotice={setNotice} />
          ) : (
            (library.combinations ?? [])
              .filter((item) => (tab === 'favorites' ? item.favorite : !item.favorite))
              .slice()
              .reverse()
              .map((item) => (
                <article className="px-history" key={item.id}>
                  <strong>{item.name}</strong>
                  <small>
                    {item.count}회 ·{' '}
                    {item.imageOptions ? (
                      <RatioMark ratio={item.imageOptions.aspectRatio} />
                    ) : (
                      '기본 비율'
                    )}
                  </small>
                  <div className="px-toolbar">
                    <button onClick={() => load(item)}>불러오기</button>
                    <button
                      disabled={busy}
                      aria-label={`${item.name} 즐겨찾기 전환`}
                      onClick={() =>
                        void run(() =>
                          store.getState().editLibrary((current) => ({
                            ...current,
                            combinations: current.combinations?.map((entry) =>
                              entry.id === item.id ? { ...entry, favorite: !entry.favorite } : entry
                            )
                          }))
                        )
                      }
                    >
                      <Star size={15} fill={item.favorite ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                </article>
              ))
          )}
        </div>
        <footer>
          {notice && <p role="status">{notice}</p>}
          <button
            className="px-primary"
            disabled={busy || !library.reservations.length}
            onClick={() =>
              void run(
                () => store.getState().register(),
                '로컬 대기열에 등록했습니다. 생성 요청은 보내지 않았습니다.'
              )
            }
          >
            대기열에 등록 →
          </button>
          <small>
            예약 {library.reservations.length}조합 ·{' '}
            {library.reservations.reduce((sum, item) => sum + item.count, 0)}작업 ·{' '}
            {library.reservations.reduce(
              (sum, item) =>
                sum +
                item.count * resolveImageOptions(item.imageOptions, workspace.options).batchSize!,
              0
            )}
            장
          </small>
          <small>등록해야 대기열로 갑니다. 유료 생성은 대기열에서 시작합니다.</small>
        </footer>
      </section>
    </SplitPanes>
  )
}

export function ReservationList({
  store,
  onNotice
}: {
  store: PixaiStore
  onNotice: (text: string) => void
}): React.JSX.Element {
  const { workspace, busy } = store()
  const groups = new Map<string, Reservation[]>()
  for (const item of workspace.library.reservations) {
    const key = item.batch ? `batch:${item.batch.id}` : `single:${item.id}`
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  async function remove(ids: string[]): Promise<void> {
    try {
      await store.getState().editLibrary((library) => ({
        ...library,
        reservations: library.reservations.filter((item) => !ids.includes(item.id))
      }))
      onNotice('선택한 미등록 예약을 제외했습니다.')
    } catch {
      onNotice('예약을 제외하지 못했습니다. 다시 시도해 주세요.')
    }
  }
  function row(item: Reservation): React.JSX.Element {
    return (
      <div className="px-reservation" key={item.id}>
        <strong>
          {item.batch
            ? `${item.batch.rowName} · ${item.batch.columnName}`
            : (item.snapshot?.character.name ?? item.characterId)}
        </strong>
        <small>
          {item.count}작업 ·{' '}
          {item.imageOptions ? (
            <>
              <RatioMark ratio={item.imageOptions.aspectRatio} /> / {item.imageOptions.size} ·{' '}
              {item.imageOptions.batchSize ?? workspace.options.imageCount ?? 4}장 ·{' '}
              {(item.imageOptions.mode ?? workspace.options.api?.mode) || '모델 기본값'}
            </>
          ) : (
            '기본 이미지 설정'
          )}
        </small>
        <button
          disabled={busy}
          aria-label={`${item.id} 예약 제외`}
          onClick={() => void remove([item.id])}
        >
          예약 제외
        </button>
      </div>
    )
  }
  return (
    <>
      {[...groups].map(([key, items]) =>
        items[0].batch ? (
          <details className="px-reservation-group" key={key}>
            <summary>
              {items[0].batch.name}
              <small>
                {items.length}조합 · {items.reduce((sum, item) => sum + item.count, 0)}작업 ·{' '}
                {items.reduce(
                  (sum, item) =>
                    sum +
                    item.count *
                      resolveImageOptions(item.imageOptions, workspace.options).batchSize!,
                  0
                )}
                장
              </small>
            </summary>
            <button disabled={busy} onClick={() => void remove(items.map((item) => item.id))}>
              이 묶음 제외
            </button>
            {items.map(row)}
          </details>
        ) : (
          row(items[0])
        )
      )}
      {!groups.size && (
        <p className="px-empty">
          아직 예약이 없습니다. 조합 하나를 추가하거나 씬 탭에서 여러 캐릭터와 씬을 골라 주세요.
        </p>
      )}
    </>
  )
}
