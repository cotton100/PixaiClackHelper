import { useEffect, useRef, useState, type ReactNode } from 'react'
import './scene-material-split.css'

const storageKey = 'pixais.scene-material-split.v1'

function minimumRatio(height: number): number {
  return height > 0 ? Math.min(50, Math.max(25, (220 / height) * 100)) : 25
}

function clamp(value: number, height = 0): number {
  const minimum = minimumRatio(height)
  return Math.max(minimum, Math.min(100 - minimum, value))
}

function readRatio(): number {
  try {
    const value = Number(localStorage.getItem(storageKey))
    return Number.isFinite(value) && value >= 25 && value <= 75 ? value : 50
  } catch {
    return 50
  }
}

// Layout preference only. Never change the workspace or generation options.
export function SceneMaterialSplit({
  children
}: {
  children: [ReactNode, ReactNode]
}): React.JSX.Element {
  const [ratio, setRatio] = useState(readRatio)
  const [height, setHeight] = useState(0)
  const [notice, setNotice] = useState('')
  const frame = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    pointerId: number
    y: number
    ratio: number
    previous: number
    height: number
  } | null>(null)
  const displayedRatio = clamp(ratio, height)

  useEffect(() => {
    if (!frame.current) return
    setHeight(Math.max(0, frame.current.getBoundingClientRect().height - 8))
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      setHeight(Math.max(0, entry.contentRect.height - 8))
    })
    observer.observe(frame.current)
    return () => observer.disconnect()
  }, [])

  function save(value: number): void {
    setRatio(value)
    try {
      localStorage.setItem(storageKey, String(value))
      setNotice('')
    } catch {
      setNotice('칸 높이를 기억하지 못했습니다. 현재 배치는 유지됩니다.')
    }
  }

  function at(clientY: number): number {
    const start = drag.current!
    return clamp(start.ratio + ((clientY - start.y) / start.height) * 100, start.height)
  }

  function cancel(): void {
    if (!drag.current) return
    setRatio(drag.current.previous)
    drag.current = null
  }

  return (
    <div
      className="px-scene-material-split"
      ref={frame}
      style={{
        gridTemplateRows: `minmax(0, ${displayedRatio}fr) 8px minmax(0, ${100 - displayedRatio}fr)`
      }}
    >
      <div className="px-scene-material-slot">{children[0]}</div>
      <div
        className="px-scene-material-divider"
        role="separator"
        tabIndex={0}
        aria-label="캐릭터·추가 청크 높이"
        aria-orientation="horizontal"
        aria-valuemin={Math.round(minimumRatio(height))}
        aria-valuemax={Math.round(100 - minimumRatio(height))}
        aria-valuenow={Math.round(displayedRatio)}
        aria-valuetext={`캐릭터 ${Math.round(displayedRatio)}%, 추가 청크 ${Math.round(100 - displayedRatio)}%`}
        title="드래그 또는 위·아래 방향키로 높이 조절 · Home으로 반반 배치"
        onKeyDown={(event) => {
          if (drag.current || !['ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return
          event.preventDefault()
          const next =
            event.key === 'Home'
              ? 50
              : clamp(displayedRatio + (event.key === 'ArrowDown' ? 2 : -2), height)
          if (next !== displayedRatio || (event.key === 'Home' && ratio !== 50)) save(next)
        }}
        onPointerDown={(event) => {
          if (drag.current || event.button !== 0) return
          const height = (frame.current?.getBoundingClientRect().height ?? 0) - 8
          if (height <= 0) return
          event.preventDefault()
          event.currentTarget.focus()
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = {
            pointerId: event.pointerId,
            y: event.clientY,
            ratio: clamp(ratio, height),
            previous: ratio,
            height
          }
        }}
        onPointerMove={(event) => {
          if (drag.current?.pointerId === event.pointerId) setRatio(at(event.clientY))
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointerId !== event.pointerId) return
          const next = at(event.clientY)
          const start = drag.current
          drag.current = null
          if (next !== start.ratio) save(next)
          else setRatio(start.previous)
        }}
        onPointerCancel={(event) => {
          if (drag.current?.pointerId === event.pointerId) cancel()
        }}
        onLostPointerCapture={(event) => {
          if (drag.current?.pointerId === event.pointerId) cancel()
        }}
      />
      <div className="px-scene-material-slot">{children[1]}</div>
      {notice && (
        <small className="px-scene-material-notice" role="status">
          {notice}
        </small>
      )}
    </div>
  )
}
