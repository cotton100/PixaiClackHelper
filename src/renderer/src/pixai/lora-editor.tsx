import { useState } from 'react'
import type { LoraRef } from '@shared/pixai/library'
import { ModelLinkInput } from './model-link'

/** The same controls edit style LoRAs and the LoRAs that follow a character. */
export function LoraEditor({
  value,
  onChange,
  character = false
}: {
  value: LoraRef[]
  onChange: (value: LoraRef[]) => void
  character?: boolean
}): React.JSX.Element {
  const [keys, setKeys] = useState(() => value.map(() => crypto.randomUUID()))
  // A clean parent editor may receive more LoRAs after importing a backup.
  if (keys.length !== value.length)
    setKeys(value.map((_, index) => keys[index] ?? crypto.randomUUID()))
  const label = character ? '캐릭터 LoRA' : 'LoRA'
  function change(index: number, update: Partial<LoraRef>): void {
    onChange(value.map((item, i) => (i === index ? { ...item, ...update } : item)))
  }
  return (
    <details open>
      <summary>
        {label}
        {character ? ` · ${value.length}개` : ''}
      </summary>
      {character && (
        <p className="px-hint">
          이 캐릭터를 고르면 프리셋의 LoRA와 함께 적용됩니다. 같은 LoRA의 버전·수치·트리거가 다르면
          예약 전에 알려드립니다.
        </p>
      )}
      {value.map((lora, index) => (
        <fieldset key={keys[index]} className="px-lora">
          <legend>
            {label} {index + 1}
          </legend>
          <details>
            <summary>링크·ID·버전</summary>
            <ModelLinkInput
              label={`${label} ${index + 1}`}
              onApply={(info) =>
                onChange(
                  value.map((entry, i) =>
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
                )
              }
            />
            {(['id', 'versionId'] as const).map((field) => (
              <label key={field}>
                {field === 'id' ? 'LoRA ID' : '버전 ID'}
                <input
                  aria-label={`${label} ${index + 1} ${field === 'id' ? 'ID' : '버전 ID'}`}
                  value={lora[field] ?? ''}
                  onChange={(event) => change(index, { [field]: event.target.value })}
                />
              </label>
            ))}
          </details>
          <div className="px-lora-row">
            {(['name', 'triggerWords'] as const).map((field) => (
              <label key={field}>
                {field === 'name' ? '이름' : '트리거 문구'}
                <input
                  aria-label={`${label} ${index + 1} ${field === 'name' ? '이름' : '트리거 문구'}`}
                  value={lora[field] ?? ''}
                  onChange={(event) => change(index, { [field]: event.target.value })}
                />
              </label>
            ))}
            <label>
              가중치
              <input
                aria-label={`${label} ${index + 1} 가중치`}
                type="number"
                step="0.05"
                min={-2}
                max={2}
                value={Number.isFinite(lora.weight) ? lora.weight : ''}
                onChange={(event) =>
                  change(index, {
                    weight: event.target.value === '' ? NaN : Number(event.target.value)
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
              setKeys(keys.filter((_, i) => i !== index))
              onChange(value.filter((_, i) => i !== index))
            }}
          >
            이 LoRA 빼기
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        onClick={() => {
          setKeys([...keys, crypto.randomUUID()])
          onChange([...value, { id: '', name: '', weight: 0.7 }])
        }}
      >
        {label} 추가
      </button>
    </details>
  )
}
