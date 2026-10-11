import { useEffect, useRef, useState } from 'react'

/** Save/discard/cancel also keeps the current editor mounted if persistence fails. */
interface UnsavedNavigation {
  register(dirty: boolean, save: () => Promise<boolean>, discard?: () => void): () => void
  request(action: () => void): void
  dialog: React.JSX.Element | null
}
export function useUnsavedNavigation(): UnsavedNavigation {
  const editors = useRef(
    new Set<{ dirty: boolean; save: () => Promise<boolean>; discard?: () => void }>()
  )
  const next = useRef<(() => void) | null>(null)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => previous?.focus()
  }, [open])
  function proceed(): void {
    const action = next.current
    next.current = null
    setOpen(false)
    action?.()
  }
  return {
    register(dirty: boolean, save: () => Promise<boolean>, discard?: () => void): () => void {
      const entry = { dirty, save, discard }
      editors.current.add(entry)
      return () => {
        editors.current.delete(entry)
      }
    },
    request(action: () => void): void {
      if (![...editors.current].some((entry) => entry.dirty)) {
        action()
        return
      }
      next.current = action
      setOpen(true)
    },
    dialog: open ? (
      <div className="px-unsaved-overlay">
        <div
          ref={dialogRef}
          className="px-confirm px-unsaved-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-label="저장하지 않은 변경"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !saving) {
              next.current = null
              setOpen(false)
            }
            if (event.key === 'Tab') {
              const buttons = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
              ]
              const first = buttons[0],
                last = buttons.at(-1)
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault()
                last?.focus()
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault()
                first?.focus()
              }
            }
          }}
        >
          <p>저장하지 않은 변경이 있습니다.</p>
          <div className="px-toolbar">
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setSaving(true)
                void (async () => {
                  try {
                    let ok = true
                    for (const entry of [...editors.current]) {
                      if (entry.dirty && !(await entry.save())) {
                        ok = false
                        break
                      }
                    }
                    if (ok) proceed()
                  } finally {
                    setSaving(false)
                  }
                })()
              }}
            >
              저장하고 이동
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                for (const entry of editors.current) if (entry.dirty) entry.discard?.()
                proceed()
              }}
            >
              버리고 이동
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                next.current = null
                setOpen(false)
              }}
            >
              취소
            </button>
          </div>
        </div>
      </div>
    ) : null
  }
}
