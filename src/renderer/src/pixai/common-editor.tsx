import { useEffect, useState } from 'react'
import type { CommonPreset } from '@shared/pixai/library'
import { PromptFields } from './controls'
import type { PixaiStore } from './store'
import type { useUnsavedNavigation } from './unsaved-navigation'

export function CommonEditor({
  store,
  guard,
  item,
  isNew,
  onSave,
  onDuplicate,
  onDelete
}: {
  store: PixaiStore
  guard: ReturnType<typeof useUnsavedNavigation>
  item: CommonPreset
  isNew: boolean
  onSave: (value: CommonPreset) => Promise<void>
  onDuplicate: (value: CommonPreset) => void
  onDelete: () => Promise<void>
}): React.JSX.Element {
  const { busy, workspace } = store()
  const [draft, setDraft] = useState(item)
  const [baseline, setBaseline] = useState(item)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const dirty = isNew || JSON.stringify(draft) !== JSON.stringify(baseline)
  // Tabs remain mounted during backup import. Follow saved changes without losing typing.
  if (!dirty && JSON.stringify(item) !== JSON.stringify(baseline)) {
    setDraft(item)
    setBaseline(item)
    setConfirmDelete(false)
    setError('')
  }
  async function save(): Promise<boolean> {
    try {
      const value = {
        ...draft,
        name: draft.name.trim(),
        prompt: draft.prompt.trim(),
        negativePrompt: draft.negativePrompt.trim()
      }
      if (!value.name) throw new Error('공통문 세트 이름을 입력해 주세요.')
      await onSave(value)
      setDraft(value)
      setBaseline(value)
      setError('')
      return true
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '저장하지 못했습니다.')
      return false
    }
  }
  useEffect(
    () =>
      guard.register(dirty, save, () => {
        setDraft(baseline)
        setError('')
      }),
    [draft, dirty, baseline]
  )
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <small>{isNew ? '새 공통문 세트 · 저장 전' : dirty ? '저장 안 됨' : '저장됨'}</small>
      {draft.id ? (
        <label>
          공통문 세트 이름
          <input
            aria-label="공통문 세트 이름"
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </label>
      ) : (
        <p>세트를 연결하지 않은 모델·LoRA 프리셋에 적용합니다.</p>
      )}
      <PromptFields
        labels={{ prompt: '공통 포지', negativePrompt: '공통 네거' }}
        {...draft}
        onChange={(value) => setDraft({ ...draft, ...value })}
      />
      <div className="px-toolbar">
        <button disabled={busy}>공통문 저장</button>
        <button type="button" disabled={busy} onClick={() => onDuplicate(draft)}>
          복제
        </button>
        {!!draft.id && !isNew && (
          <button type="button" disabled={busy} onClick={() => setConfirmDelete(true)}>
            삭제
          </button>
        )}
      </div>
      {confirmDelete && (
        <div role="alertdialog" aria-label="공통문 세트 삭제" className="px-confirm">
          <p>
            이 세트를 삭제할까요? 연결된 프리셋{' '}
            {workspace.library.presets.filter((preset) => preset.commonPresetId === item.id).length}
            개는 기본 공통문을 사용하게 됩니다. 등록된 예약은 유지됩니다.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void onDelete().catch((failure) =>
                setError(failure instanceof Error ? failure.message : '삭제하지 못했습니다.')
              )
            }}
          >
            삭제 확인
          </button>
          <button type="button" onClick={() => setConfirmDelete(false)}>
            취소
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </form>
  )
}
