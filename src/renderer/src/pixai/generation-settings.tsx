import { ComposeGroup } from './compose-group'
import { useState } from 'react'
import type { PixaiStore } from './store'

// Same preset keys as the userscript; support depends on the selected model.
const styles = [
  'anime-watercolor-impasto',
  'art-crayon',
  'bold-line-soft-color',
  'chibi',
  'classic-japanese',
  'clean-flat-illustration',
  'colored-pencil-grain',
  'cool-warm-oil-contrast',
  'desaturated-cool',
  'flat-anime-pastel',
  'glossy-glass-anime',
  'grey-blocks-lineless',
  'hard-line-monochrome-accent',
  'high-contrast-retro-vivid',
  'holographic',
  'korean-style',
  'lineart-watercolor-airy',
  'low-saturation-expressive-eyes',
  'lucid-dreamy',
  'luminous-retro-impasto',
  'minimal-flat-color',
  'modern-oil-glamour',
  'moe-pastel',
  'oil-watercolor-blend',
  'painterly-doodle',
  'paper-watercolor',
  'pencil-sketch',
  'poster-graffiti',
  'retro-comic-fusion',
  'retro-oil-glamour',
  'retro-tv-anime',
  'semi-realistic',
  'stable-vaporwave',
  'tinted-sketch',
  'vintage-collage'
]

export function GenerationSettings({ store }: { store: PixaiStore }): React.JSX.Element {
  const { workspace, busy } = store()
  const savedSeed = String(workspace.options.api?.seed ?? '')
  const savedStyle = String(workspace.options.api?.style ?? '')
  const [draft, setDraft] = useState<{ seed: string; style: string } | null>(null)
  const seed = draft?.seed ?? savedSeed
  const style = draft?.style ?? savedStyle
  const dirty = seed !== savedSeed || style !== savedStyle
  const [notice, setNotice] = useState('')
  return (
    <ComposeGroup
      id="generation"
      title="스타일·시드 공통 옵션"
      summary={
        <>
          저장값: {savedStyle || '스타일 없음'} · 시드 {savedSeed || '랜덤'}
          {dirty && (
            <small>
              미저장 변경: {style || '스타일 없음'} · 시드 {seed || '랜덤'} (저장 후 적용)
            </small>
          )}
        </>
      }
    >
      <div className="px-generation-extra">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (seed.trim() && (!/^\d+$/.test(seed) || Number(seed) > 4294967295)) {
              setNotice('시드는 0~4294967295의 정수 또는 빈칸으로 입력해 주세요.')
              return
            }
            void store
              .getState()
              .commit((current) => ({
                ...current,
                options: {
                  ...current.options,
                  api: { ...current.options.api, seed: seed.trim() ? Number(seed) : '', style }
                }
              }))
              .then(() => {
                setDraft((current) =>
                  current?.seed === seed && current?.style === style ? null : current
                )
                setNotice('저장했습니다. 다음 대기열 등록부터 적용됩니다.')
              })
              .catch((error) => setNotice(error.message))
          }}
        >
          <label>
            츠바키 스타일
            <select
              aria-label="츠바키 스타일"
              value={style}
              onChange={(event) => setDraft({ seed, style: event.target.value })}
            >
              <option value="">스타일 보내지 않음</option>
              {style && !styles.includes(style) && <option value={style}>{style}</option>}
              {styles.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label>
            시드
            <input
              aria-label="API 시드"
              inputMode="numeric"
              value={seed}
              onChange={(event) => setDraft({ seed: event.target.value, style })}
              placeholder="빈칸은 작업마다 랜덤"
            />
          </label>
          <small>
            스타일·시드는 대기열 등록 시 공통 적용됩니다. 지원 여부는 모델에 따라 다릅니다.
          </small>
          <button disabled={busy}>스타일·시드 저장</button>
          {notice && <p role="status">{notice}</p>}
        </form>
      </div>
    </ComposeGroup>
  )
}
