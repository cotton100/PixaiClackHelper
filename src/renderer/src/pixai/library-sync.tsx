import { useEffect, useRef, useState } from 'react'
import type { LibrarySyncStatus } from '@shared/pixai/execution'
import { t, useT } from '../lib/i18n'
import type { PixaiStore } from './store'
import { useUnsavedEditors } from './unsaved-editors'
import { applyLibrarySync } from './library-sync-apply'
import './library-sync.css'

function readSyncStatus(value: unknown): LibrarySyncStatus {
  const status = value as LibrarySyncStatus | undefined
  const proposal = status?.exchange?.proposal
  if (
    !status ||
    typeof status.enabled !== 'boolean' ||
    typeof status.listening !== 'boolean' ||
    typeof status.paired !== 'boolean' ||
    !['idle', 'preview', 'apply', 'blocked'].includes(status.exchange?.state) ||
    (proposal &&
      (typeof proposal.id !== 'string' ||
        typeof proposal.initial !== 'boolean' ||
        ![proposal.appCount, proposal.scriptCount, proposal.mergedCount].every(
          Number.isSafeInteger
        ) ||
        !Array.isArray(proposal.conflicts) ||
        proposal.conflicts.some(
          (item) => !item || typeof item.key !== 'string' || typeof item.label !== 'string'
        )))
  )
    throw new Error(t('pixai.sync.unavailable'))
  return status
}

/** Kept mounted across tabs; main never writes the workspace behind its renderer. */
export function LibrarySyncController({ store }: { store: PixaiStore }): null {
  const guard = useUnsavedEditors()
  useEffect(() => {
    if (!window.nais || window.nais.runtime === 'browser' || !window.nais.on) return
    return window.nais.on('pixai:library-sync-apply', ({ id, expected, next, expiresAt }) => {
      void (async () => {
        let error: string | undefined
        try {
          if (!Number.isFinite(expiresAt)) throw new Error(t('pixai.sync.expiredRequest'))
          await applyLibrarySync(store, expected, next, guard.hasDirty, expiresAt)
        } catch (failure) {
          error = failure instanceof Error ? failure.message : t('pixai.sync.failed')
        }
        // A lost reply is recovered by the transport's persisted pending transaction.
        await window.nais
          .invoke('pixai:library-sync-applied', { id, ok: !error, ...(error ? { error } : {}) })
          .catch(() => {})
      })()
    })
  }, [store, guard])
  return null
}

