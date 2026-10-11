import { RatioMark } from './ratio-mark'
import { useEffect, useState } from 'react'
import type { ConnectionStatus, JobState, RunnerStatus } from '@shared/pixai/execution'
import type { PixaiStore } from './store'

const labels: Record<JobState, string> = {
  queued: '제출 대기',
  submitting: '제출 중',
  submission_unknown: '제출 결과 확인 필요',
  waiting: '서버 생성 중',
  saving: '이미지 저장 중',
  check_required: '작업 조회 재개 필요',
  save_failed: '저장 재개 필요',
  failed: '실패 · 자동 재생성 안 함',
  done: '저장 완료',
  cancelled: '제외됨'
}
export function ApiConnection(): React.JSX.Element {
  const [state, setState] = useState<ConnectionStatus | null>(null)
  const [key, setKey] = useState(''),
    [remember, setRemember] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const browser = !window.nais || window.nais.runtime === 'browser'
  useEffect(() => {
    if (!browser)
      void window.nais
        .invoke('pixai:connection', {})
        .then((value) => {
          setState(value)
          setRemember(value.remembered)
        })
        .catch(() => setError('API 연결 상태를 읽지 못했습니다.'))
  }, [browser])
  async function action(run: () => Promise<ConnectionStatus>): Promise<void> {
    setBusy(true)
    setError('')
    try {
      const value = await run()
      setState(value)
      setRemember(value.remembered)
    } catch (e) {
      setError(e instanceof Error ? e.message : '변경 실패')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="px-pane px-api-connection">
      <h2>공식 API 연결</h2>
      {browser ? (
        <p>API 생성과 폴더 저장은 설치한 PixaiClackHelper 앱에서 사용할 수 있습니다.</p>
      ) : (
        <>
          <p role="status">
            {state?.connected
              ? `키 연결됨 · ${state.remembered ? '이 PC에 보호 저장됨' : '이번 실행에서만 사용'}`
              : '키 미연결'}
          </p>
          <label>
            공식 API 키
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
          <label className="px-check">
            <input
              type="checkbox"
              checked={remember}
              disabled={!state?.encryptionAvailable}
              onChange={(e) => setRemember(e.target.checked)}
            />
            이 PC에 키 기억하기 (OS 보호 저장)
          </label>
          <small>
            기본은 앱 종료 시 해제입니다. 키는 설정 내보내기·로그·이미지 서버로 보내지 않습니다. PC
            계정에 접근할 수 있는 프로그램까지 막아 주는 기능은 아닙니다.
          </small>
          <div className="px-toolbar">
            <button
              disabled={busy || !key}
              onClick={() =>
                void action(async () => {
                  try {
                    return await window.nais.invoke('pixai:connect', { key, remember })
                  } finally {
                    setKey('')
                  }
                })
              }
            >
              키 연결
            </button>
            <button
              disabled={busy || !state}
              onClick={() => void action(() => window.nais.invoke('pixai:forget', {}))}
            >
              연결 해제·저장된 키 삭제
            </button>
          </div>
          <h3>이미지 저장 폴더</h3>
          <p className="px-path">{state?.outputDir || '폴더 미선택'}</p>
          <button
            disabled={busy}
            onClick={() => void action(() => window.nais.invoke('pixai:folder', {}))}
          >
            저장 폴더 선택
          </button>
          <label>
            동시에 진행할 작업 수
            <select
              value={state?.maxInFlight ?? 2}
              disabled={busy || !state}
              onChange={(e) =>
                void action(() =>
                  window.nais.invoke('pixai:concurrency', { count: Number(e.target.value) })
                )
              }
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}개
                </option>
              ))}
            </select>
          </label>
          <small>
            작업 상태는 5초 간격으로 확인합니다. 자동 저장은 이미지 파일만 만들며 JSON 부속 파일을
            만들지 않습니다.
          </small>
        </>
      )}
      {error && (
        <p role="alert" className="px-error">
          {error}
        </p>
      )}
    </section>
  )
}
export function ExecutionQueue({ store }: { store: PixaiStore }): React.JSX.Element {
  const { workspace, busy } = store()
  const [status, setStatus] = useState<RunnerStatus | null>(null),
    [error, setError] = useState(''),
    [working, setWorking] = useState(false)
  const [confirm, setConfirm] = useState(false),
    [relocate, setRelocate] = useState(false),
    [dismiss, setDismiss] = useState(''),
    [costs, setCosts] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [remove, setRemove] = useState<string[]>([])
  const browser = !window.nais || window.nais.runtime === 'browser'
  useEffect(() => {
    if (browser) return
    let live = true,
      timer: ReturnType<typeof setTimeout>
    const load = async (): Promise<void> => {
      try {
        const value = await window.nais.invoke('pixai:status', {})
        if (live) setStatus(value)
      } catch {
        if (live) setError('실행 상태를 확인하지 못했습니다. 다시 열어 주세요.')
      } finally {
        if (live) timer = setTimeout(() => void load(), 1000)
      }
    }
    void load()
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [browser])
  const records = new Map(status?.jobs.map((job) => [job.id, job]))
  const items = [
    ...workspace.jobs.map((job) => ({
      id: job.request.id,
      title: job.request.title,
      prompt: job.request.prompt,
      ratio: job.request.imageOptions?.aspectRatio ?? String(job.options.api?.aspectRatio ?? '1:1'),
      images: job.imageCount
    })),
    ...(status?.jobs ?? [])
      .filter(
        (job) =>
          !workspace.jobs.some((local) => local.request.id === job.id) &&
          !['done', 'cancelled', 'failed'].includes(job.state)
      )
      .map((job) => ({
        id: job.id,
        title: job.title,
        prompt: job.payload.prompt,
        ratio: job.payload.aspectRatio,
        images: job.payload.batchSize
      }))
  ]
  const newJobs = items.filter(
    (job) => !records.has(job.id) || records.get(job.id)?.state === 'queued'
  )
  const removable = (id: string): boolean =>
    !records.has(id) || ['done', 'queued', 'cancelled', 'failed'].includes(records.get(id)!.state)
  async function action(run: () => Promise<void>): Promise<void> {
    setWorking(true)
    setError('')
    try {
      await run()
    } catch (e) {
      setError(e instanceof Error ? e.message : '실행 실패')
    } finally {
      setWorking(false)
    }
  }
  const disabled = busy || working || (!browser && !status)
  return (
    <section className="px-pane px-queue">
      <header>
        <h2>생성 대기열</h2>
        <div className="px-toolbar">
          <button
            className="px-primary"
            disabled={browser || disabled || status?.running || !items.length}
            onClick={() => {
              setConfirm(true)
              setCosts(false)
              setRelocate(false)
            }}
          >
            시작·저장 재개
          </button>
          <button
            disabled={disabled || !status?.running}
            onClick={() =>
              void action(async () => setStatus(await window.nais.invoke('pixai:pause', {})))
            }
          >
            중지
          </button>
          <button
            disabled={browser || working}
            onClick={() =>
              void action(async () => {
                await window.nais.invoke('pixai:open-folder', {})
              })
            }
          >
            저장 폴더 열기
          </button>
        </div>
      </header>
      <p className="px-banner">
        {browser
          ? '브라우저는 예약 준비용입니다. 설치한 앱에서 API 키와 저장 폴더를 연결하세요.'
          : status?.running
            ? status.stopping
              ? '현재 요청을 정리한 뒤 중지합니다.'
              : '생성·이미지 저장 실행 중입니다.'
            : '시작을 눌러야 공식 API에 유료 생성 요청을 보냅니다. 제출된 작업은 같은 ID로 확인·저장합니다.'}
      </p>
      {confirm && (
        <div className="px-confirm">
          <strong>
            새 생성 {newJobs.length}작업 ·{' '}
            {newJobs.reduce((sum, job) => sum + (job.images || 0), 0)}장
          </strong>
          <p>
            서버에 제출한 작업이 있으면 함께 확인·저장을 재개합니다. 중지는 새 제출을 멈추며 이미
            제출한 서버 작업을 취소하지 않습니다.
          </p>
          <label className="px-check">
            <input
              type="checkbox"
              checked={relocate}
              onChange={(e) => setRelocate(e.target.checked)}
            />
            미완료 작업의 남은 이미지도 현재 설정의 저장 폴더로 받기 (기존 파일은 이동하지 않음)
          </label>
          <label className="px-check">
            <input type="checkbox" checked={costs} onChange={(e) => setCosts(e.target.checked)} />
            API 비용이 발생하며, 가져온 크레딧 상한은 적용할 수 없음을 확인했습니다.
          </label>
          <button
            disabled={disabled || !costs}
            onClick={() =>
              void action(async () => {
                setStatus(
                  await window.nais.invoke('pixai:start', {
                    jobs: workspace.jobs,
                    costsAccepted: true,
                    relocatePending: relocate
                  })
                )
                setConfirm(false)
              })
            }
          >
            확인한 작업 실행
          </button>
          <button onClick={() => setConfirm(false)}>취소</button>
        </div>
      )}
      <div className="px-toolbar">
        <label className="px-check">
          <input
            type="checkbox"
            checked={!!items.length && selected.length === items.length}
            onChange={(e) => setSelected(e.target.checked ? items.map((job) => job.id) : [])}
          />
          전체 선택
        </label>
        <button
          disabled={disabled || status?.running || !selected.length}
          onClick={() => setRemove(selected)}
        >
          선택 삭제
        </button>
        <button
          disabled={disabled || status?.running}
          onClick={() =>
            setRemove(
              items.filter((job) => records.get(job.id)?.state === 'done').map((job) => job.id)
            )
          }
        >
          완료 목록 비우기
        </button>
      </div>
      {!!remove.length && (
        <div className="px-confirm">
          <p>{remove.length}개를 목록에서 지울까요? 저장된 이미지 파일은 그대로 남습니다.</p>
          {remove.some((id) => !removable(id)) ? (
            <p className="px-error">제출된 미완료 작업은 지울 수 없습니다.</p>
          ) : (
            <button
              disabled={disabled}
              onClick={() =>
                void action(async () => {
                  if (!browser) setStatus(await window.nais.invoke('pixai:remove', { ids: remove }))
                  await store.getState().commit((current) => ({
                    ...current,
                    jobs: current.jobs.filter((job) => !remove.includes(job.request.id))
                  }))
                  setRemove([])
                  setSelected([])
                })
              }
            >
              목록 삭제 확인
            </button>
          )}
          <button onClick={() => setRemove([])}>취소</button>
        </div>
      )}
      {(error || status?.error) && (
        <p role="alert" className="px-error">
          {error || status?.error}
        </p>
      )}
      <div className="px-scroll">
        {items.map((job) => {
          const record = records.get(job.id)
          return (
            <article className="px-queue-item" key={job.id}>
              <label className="px-check">
                <input
                  type="checkbox"
                  checked={selected.includes(job.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, job.id]
                        : selected.filter((id) => id !== job.id)
                    )
                  }
                />
                <strong>{job.title}</strong>
              </label>
              <small>
                {record ? labels[record.state] : '등록됨 · 미제출'} · {job.images || '미지정'}장 ·
                가로:세로 <RatioMark ratio={job.ratio} />
                {record?.taskId ? ` · 작업 ID ${record.taskId}` : ''}
              </small>
              {record?.error && <p className="px-error">{record.error}</p>}
              {record?.state === 'submission_unknown' && (
                <div className="px-confirm">
                  <p>
                    응답이 끊겨 서버 제출 여부를 모릅니다. 이미 알려진 작업의 저장은 재개할 수
                    있지만 새 생성은 보류합니다.
                  </p>
                  {dismiss !== job.id ? (
                    <button
                      disabled={disabled || status?.running}
                      onClick={() => setDismiss(job.id)}
                    >
                      이 작업 보류 종료…
                    </button>
                  ) : (
                    <>
                      <p>
                        PixAI에서 결과를 직접 확인해 주세요. 이 조작은 서버 작업을 취소하지 않으며
                        이 작업을 다시 제출하지 않습니다. 기록은 남기고 다른 작업의 새 생성을
                        허용합니다.
                      </p>
                      <button
                        disabled={disabled || status?.running}
                        onClick={() =>
                          void action(async () => {
                            setStatus(
                              await window.nais.invoke('pixai:dismiss-unknown', {
                                id: job.id,
                                acknowledged: true
                              })
                            )
                            setDismiss('')
                          })
                        }
                      >
                        확인했습니다 · 재제출 없이 보류 종료
                      </button>
                      <button onClick={() => setDismiss('')}>닫기</button>
                    </>
                  )}
                </div>
              )}
              {!!record?.files.length && (
                <p>
                  저장 {record.files.length}/{record.payload.batchSize}장
                </p>
              )}
              <details>
                <summary>저장된 조합·파일 확인</summary>
                <p>{job.prompt}</p>
                {record && <p className="px-path">남은 이미지 저장 위치: {record.outputDir}</p>}
                {record?.files.map((file) => (
                  <p className="px-path" key={file}>
                    {file}
                  </p>
                ))}
              </details>
            </article>
          )
        })}
        {!items.length && <p className="px-empty">조합 예약에서 예약을 대기열에 등록하세요.</p>}
      </div>
    </section>
  )
}
