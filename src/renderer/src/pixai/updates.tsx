import { useEffect, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import { compareVersions, type UpdateStatus } from '@shared/pixai/updates'

export function AppUpdates(): React.JSX.Element {
  const browser = !window.nais || window.nais.runtime === 'browser'
  const [state, setState] = useState<UpdateStatus | null>(null)
  const [selected, setSelected] = useState('')
  const [preview, setPreview] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const polling = busy || state?.phase === 'installing'
  useEffect(() => {
    if (browser) return
    let live = true
    const refresh = (): void => {
      void window.nais
        .invoke('pixai:update-status', {})
        .then((value) => {
          if (live) setState(value)
        })
        .catch(() => {
          if (live) setError('업데이트 상태를 읽지 못했습니다.')
        })
    }
    refresh()
    const timer = polling ? setInterval(refresh, 1500) : undefined
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [browser, polling])
  async function run(action: () => Promise<UpdateStatus>): Promise<void> {
    if (busy) return
    setBusy(true)
    setError('')
    setConfirmed(false)
    try {
      setState(await action())
    } catch (e) {
      setError(e instanceof Error ? e.message : '업데이트 작업에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }
  const locked = busy || ['checking', 'downloading', 'installing'].includes(state?.phase ?? '')
  const checked = !!state?.releases.length && state.phase !== 'error' && !error
  const newerReleases =
    state?.releases.filter(
      (item) => !item.prerelease && compareVersions(item.version, state.currentVersion) > 0
    ) ?? []
  const canUpdate = checked && newerReleases.some((item) => item.available)
  const visible = state?.releases.filter((release) => preview || !release.prerelease) ?? []
  const release = visible.find((item) => item.version === selected)
  const older = release && state && compareVersions(release.version, state.currentVersion) < 0
  const ready = state?.phase === 'ready' && selected === state.selectedVersion
  return (
    <section className="px-pane px-updates">
      <header>
        <h2>앱 업데이트 · 버전 선택</h2>
        <span>{state ? `현재 ${state.currentVersion}` : 'PixaiClackHelper'}</span>
      </header>
      <p>업데이트를 확인한 뒤 새 정식 버전이 있으면 자료를 백업하고 설치·재시작합니다.</p>
      {browser ? (
        <p>Windows 설치 앱에서 사용할 수 있습니다.</p>
      ) : (
        <>
          <div className="px-toolbar">
            <button
              disabled={locked || state?.phase === 'ready'}
              onClick={() => void run(() => window.nais.invoke('pixai:update-check', {}))}
            >
              <RefreshCw size={16} />
              업데이트 확인
            </button>
            <button
              className="px-primary"
              disabled={locked || !state?.supported || !canUpdate}
              onClick={() => void run(() => window.nais.invoke('pixai:update-latest', {}))}
            >
              <Download size={16} />
              최신 버전으로 업데이트
            </button>
          </div>
          {!locked && checked && newerReleases.length === 0 && (
            <p role="status">현재 버전보다 새로운 정식 버전이 없습니다.</p>
          )}
          {!locked && checked && newerReleases.length > 0 && !canUpdate && (
            <p role="status">새 정식 버전의 앱 내 설치 파일이 아직 제공되지 않았습니다.</p>
          )}
          <small>
            실행 중인 생성·저장을 먼저 마쳐 주세요. 설치 중 앱이 종료되며 Windows 권한 확인이 나올
            수 있습니다.
          </small>
          <details>
            <summary>다른 버전 선택 · 변경 내용</summary>
            <div className="px-toolbar">
              <label className="px-check">
                <input
                  type="checkbox"
                  checked={preview}
                  disabled={locked}
                  onChange={(e) => {
                    setPreview(e.target.checked)
                    setSelected('')
                    setConfirmed(false)
                  }}
                />
                시험판도 표시
              </label>
            </div>
            <p className="px-hint">최근 100개 공개 릴리스 · 기본은 정식 버전만 표시합니다.</p>
            <div className="px-release-list" aria-label="출시 버전 목록">
              {visible.map((item) => (
                <button
                  key={item.tag}
                  aria-pressed={selected === item.version}
                  disabled={locked}
                  onClick={() => {
                    setSelected(item.version)
                    setConfirmed(false)
                    setError('')
                  }}
                >
                  <strong>
                    {item.version}
                    {item.version === state?.currentVersion ? ' · 사용 중' : ''}
                    {item.prerelease ? ' · 시험판' : ''}
                  </strong>
                  <small>
                    {item.date.slice(0, 10)}
                    {!item.available ? ' · 앱 내 설치 파일 미제공' : ''}
                  </small>
                </button>
              ))}
            </div>
            {release && (
              <div className="px-confirm">
                <h3>{release.version} 변경 내용</h3>
                <p className="px-release-notes">
                  {release.notes || '등록된 변경 설명이 없습니다.'}
                </p>
                {older && (
                  <p>
                    이전 버전으로 돌아갑니다. 현재 자료를 읽을 수 있는 버전만 설치할 수 있습니다.
                  </p>
                )}
                {release.prerelease && (
                  <p>시험판입니다. 작업용 자료로 사용하기 전에 변경 내용을 확인해 주세요.</p>
                )}
                <button
                  disabled={
                    locked ||
                    !state?.supported ||
                    !release.available ||
                    release.version === state.currentVersion ||
                    ready
                  }
                  onClick={() =>
                    void run(() =>
                      window.nais.invoke('pixai:update-download', { version: release.version })
                    )
                  }
                >
                  <Download size={16} />
                  선택한 버전 받기
                </button>
              </div>
            )}
            {state?.phase === 'ready' && (
              <div className="px-confirm">
                <strong>{state.selectedVersion} 설치 준비 완료</strong>
                <p>
                  진행 중인 생성·저장을 마친 뒤 설치하세요. 설치 직전에 현재 작업 공간을 로컬
                  백업하고 앱을 종료합니다.
                </p>
                <label className="px-check">
                  <input
                    type="checkbox"
                    aria-label="버전 변경 설치 확인"
                    checked={confirmed}
                    disabled={locked || !ready}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  선택한 {state.selectedVersion} 버전으로 변경하겠습니다.
                </label>
                <button
                  className="px-primary"
                  disabled={locked || !ready || !confirmed}
                  onClick={() =>
                    void run(() => window.nais.invoke('pixai:update-install', { confirmed: true }))
                  }
                >
                  백업 후 설치·재시작
                </button>
              </div>
            )}
          </details>
          {state?.phase === 'downloading' && (
            <p role="status">
              {state.selectedVersion} 다운로드 {Math.round(state.percent)}%
            </p>
          )}
          {state?.phase === 'installing' && <p role="status">백업·설치 후 앱을 다시 엽니다…</p>}
          {state?.message && <p role="status">{state.message}</p>}
          {state?.backupPath && <p>설치 전 백업: {state.backupPath}</p>}
          {error && (
            <p role="alert" className="px-error">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  )
}
