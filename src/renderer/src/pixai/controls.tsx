import { Children, useRef, useState, type ReactNode } from 'react'
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
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { GripVertical } from 'lucide-react'
import { API_RATIOS, type ImageOptions } from '@shared/pixai/library'

export function SplitPanes({
  name,
  widths: saved,
  onSave,
  children
}: {
  name: string
  widths?: number[]
  onSave: (widths: number[]) => void
  children: ReactNode
}): React.JSX.Element {
  const [widths, setWidths] = useState(saved ?? [30, 36, 34])
  const frame = useRef<HTMLDivElement>(null)
  const drag = useRef<{ index: number; x: number; widths: number[] } | null>(null)
  const latest = useRef(widths)
  function change(index: number, delta: number, start = widths): number[] {
    const next = [...start]
    const adjustment = Math.max(18 - next[index], Math.min(next[index + 1] - 18, delta))
    next[index] += adjustment
    next[index + 1] -= adjustment
    latest.current = next
    setWidths(next)
    return next
  }
  return (
    <div
      className="px-panes"
      ref={frame}
      style={{ gridTemplateColumns: `${widths[0]}fr 8px ${widths[1]}fr 8px ${widths[2]}fr` }}
    >
      {Children.toArray(children).flatMap((child, index) =>
        index === 2
          ? [child]
          : [
              child,
              <div
                key={`divider-${index}`}
                className="px-divider"
                role="separator"
                tabIndex={0}
                aria-label={`${name} ${index + 1} 칸 너비`}
                aria-orientation="vertical"
                aria-valuemin={18}
                aria-valuemax={64}
                aria-valuenow={Math.round(widths[index])}
                onKeyDown={(event) => {
                  if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
                    event.preventDefault()
                    onSave(change(index, event.key === 'ArrowRight' ? 2 : -2))
                  }
                }}
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.currentTarget.setPointerCapture(event.pointerId)
                  drag.current = { index, x: event.clientX, widths: [...widths] }
                }}
                onPointerMove={(event) => {
                  if (drag.current && frame.current)
                    change(
                      drag.current.index,
                      ((event.clientX - drag.current.x) / frame.current.clientWidth) * 100,
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
                    drag.current = null
                  }
                }}
              />
            ]
      )}
    </div>
  )
}

export function SortableItems({
  ids,
  onReorder,
  children
}: {
  ids: string[]
  onReorder: (ids: string[]) => void
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
        const from = ids.indexOf(String(active.id)),
          to = ids.indexOf(String(over.id))
        if (from >= 0 && to >= 0) onReorder(arrayMove(ids, from, to))
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
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
                aria-pressed={value.aspectRatio === ratio}
                onClick={() => onChange({ ...value, aspectRatio: ratio })}
              >
                {ratio}
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
          가로:세로 {value.aspectRatio} · {value.size}
        </small>
      )}
    </fieldset>
  )
}

export function PromptFields({
  prompt,
  negativePrompt,
  onChange
}: {
  prompt: string
  negativePrompt: string
  onChange: (value: { prompt: string; negativePrompt: string }) => void
}): React.JSX.Element {
  return (
    <>
      <label>
        프롬프트
        <textarea
          value={prompt}
          onChange={(event) => onChange({ prompt: event.target.value, negativePrompt })}
        />
      </label>
      <label>
        네거티브
        <textarea
          value={negativePrompt}
          onChange={(event) => onChange({ prompt, negativePrompt: event.target.value })}
        />
      </label>
    </>
  )
}
