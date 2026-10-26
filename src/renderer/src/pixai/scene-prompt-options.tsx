import { useState } from 'react'
import { X } from 'lucide-react'
import {
  composePrompts,
  DEFAULT_BATCH_PROMPT_ORDER,
  type BatchPlan,
  type BatchPromptBlock,
  type Library,
  type Reservation
} from '@shared/pixai/library'
import { ChunkList } from './chunk-list'
import { ComposeGroup } from './compose-group'
import { SortableItem, SortableItems } from './controls'
import { MaterialPreview } from './material-preview'
import './scene-prompt-options.css'

const blockNames: Record<BatchPromptBlock, string> = {
  character: '캐릭터',
  scene: '씬',
  extraChunks: '추가 청크'
}
const blockDescriptions: Record<BatchPromptBlock, string> = {
  character: '캐릭터 프롬프트 + 출연 문구',
  scene: '씬에 저장된 청크 + 씬 문구',
  extraChunks: '왼쪽 아래에서 고른 청크 · 선택한 순서대로'
}

export function SceneExtraChunkPicker({
  library,
  plan,
  onChange,
  disabled = false
}: {
  library: Library
  plan: BatchPlan
  onChange: (plan: BatchPlan) => void
  disabled?: boolean
}): React.JSX.Element {
  const [search, setSearch] = useState('')
  const ids = plan.extraChunkIds ?? []
  function select(next: string[]): void {
    onChange({ ...plan, extraChunkIds: next })
  }
  return (
    <section className="px-pane px-scene-extra-picker" aria-label="추가 청크 선택">
      <header>
        <h2>추가 청크 선택</h2>
        <span>{ids.length}개 선택</span>
      </header>
      <input
        type="search"
        aria-label="추가 청크 검색"
        placeholder="추가할 청크 검색"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="px-toolbar">
        <small>모든 캐릭터×씬에 함께 추가</small>
        <button type="button" disabled={disabled || !ids.length} onClick={() => select([])}>
          추가 청크 선택 해제
        </button>
      </div>
      <div className="px-scroll px-scene-extra-library" aria-label="추가 청크 목록">
        <ChunkList
          label="추가 청크"
          chunks={library.scenes}
          folders={library.chunkFolders}
          search={search}
          selectedIds={ids}
          onSelectionChange={select}
          disabled={disabled}
          render={(chunk) => (
            <label className="px-check px-scene-extra-choice">
              <input
                type="checkbox"
                aria-label={`추가 청크 ${chunk.name} 선택`}
                checked={ids.includes(chunk.id)}
                disabled={disabled}
                onChange={() =>
                  select(
                    ids.includes(chunk.id)
                      ? ids.filter((id) => id !== chunk.id)
                      : [...ids, chunk.id]
                  )
                }
              />
              <span className="px-grow">
                <strong>{chunk.name}</strong>
                <MaterialPreview item={chunk} />
              </span>
            </label>
          )}
        />
        {!library.scenes.length && (
          <p className="px-hint">라이브러리에 청크를 먼저 추가해 주세요.</p>
        )}
        {!!library.scenes.length &&
          !library.scenes.some((chunk) =>
            chunk.name.toLowerCase().includes(search.toLowerCase())
          ) && <p className="px-hint">검색에 맞는 청크가 없습니다.</p>}
      </div>
    </section>
  )
}

