import { useEffect, useRef, useState } from 'react'
import { FileImage, Upload } from 'lucide-react'
import { IMAGE_INFO_MAX_BYTES, type ImageInfo } from '@shared/pixai/image-info'
import {
  importImageComposition,
  importedPreset,
  noImageSelection,
  type ImageImportSelection
} from './image-import'
import type { PixaiStore } from './store'

export function ImageInformation({
  store,
  onCompose
}: {
  store: PixaiStore
  onCompose: () => void
}): React.JSX.Element {
  const { busy } = store()
  const [info, setInfo] = useState<ImageInfo | null>(null)
  const [source, setSource] = useState(0)
  const [selected, setSelected] = useState(noImageSelection)
  const [name, setName] = useState('')
  const [preview, setPreview] = useState('')
  const [reading, setReading] = useState(false)
  const [notice, setNotice] = useState('')
  const [confirm, setConfirm] = useState(false)
  const token = useRef(0)
  const browser = !window.nais || window.nais.runtime === 'browser'
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview)
    },
    [preview]
  )
  useEffect(
    () => () => {
      token.current++
    },
    []
  )
  const fields = info?.sources[source]?.fields
  async function read(file?: File): Promise<void> {
    if (!file || reading || busy) return
    const request = ++token.current
    setInfo(null)
    setSelected(noImageSelection())
    setConfirm(false)
    setPreview('')
    setNotice('')
    if (browser) {
      setNotice('이미지 정보 읽기는 설치한 앱에서 사용할 수 있습니다.')
      return
    }
    if (!file.size || file.size > IMAGE_INFO_MAX_BYTES) {
      setNotice('32MB 이하 이미지 한 장을 선택해 주세요.')
      return
    }
    setReading(true)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const result = await window.nais.invoke('pixai:image-info', { bytes })
      if (token.current !== request) return
      setInfo(result)
      setSource(0)
      setName(file.name.replace(/\.[^.]+$/, '').slice(0, 100))
      setPreview(URL.createObjectURL(new Blob([bytes], { type: `image/${result.format}` })))
    } catch {
      if (token.current === request)
        setNotice(
          '읽기 실패: 지원 형식·파일 손상·크기 제한을 확인해 주세요. 원본과 현재 조합은 변경되지 않았습니다.'
        )
    } finally {
      if (token.current === request) setReading(false)
    }
  }
  async function save(kind: 'chunk' | 'preset' | 'compose'): Promise<void> {
    if (!fields || !name.trim()) {
      setNotice('출처와 저장할 이름을 확인해 주세요.')
      return
    }
    try {
      if (kind === 'compose') {
        await store
          .getState()
          .commit((current) => importImageComposition(current, fields, selected, name.trim()))
        setConfirm(false)
        onCompose()
      } else
        await store.getState().editLibrary((library) =>
          kind === 'preset'
            ? {
                ...library,
                presets: [
                  ...library.presets,
                  importedPreset(fields, name.trim(), crypto.randomUUID())
                ]
              }
            : {
                ...library,
                scenes: [
                  ...library.scenes,
                  {
                    id: crypto.randomUUID(),
                    name: name.trim(),
                    prompt: fields.prompt ?? '',
                    negativePrompt: fields.negativePrompt ?? ''
                  }
                ]
              }
        )
      setNotice(
        kind === 'compose'
          ? '새 조합을 열었습니다. 예약·생성은 하지 않았습니다.'
          : '라이브러리에 새 항목을 저장했습니다.'
      )
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '저장 실패')
    }
  }
  const rows: {
    key: keyof ImageImportSelection
    label: string
    available: boolean
    text: string
  }[] = fields
    ? [
        {
          key: 'prompt',
          label: '긍정 프롬프트',
          available: fields.prompt !== undefined,
          text: fields.prompt ?? '정보 없음'
        },
        {
          key: 'negativePrompt',
          label: '부정 프롬프트',
          available: fields.negativePrompt !== undefined,
          text: fields.negativePrompt ?? '정보 없음'
        },
        {
          key: 'model',
          label: 'PixAI 모델·LoRA 버전',
          available: !!fields.modelVersionId,
          text: fields.modelVersionId
            ? `모델 버전 ${fields.modelVersionId}\n${fields.loras === undefined ? 'LoRA 정보 없음: 적용 시 빈 목록' : fields.loras.map((v) => `${v.versionId} · ${v.weight}`).join('\n') || 'LoRA 없음'}`
            : 'PixAI 버전 ID 없음 · 현재 조합의 프리셋 사용'
        },
        {
          key: 'image',
          label: '비율·크기·모드·장수',
          available: !!(fields.aspectRatio || fields.size || fields.mode || fields.batchSize),
          text:
            [
              fields.aspectRatio,
              fields.size,
              fields.mode,
              fields.batchSize && `${fields.batchSize}장`
            ]
              .filter(Boolean)
              .join(' · ') || '지원되는 설정 없음 (픽셀 크기로 추측하지 않음)'
        },
        {
          key: 'seed',
          label:
            fields.seedKind === 'request'
              ? '요청 시드 (개별 결과 확정값 아님)'
              : '시드 (파일 기록)',
          available: fields.seed !== undefined,
          text: fields.seed === undefined ? '정보 없음' : String(fields.seed)
        },
        {
          key: 'style',
          label: 'PixAI 스타일',
          available: !!fields.style,
          text: fields.style ?? '정보 없음'
        }
      ]
    : []
  return (
    <div className="px-image-info">
      <section className="px-pane">
        <h2>
          <FileImage size={20} /> 이미지 생성 정보
        </h2>
        <p>파일 안의 기록을 이 PC에서 읽습니다. 업로드·생성·원본 변경은 하지 않습니다.</p>
        <div
          className="px-image-drop"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            if (e.dataTransfer.files.length !== 1) {
              setNotice('이미지는 한 장씩 넣어 주세요.')
              return
            }
            void read(e.dataTransfer.files[0])
          }}
        >
          <Upload size={24} />
          <p>이미지를 여기에 놓거나 파일을 선택하세요.</p>
          <input
            type="file"
            aria-label="이미지 파일 선택"
            accept="image/png,image/jpeg,image/webp"
            disabled={reading || busy || browser}
            onChange={(e) => {
              void read(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <small>PNG · JPEG · WebP / 32MB · 4천만 픽셀 이하 / 설치 앱 전용</small>
        </div>
        {preview && <img className="px-image-preview" src={preview} alt="선택한 이미지" />}
        {info && (
          <p>
            {info.format.toUpperCase()} · 실제 파일 {info.width} × {info.height}px
          </p>
        )}
        {reading && <p role="status">파일 안의 정보를 읽는 중…</p>}
        {notice && <p role="status">{notice}</p>}
      </section>
      <section className="px-pane">
        <h2>적용할 정보</h2>
        {!info && <p>이미지를 선택하면 출처별 기록이 여기에 표시됩니다.</p>}
        {info?.warnings.map((warning) => (
          <p key={warning} className="px-muted">
            {warning}
          </p>
        ))}
        {!!info?.sources.length && (
          <>
            <div className="px-toolbar">
              {info.sources.map((v, index) => (
                <button
                  key={index}
                  aria-pressed={source === index}
                  onClick={() => {
                    setSource(index)
                    setSelected(noImageSelection())
                    setConfirm(false)
                  }}
                >
                  {v.label}
                </button>
              ))}
            </div>
            {fields?.width && (
              <p>
                기록된 생성 크기: {fields.width} × {fields.height ?? '?'}px
              </p>
            )}
            <label>
              저장할 이름
              <input
                aria-label="이미지 정보 이름"
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {rows.map((row) => (
              <div className="px-image-field" key={row.key}>
                <label className="px-check">
                  <input
                    type="checkbox"
                    aria-label={`${row.label} 적용`}
                    disabled={!row.available || busy}
                    checked={selected[row.key]}
                    onChange={(e) => {
                      setSelected({ ...selected, [row.key]: e.target.checked })
                      setConfirm(false)
                    }}
                  />
                  {row.label}
                </label>
                <pre>{row.text || '(빈 문구)'}</pre>
              </div>
            ))}
            <p>
              체크한 항목만 새 조합에 적용합니다. 문구는 통째로 보관하며 원래 청크 구성을 복원하지
              않습니다. 시드·스타일 적용은 다음 등록에 쓰는 공통 옵션도 바꿉니다.
            </p>
            <div className="px-toolbar">
              <button
                disabled={
                  busy ||
                  !name.trim() ||
                  (fields?.prompt === undefined && fields?.negativePrompt === undefined)
                }
                onClick={() => void save('chunk')}
              >
                이 출처 문구를 청크로 저장
              </button>
              <button
                disabled={busy || !name.trim() || !fields?.modelVersionId}
                onClick={() => void save('preset')}
              >
                이 출처 모델을 프리셋으로 저장
              </button>
              <button
                className="px-primary"
                disabled={busy || !name.trim() || !Object.values(selected).some(Boolean)}
                onClick={() => setConfirm(true)}
              >
                선택 정보로 조합 열기
              </button>
            </div>
            {confirm && (
              <div className="px-image-confirm" role="group" aria-label="새 조합 적용 확인">
                <p>
                  현재 조합 선택을 바꿉니다. 선택하지 않은 문구는 현재 전송문을 유지합니다. 중복
                  합성을 막기 위해 전용 프리셋·빈 공통문·빈 캐릭터·통짜 청크를 새로 저장합니다. 기존
                  재료·예약·작업은 유지합니다.
                </p>
                <button disabled={busy} onClick={() => void save('compose')}>
                  확인하고 새 조합 열기
                </button>
                <button onClick={() => setConfirm(false)}>취소</button>
              </div>
            )}
          </>
        )}
        {!!info?.raw.length && (
          <details>
            <summary>파일 메타데이터 원문 · 미지원 정보 포함</summary>
            {info.raw.map((v, i) => (
              <details key={i}>
                <summary>{v.label}</summary>
                <pre>{v.text}</pre>
              </details>
            ))}
          </details>
        )}
      </section>
    </div>
  )
}