export function LibrarySyncSettings({ store }: { store: PixaiStore }): React.JSX.Element | null {
  const tr = useT()
  const { ready, busy, draftSaving, conflict } = store()
  const [status, setStatus] = useState<LibrarySyncStatus | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)
  const sequence = useRef(0)
  const [now, setNow] = useState(Date.now)
  const [selection, setSelection] = useState<{
    id: string
    choices: Record<string, 'app' | 'script'>
  }>({ id: '', choices: {} })
  const browser = !window.nais || window.nais.runtime === 'browser'
  useEffect(() => {
    if (browser) return
    let live = true
    let timer: ReturnType<typeof setTimeout>
    async function refresh(): Promise<void> {
      if (!pendingRef.current) {
        const request = ++sequence.current
        try {
          const value = readSyncStatus(await window.nais.invoke('pixai:library-sync-status', {}))
          if (live && request === sequence.current) {
            setStatus(value)
            setNow(Date.now())
          }
        } catch {
          if (live && request === sequence.current) setError(t('pixai.sync.unavailable'))
        }
      }
      if (live) timer = setTimeout(() => void refresh(), 3000)
    }
    void refresh()
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [browser])
  if (browser) return null
  const disabled = pending || !ready || busy || draftSaving || conflict
  const proposal =
    status && ['preview', 'blocked'].includes(status.exchange.state)
      ? status.exchange.proposal
      : undefined
  const choices = selection.id === proposal?.id ? selection.choices : {}
  const resolved = proposal?.conflicts.every(({ key }) => !!choices[key]) ?? false
  const remaining = Math.max(0, Math.ceil(((status?.expiresAt ?? 0) - now) / 1000))
  async function action(run: () => Promise<LibrarySyncStatus>): Promise<void> {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setError('')
    const request = ++sequence.current
    try {
      const value = readSyncStatus(await run())
      if (request === sequence.current) {
        setStatus(value)
        setNow(Date.now())
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : tr('pixai.sync.failed'))
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }
  return (
    <section className="px-pane px-library-sync" aria-label={tr('pixai.sync.title')}>
      <h2>{tr('pixai.sync.title')}</h2>
      <p>{tr('pixai.sync.scope')}</p>
      <label className="px-check">
        <input
          type="checkbox"
          checked={status?.enabled ?? false}
          disabled={pending || !status}
          onChange={(event) =>
            void action(() =>
              window.nais.invoke('pixai:library-sync-enable', { enabled: event.target.checked })
            )
          }
        />
        {tr('pixai.sync.enable')}
      </label>
      <p role="status" className="px-sync-status">
        {!status
          ? tr('pixai.sync.loading')
          : !status.enabled
            ? tr('pixai.sync.off')
            : !status.listening
              ? tr('pixai.sync.unavailable')
              : status.paired
                ? tr('pixai.sync.paired')
                : tr('pixai.sync.unpaired')}
        {status?.lastSyncedAt && (
          <small>{tr('pixai.sync.lastSync', new Date(status.lastSyncedAt).toLocaleString())}</small>
        )}
      </p>
      {status?.enabled && (
        <>
          <div className="px-toolbar">
            <button
              disabled={pending || !status.listening}
              onClick={() => void action(() => window.nais.invoke('pixai:library-sync-pair', {}))}
            >
              {status.paired ? tr('pixai.sync.replacePair') : tr('pixai.sync.newCode')}
            </button>
            {status.paired && (
              <>
                <button
                  disabled={disabled || !status.listening || status.exchange.state === 'apply'}
                  onClick={() =>
                    void action(() => window.nais.invoke('pixai:library-sync-request', {}))
                  }
                >
                  {tr('pixai.sync.sync')}
                </button>
                <button
                  disabled={pending}
                  onClick={() =>
                    void action(() => window.nais.invoke('pixai:library-sync-disconnect', {}))
                  }
                >
                  {tr('pixai.sync.disconnect')}
                </button>
              </>
            )}
          </div>
          <small>{tr('pixai.sync.pairHelp')}</small>
          {status.code && (
            <div className="px-sync-code">
              <label>
                {tr('pixai.sync.code')}
                <input readOnly value={remaining ? status.code : ''} spellCheck={false} />
              </label>
              <small>
                {remaining ? tr('pixai.sync.expires', remaining) : tr('pixai.sync.expired')}
              </small>
            </div>
          )}
          <p>{tr('pixai.sync.autoHelp')}</p>
        </>
      )}
      {proposal && (
        <div className="px-sync-preview">
          <h3>{proposal.initial ? tr('pixai.sync.firstPreview') : tr('pixai.sync.preview')}</h3>
          <dl className="px-sync-counts">
            <div>
              <dt>{tr('pixai.sync.app')}</dt>
              <dd>{proposal.appCount}</dd>
            </div>
            <div>
              <dt>{tr('pixai.sync.script')}</dt>
              <dd>{proposal.scriptCount}</dd>
            </div>
            <div>
              <dt>{tr('pixai.sync.result')}</dt>
              <dd>
                {proposal.conflicts.length ? tr('pixai.sync.unresolved') : proposal.mergedCount}
              </dd>
            </div>
          </dl>
          <p>{proposal.initial ? tr('pixai.sync.firstHelp') : tr('pixai.sync.previewHelp')}</p>
          {proposal.conflicts.length > 0 && <p>{tr('pixai.sync.conflictsHelp')}</p>}
          {proposal.conflicts.map((item, index) => (
            <fieldset className="px-sync-conflict" key={item.key} disabled={disabled}>
              <legend>{item.label}</legend>
              <div className="px-sync-values">
                {(['app', 'script'] as const).map((side) => (
                  <label key={side}>
                    <span className="px-check">
                      <input
                        type="radio"
                        name={`library-sync-${proposal.id}-${index}`}
                        checked={choices[item.key] === side}
                        onChange={() =>
                          setSelection({
                            id: proposal.id,
                            choices: { ...choices, [item.key]: side }
                          })
                        }
                      />
                      {side === 'app' ? tr('pixai.sync.useApp') : tr('pixai.sync.useScript')}
                    </span>
                    <pre>
                      {item[side] === null
                        ? tr('pixai.sync.deleted')
                        : JSON.stringify(item[side], null, 2)}
                    </pre>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <div className="px-toolbar">
            <button
              className="px-primary"
              disabled={disabled || !resolved}
              onClick={() =>
                void action(() =>
                  window.nais.invoke('pixai:library-sync-approve', { id: proposal.id, choices })
                )
              }
            >
              {tr('pixai.sync.apply')}
            </button>
            <button
              disabled={pending}
              onClick={() =>
                void action(() =>
                  window.nais.invoke('pixai:library-sync-cancel', { id: proposal.id })
                )
              }
            >
              {tr('pixai.sync.cancel')}
            </button>
          </div>
        </div>
      )}
      {status?.exchange.state === 'apply' && <p role="status">{tr('pixai.sync.pending')}</p>}
      {pending && <p role="status">{tr('pixai.sync.waiting')}</p>}
      {(error || status?.message || status?.exchange.message) && (
        <p className="px-error" role="alert">
          {error || status?.message || status?.exchange.message}
        </p>
      )}
    </section>
  )
}
