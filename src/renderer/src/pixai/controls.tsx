import { RatioMark } from './ratio-mark'
import { Children, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { GripVertical } from 'lucide-react'
import { API_RATIOS, type ImageOptions } from '@shared/pixai/library'

export function SplitPanes({
  name,
  widths: saved,
  onSave,
  children,
  collapsed,
  onCollapse,
  labels = ['재료', '편집', '미리보기']
}: {
  name: string
  widths?: number[]
  onSave: (widths: number[]) => void
  children: ReactNode
  collapsed?: number
  onCollapse?: (index: number) => void
  labels?: string[]
}): React.JSX.Element {
  const defaults = name === '씬' ? [27, 43, 30] : name === '조합' ? [31, 36, 33] : [30, 40, 30]
  const [widths, setWidths] = useState(saved ?? defaults)
  const [localCollapsed, setCollapsed] = useState(name === '씬' ? 0 : name === '조합' ? 1 : 2)
  const [size, setSize] = useState(1440)
  const frame = useRef<HTMLDivElement>(null)
  const drag = useRef<{ index: number; x: number; widths: number[] } | null>(null)
  const latest = useRef(widths)
  const collapsedIndex = collapsed ?? localCollapsed
  const narrow = size <= 1100
  useEffect(() => {
    if (saved && !drag.current) {
      setWidths(saved)
      latest.current = saved
    }
  }, [saved])
  useEffect(() => {
    if (!frame.current || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width > 0) setSize(width)
    })
    observer.observe(frame.current)
    return () => observer.disconnect()
  }, [])
  function change(index: number, delta: number, start = widths): number[] {
    const visible = [0, 1, 2].filter((i) => !narrow || i !== collapsedIndex)
    const left = narrow ? visible[0] : index,
      right = narrow ? visible[1] : index + 1
    const available = Math.max(1, size - 16 - (narrow ? 36 : 0))
    const total = start[left] + start[right]
    const pixels = narrow ? available : (available * total) / 100
    const mins = [260, 320, 300]
    const scale = Math.min(1, pixels / (mins[left] + mins[right]))
    const minLeft = ((mins[left] * scale) / pixels) * total
    const minRight = ((mins[right] * scale) / pixels) * total
    const adjustment = Math.max(minLeft - start[left], Math.min(start[right] - minRight, delta))
    const next = [...start]
    next[left] += adjustment
    next[right] -= adjustment
    latest.current = next
    setWidths(next)
    return next
  }
  return (
    <div
      className="px-panes"
      ref={frame}
      data-narrow={narrow}
      style={{
        gridTemplateColumns: [0, 1, 2]
          .map((i) =>
            narrow && i === collapsedIndex
              ? '36px'
              : narrow
                ? widths[i] + 'fr'
                : 'minmax(' + [260, 320, 300][i] + 'px,' + widths[i] + 'fr)'
          )
          .join(' 8px ')
      }}
    >
      {Children.toArray(children).flatMap((child, index) => [
        <div key={'pane-' + index} className="px-pane-slot">
          <button
            className="px-pane-rail"
            hidden={!narrow || collapsedIndex !== index}
            aria-label={labels[index] + ' 펼치기'}
            onClick={() => {
              const next = index === 2 ? 0 : 2
              setCollapsed(next)
              onCollapse?.(next)
            }}
          >
            {labels[index]}
          </button>
          <div className="px-pane-content" hidden={narrow && collapsedIndex === index}>
            {child}
          </div>
        </div>,
        ...(index === 2
          ? []
          : [
              <div
                key={'divider-' + index}
                className="px-divider"
                role="separator"
                tabIndex={0}
                aria-label={name + ' ' + (index + 1) + ' 칸 너비'}
                aria-orientation="vertical"
                aria-valuemin={5}
                aria-valuemax={90}
                aria-valuenow={Math.round(widths[index])}
                onKeyDown={(event) => {
                  if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
                    event.preventDefault()
                    onSave(change(index, event.key === 'ArrowRight' ? 2 : -2))
                  }
                }}
                onPointerDown={(event) => {
                  if (drag.current) return
                  event.preventDefault()
                  event.currentTarget.setPointerCapture(event.pointerId)
                  drag.current = { index, x: event.clientX, widths: [...widths] }
                }}
                onPointerMove={(event) => {
                  if (drag.current)
                    change(
                      drag.current.index,
                      ((event.clientX - drag.current.x) / size) * 100,
                      drag.current.widths
                    )
                }}
                onPointerUp={() => {
                  if (drag.current) {
                    drag.current = null
                    onSave(latest.current)
                  }
                }}
                onPointerCancel={() => {
                  if (drag.current) {
                    setWidths(drag.current.widths)
                    latest.current = drag.current.widths
                    drag.current = null
                  }
                }}
              />
            ])
      ])}
    </div>
  )
}

