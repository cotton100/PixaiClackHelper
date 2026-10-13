import { useId, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

// Presentation only: never write a workspace, reservation or generation option on toggle.
export function ComposeGroup({
  id,
  title,
  summary,
  defaultOpen = false,
  children
}: {
  id: string
  title: string
  summary: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}): React.JSX.Element {
  const bodyId = useId()
  const key = `pixais.compose-group.${id}.v1`
  const [open, setOpen] = useState(() => {
    try {
      const value = localStorage.getItem(key)
      return value === 'true' ? true : value === 'false' ? false : defaultOpen
    } catch {
      return defaultOpen
    }
  })
  const [notice, setNotice] = useState('')
  return (
    <section className="px-compose-group" data-compose-group={id}>
      <button
        className="px-compose-group-toggle"
        aria-label={`${title} 접기·펼치기`}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => {
          setOpen(!open)
          try {
            localStorage.setItem(key, String(!open))
            setNotice('')
          } catch {
            setNotice('접기 상태를 기억하지 못했습니다. 현재 선택값은 유지됩니다.')
          }
        }}
      >
        <ChevronRight size={17} aria-hidden="true" />
        <span className="px-compose-group-copy">
          <strong>{title}</strong>
          <span className="px-compose-group-value" aria-label={`${title} 현재 선택`}>
            {summary}
          </span>
        </span>
      </button>
      {notice && <small role="status">{notice}</small>}
      <div id={bodyId} hidden={!open} className="px-compose-group-body">
        {children}
      </div>
    </section>
  )
}
