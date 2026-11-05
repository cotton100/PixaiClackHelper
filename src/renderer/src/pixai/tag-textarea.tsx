import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ComponentProps } from 'react'
import type { IpcInvokeMap } from '@shared/types'
import { caretCoords } from '../lib/caret'
import { completeTag, tagPopupPosition, tagToken, type TagToken } from './tag-completion'
import './tag-textarea.css'

type Tag = IpcInvokeMap['tags:search']['res']['items'][number]
type Selection = { text: string; start: number; end: number }
type Results = Selection & { token: TagToken; items: Tag[] }
const category: Record<string, string> = {
  general: '일반',
  artist: '작가',
  character: '캐릭터',
  copyright: '작품',
  meta: '메타'
}

/** Native textarea editing with the inherited NAIS offline tag dictionary. */
export function TagTextarea({
  value,
  onValueChange,
  ...props
}: Omit<ComponentProps<'textarea'>, 'value' | 'onChange'> & {
  value: string
  onValueChange: (value: string) => void
}): React.JSX.Element {
  const input = useRef<HTMLTextAreaElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const sequence = useRef(0)
  const composing = useRef(false)
  const selection = useRef<Selection | null>(null)
  const [results, setResults] = useState<Results | null>(null)
  const [active, setActive] = useState(0)
  const [position, setPosition] = useState<ReturnType<typeof tagPopupPosition> | null>(null)
  const id = useId()

  function dismiss(): void {
    clearTimeout(timer.current)
    sequence.current++
    setResults(null)
  }

  function refresh(): void {
    dismiss()
    const ta = input.current
    if (!ta) return
    const current = { text: ta.value, start: ta.selectionStart, end: ta.selectionEnd }
    selection.current = current
    if (composing.current || ta.readOnly || ta.disabled || document.activeElement !== ta) return
    const token = tagToken(current.text, current.start, current.end)
    if (!token) return
    const seq = sequence.current
    timer.current = setTimeout(async () => {
      try {
        const { items } = await window.nais.invoke('tags:search', { query: token.query, limit: 8 })
        if (
          sequence.current !== seq ||
          !ta.isConnected ||
          document.activeElement !== ta ||
          ta.value !== current.text ||
          ta.selectionStart !== current.start ||
          ta.selectionEnd !== current.end ||
          composing.current
        )
          return
        if (!items.length) return
        const caret = caretCoords(ta, current.start)
        const rect = ta.getBoundingClientRect()
        setPosition(
          tagPopupPosition(
            {
              left: rect.left + caret.left - ta.scrollLeft,
              top: Math.max(
                rect.top,
                Math.min(rect.bottom - caret.height, rect.top + caret.top - ta.scrollTop)
              ),
              height: caret.height
            },
            { width: window.innerWidth, height: window.innerHeight },
            items.length
          )
        )
        setActive(0)
        setResults({ ...current, token, items })
      } catch {
        // An unavailable dictionary must never block normal typing or produce an unhandled rejection.
        if (sequence.current === seq) setResults(null)
      }
    }, 90)
  }

  function complete(tag: Tag): void {
    const ta = input.current
    if (!ta || !results || composing.current) return
    if (
      ta.value !== results.text ||
      ta.selectionStart !== results.start ||
      ta.selectionEnd !== results.end
    ) {
      dismiss()
      return
    }
    const next = completeTag(value, results.token, tag.tag)
    dismiss()
    selection.current = { text: next.value, start: next.cursor, end: next.cursor }
    onValueChange(next.value)
    requestAnimationFrame(() => {
      if (ta.isConnected && document.activeElement === ta && ta.value === next.value) {
        ta.setSelectionRange(next.cursor, next.cursor)
      }
    })
  }

  useEffect(() => {
    // Switching library items / importing a backup cannot leave another item's suggestions open.
    if (selection.current?.text !== value) dismiss()
  }, [value])
  useEffect(
    () => () => {
      clearTimeout(timer.current)
      sequence.current++
    },
    []
  )
  useEffect(() => {
    if (!results) return
    const closeOnScroll = (event: Event): void => {
      if (event.target instanceof Node && popup.current?.contains(event.target)) return
      dismiss()
    }
    const closeOutside = (event: PointerEvent): void => {
      if (
        event.target === input.current ||
        (event.target instanceof Node && popup.current?.contains(event.target))
      )
        return
      dismiss()
    }
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', closeOnScroll, true)
    document.addEventListener('pointerdown', closeOutside)
    return () => {
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', closeOnScroll, true)
      document.removeEventListener('pointerdown', closeOutside)
    }
  }, [results])
  useEffect(() => {
    popup.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  const visible = results && results.text === value && position
  return (
    <>
      <textarea
        {...props}
        ref={input}
        value={value}
        spellCheck={false}
        autoComplete="off"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-controls={visible ? id : undefined}
        aria-activedescendant={visible ? `${id}-${active}` : undefined}
        onChange={(event) => {
          onValueChange(event.target.value)
          refresh()
        }}
        onSelect={() => {
          const ta = input.current
          const last = selection.current
          if (
            ta &&
            (!last ||
              last.text !== ta.value ||
              last.start !== ta.selectionStart ||
              last.end !== ta.selectionEnd)
          )
            refresh()
        }}
        onBlur={dismiss}
        onScroll={dismiss}
        onCompositionStart={() => {
          composing.current = true
          dismiss()
        }}
        onCompositionEnd={() => {
          composing.current = false
          refresh()
        }}
        onKeyDown={(event) => {
          if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return
          if (event.key === 'Escape') {
            if (results) {
              event.preventDefault()
              event.stopPropagation()
            }
            dismiss()
            return
          }
          if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
            dismiss()
            return
          }
          if (!results) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setActive(
              (index) =>
                (index + (event.key === 'ArrowDown' ? 1 : -1) + results.items.length) %
                results.items.length
            )
          } else if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault()
            complete(results.items[active])
          } else dismiss()
        }}
      />
      {visible &&
        createPortal(
          <div ref={popup} className="px-tag-popup" style={position}>
            <div id={id} role="listbox" aria-label="태그 자동완성" className="px-tag-list">
              {results.items.map((tag, index) => (
                <button
                  key={tag.tag}
                  type="button"
                  id={`${id}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  data-index={index}
                  tabIndex={-1}
                  title={`${tag.tag} · ${category[tag.type] ?? tag.type} · ${tag.count.toLocaleString()}건`}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => complete(tag)}
                >
                  <span className="px-tag-name">{tag.tag}</span>
                  <span className="px-tag-category" data-kind={tag.type}>
                    {category[tag.type] ?? tag.type}
                  </span>
                  <span className="px-tag-count">
                    {new Intl.NumberFormat('en', {
                      notation: 'compact',
                      maximumFractionDigits: 1
                    }).format(tag.count)}
                  </span>
                </button>
              ))}
            </div>
            <div className="px-tag-help">↑↓ 이동 · Tab/Enter 삽입 · Esc 닫기</div>
          </div>,
          document.body
        )}
    </>
  )
}