export function SortableItems({
  ids,
  onReorder,
  onDrop,
  grid = false,
  children
}: {
  ids: string[]
  onReorder: (ids: string[]) => void
  grid?: boolean
  onDrop?: (id: string, target: string) => boolean
  children: ReactNode
}): React.JSX.Element {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={({ active, over }) => {
        if (!over || active.id === over.id) return
        if (onDrop?.(String(active.id), String(over.id))) return
        const from = ids.indexOf(String(active.id)),
          to = ids.indexOf(String(over.id))
        if (from >= 0 && to >= 0) onReorder(arrayMove(ids, from, to))
      }}
    >
      <SortableContext
        items={ids}
        strategy={grid ? rectSortingStrategy : verticalListSortingStrategy}
      >
        {children}
      </SortableContext>
    </DndContext>
  )
}

export function SortableItem({
  id,
  name,
  children
}: {
  id: string
  name: string
  children: ReactNode
}): React.JSX.Element {
  const { setNodeRef, transform, transition, isDragging, attributes, listeners } = useSortable({
    id
  })
  return (
    <div
      ref={setNodeRef}
      className="px-sortable"
      style={{
        transform: transform ? `translate3d(${transform.x}px,${transform.y}px,0)` : undefined,
        transition,
        opacity: isDragging ? 0.5 : 1
      }}
    >
      <button
        type="button"
        className="px-grip"
        aria-label={`${name} 순서 이동`}
        title="드래그 또는 Space를 누르고 방향키로 이동"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} />
      </button>
      <div className="px-grow">{children}</div>
    </div>
  )
}

