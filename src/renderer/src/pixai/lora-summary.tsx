import type { LoraRef } from '@shared/pixai/library'

const sourceNames = { preset: '프리셋', character: '캐릭터', both: '프리셋 + 캐릭터' }

export function LoraSummary({
  loras,
  sources
}: {
  loras: LoraRef[]
  sources?: ('preset' | 'character' | 'both')[]
}): React.JSX.Element {
  return (
    <details className="px-lora-summary" aria-label="최종 적용 LoRA">
      <summary>최종 적용 LoRA · {loras.length}개</summary>
      {loras.length ? (
        loras.map((lora, index) => (
          <div key={`${lora.id}:${lora.versionId}`} className="px-lora">
            <strong>
              {lora.name || lora.id} × {lora.weight}
            </strong>
            <small>
              {sources?.[index] ? sourceNames[sources[index]] : '예약 사본'} · 버전{' '}
              {lora.versionId || '미지정'}
            </small>
            {lora.triggerWords && <small>트리거: {lora.triggerWords}</small>}
          </div>
        ))
      ) : (
        <p className="px-hint">적용할 LoRA가 없습니다.</p>
      )}
    </details>
  )
}
