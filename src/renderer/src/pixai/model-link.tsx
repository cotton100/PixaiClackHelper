import { useState } from 'react'
import { Link } from 'lucide-react'
import { parseModelLink, type ModelLinkInfo } from '@shared/pixai/model-link'

export function ModelLinkInput({
  label,
  onApply
}: {
  label: string
  onApply: (info: ModelLinkInfo) => void
}): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [info, setInfo] = useState<ModelLinkInfo | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  async function load(): Promise<void> {
    setLoading(true)
    setError('')
    setInfo(null)
    try {
      const parsed = parseModelLink(url)
      setInfo(
        !window.nais || window.nais.runtime === 'browser'
          ? parsed
          : await window.nais.invoke('pixai:model-link', { url })
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : '링크를 읽지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }
  return (
    <div className="px-model-link">
      <label>
        {label} 링크
        <input
          aria-label={`${label} 링크`}
          type="url"
          placeholder="https://pixai.art/model/모델/버전"
          value={url}
          disabled={loading}
          onChange={(e) => {
            setUrl(e.target.value)
            setInfo(null)
            setError('')
          }}
        />
      </label>
      <button type="button" disabled={loading || !url.trim()} onClick={() => void load()}>
        <Link size={15} />
        {loading ? '읽는 중…' : `${label} 정보 가져오기`}
      </button>
      {info && (
        <div className="px-confirm">
          <strong>{info.name || '이름은 직접 입력해 주세요'}</strong>
          <small>
            모델 ID {info.id} · 버전 {info.versionId || '미포함'}
          </small>
          <p>{info.notice}</p>
          <button
            type="button"
            onClick={() => {
              onApply(info)
              setInfo(null)
            }}
          >
            이 정보 적용
          </button>
        </div>
      )}
      {error && (
        <p className="px-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