export function ImagePicker({
  value,
  onChange,
  label = '이미지 설정',
  inheritLabel = '기본 이미지 설정 따름',
  allowInherit = true
}: {
  value?: ImageOptions
  onChange: (value?: ImageOptions) => void
  label?: string
  inheritLabel?: string
  allowInherit?: boolean
}): React.JSX.Element {
  return (
    <fieldset className="px-image-picker">
      <legend>{label}</legend>
      {allowInherit && (
        <label className="px-check">
          <input
            type="checkbox"
            checked={!!value}
            onChange={(event) =>
              onChange(event.target.checked ? { aspectRatio: '1:1', size: '1k' } : undefined)
            }
          />
          이미지 설정 직접 지정
        </label>
      )}
      {value ? (
        <div className="px-image-grid">
          <div className="px-ratios" aria-label={`${label} 비율`}>
            {API_RATIOS.map((ratio) => (
              <button
                type="button"
                key={ratio}
                title={`가로:세로 ${ratio}`}
                aria-pressed={value.aspectRatio === ratio}
                onClick={() => onChange({ ...value, aspectRatio: ratio })}
              >
                <RatioMark ratio={ratio} />
              </button>
            ))}
          </div>
          <div className="px-sizes">
            {(['1k', '1.5k'] as const).map((size) => (
              <button
                type="button"
                key={size}
                aria-pressed={value.size === size}
                onClick={() => onChange({ ...value, size })}
              >
                {size}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <small>{inheritLabel}</small>
      )}
      {value && (
        <div className="px-generation-choices">
          <div>
            <span>생성당 이미지 수</span>
            <div className="px-toolbar" aria-label="생성당 이미지 수">
              {allowInherit && (
                <button
                  type="button"
                  aria-pressed={value.batchSize === undefined}
                  onClick={() => {
                    const next = { ...value }
                    delete next.batchSize
                    onChange(next)
                  }}
                >
                  기본 장수
                </button>
              )}
              {([1, 4] as const).map((batchSize) => (
                <button
                  key={batchSize}
                  type="button"
                  aria-pressed={value.batchSize === batchSize}
                  onClick={() => onChange({ ...value, batchSize })}
                >
                  {batchSize}장{batchSize === 4 ? ' 배치' : ''}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span>생성 모드</span>
            <div className="px-toolbar" aria-label="생성 모드">
              {allowInherit && (
                <button
                  type="button"
                  aria-pressed={value.mode === undefined}
                  onClick={() => {
                    const next = { ...value }
                    delete next.mode
                    onChange(next)
                  }}
                >
                  기본 모드
                </button>
              )}
              {(['', 'lite', 'standard', 'pro', 'ultra'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={value.mode === mode}
                  onClick={() => onChange({ ...value, mode })}
                >
                  {mode ? mode[0].toUpperCase() + mode.slice(1) : '모델 기본값'}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {value && (
        <small>
          가로:세로 <RatioMark ratio={value.aspectRatio} /> · {value.size}
        </small>
      )}
    </fieldset>
  )
}

export function PromptFields({
  prompt,
  negativePrompt,
  onChange,
  labels
}: {
  prompt: string
  negativePrompt: string
  onChange: (value: { prompt: string; negativePrompt: string }) => void
  /** 용도를 구분하는 표기 (예: 프리셋 공통 포지/네거). 주면 aria-label로도 쓴다. */
  labels?: { prompt: string; negativePrompt: string }
}): React.JSX.Element {
  return (
    <>
      <label>
        {labels?.prompt ?? '프롬프트'}
        <textarea
          aria-label={labels?.prompt}
          value={prompt}
          onChange={(event) => onChange({ prompt: event.target.value, negativePrompt })}
        />
      </label>
      <label>
        {labels?.negativePrompt ?? '네거티브'}
        <textarea
          aria-label={labels?.negativePrompt}
          value={negativePrompt}
          onChange={(event) => onChange({ prompt, negativePrompt: event.target.value })}
        />
      </label>
    </>
  )
}

export function StageChips({ stage }: { stage: 1 | 2 | 3 }): React.JSX.Element {
  return (
    <span className="px-stages" aria-label="작업 단계">
      {['예약', '등록', '시작'].map((label, index) => (
        <span key={label} aria-current={stage === index + 1 ? 'step' : undefined}>
          {index + 1} {label}
        </span>
      ))}
    </span>
  )
}
export function ImageSummary({
  scope,
  children,
  ...props
}: React.ComponentProps<typeof ImagePicker> & {
  scope?: string
  children?: ReactNode
}): React.JSX.Element {
  return (
    <details className="px-image-summary">
      <summary>
        <span>
          {props.value ? (
            <>
              <RatioMark ratio={props.value.aspectRatio} /> · {props.value.size} ·{' '}
              {props.value.batchSize ?? '기본'}장 · {props.value.mode || '모델 기본값'}
            </>
          ) : (
            (props.inheritLabel ?? '기본 이미지 설정 따름')
          )}
        </span>
        {scope && <small className="px-image-scope">{scope}</small>}
        <span className="px-edit-label">변경</span>
      </summary>

      <ImagePicker {...props} />
      {children}
    </details>
  )
}