export function ScenePromptOptions({
  library,
  plan,
  onChange,
  sample,
  disabled = false
}: {
  library: Library
  plan: BatchPlan
  onChange: (plan: BatchPlan) => void
  sample?: Reservation
  disabled?: boolean
}): React.JSX.Element {
  const ids = plan.extraChunkIds ?? []
  const order = plan.promptOrder ?? DEFAULT_BATCH_PROMPT_ORDER
  const chunkById = new Map(library.scenes.map((chunk) => [chunk.id, chunk]))
  const selectedNames = ids.map((id) => chunkById.get(id)?.name ?? '삭제된 청크')
  const frozen = sample?.snapshot
  const prompt = frozen
    ? composePrompts(
        frozen.common,
        frozen.character,
        frozen.chunks,
        frozen.preset,
        sample.triggerPosition,
        frozen.extras,
        { extraChunks: frozen.extraChunks, promptOrder: frozen.promptOrder }
      )
    : undefined

  function select(next: string[]): void {
    onChange({ ...plan, extraChunkIds: next })
  }

  return (
    <ComposeGroup
      id="scene-prompt-options"
      title="문구 순서·미리보기"
      defaultOpen
      summary={
        <>
          <span>{order.map((block) => blockNames[block]).join(' → ')}</span>
          <span>
            {ids.length ? `${ids.length}개 · ${selectedNames.join(', ')}` : '추가 청크 없음'}
          </span>
        </>
      }
    >
      <div className="px-scene-prompt-options">
        <p className="px-hint">
          추가 청크는 선택한 모든 캐릭터×씬 조합에 함께 붙습니다. 조합 수는 늘어나지 않습니다.
        </p>
        <fieldset>
          <legend>문구 합치는 순서</legend>
          <small>손잡이를 드래그해 이동 · 공통문과 트리거의 기존 설정은 유지</small>
          <div className="px-scene-block-order" aria-label="씬 문구 합치는 순서">
            <SortableItems
              immediateDrag
              ids={[...order]}
              onReorder={(next) => onChange({ ...plan, promptOrder: next as BatchPromptBlock[] })}
            >
              {order.map((block, index) => (
                <SortableItem
                  key={block}
                  id={block}
                  name={`${blockNames[block]} 묶음`}
                  disabled={disabled}
                >
                  <div className="px-scene-prompt-block" data-prompt-block={block}>
                    <strong>
                      {index + 1}. {blockNames[block]}
                    </strong>
                    <small>{blockDescriptions[block]}</small>
                  </div>
                </SortableItem>
              ))}
            </SortableItems>
          </div>
        </fieldset>
        <h3>선택한 추가 청크 {ids.length}개</h3>
        {!!ids.length && (
          <div className="px-scene-extra-selected" aria-label="선택한 추가 청크 순서">
            <small>추가 청크끼리도 손잡이로 순서를 바꿀 수 있습니다.</small>
            <SortableItems immediateDrag ids={ids} onReorder={select}>
              {ids.map((id, index) => {
                const chunk = chunkById.get(id)
                const name = chunk?.name ?? '삭제된 청크'
                return (
                  <SortableItem key={id} id={id} name={`추가 청크 ${name}`} disabled={disabled}>
                    <div className="px-scene-extra-row">
                      <div className="px-grow">
                        <strong className={chunk ? undefined : 'px-error'}>
                          {index + 1}. {name}
                        </strong>
                        {chunk && <MaterialPreview item={chunk} />}
                      </div>
                      <button
                        type="button"
                        aria-label={`추가 청크 ${name} 빼기`}
                        title="선택에서 빼기"
                        disabled={disabled}
                        onClick={() => select(ids.filter((selected) => selected !== id))}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </SortableItem>
                )
              })}
            </SortableItems>
          </div>
        )}
        <details className="px-scene-prompt-preview">
          <summary>첫 조합 문구 미리보기</summary>
          {prompt ? (
            <>
              <small>
                {sample?.batch?.rowName} × {sample?.batch?.columnName} · 예약할 실제 문구
              </small>
              <strong>포지티브</strong>
              <pre aria-label="씬 조합 포지티브 미리보기">{prompt.prompt || '문구 없음'}</pre>
              <strong>네거티브</strong>
              <pre aria-label="씬 조합 네거티브 미리보기">
                {prompt.negativePrompt || '문구 없음'}
              </pre>
            </>
          ) : (
            <p className="px-hint">캐릭터와 씬을 고르면 첫 조합의 문구를 확인할 수 있습니다.</p>
          )}
        </details>
      </div>
    </ComposeGroup>
  )
}
