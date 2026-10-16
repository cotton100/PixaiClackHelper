import { StageChips } from './controls'
import { RatioMark } from './ratio-mark'
import { useEffect, useRef, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import type { ConnectionStatus, JobState, RunnerStatus } from '@shared/pixai/execution'
import { isWorkspaceConflict, WORKSPACE_CONFLICT_MESSAGE, type PixaiStore } from './store'
import {
  defaultQueueFilters,
  matchesQueueFilters,
  queueDateError,
  queueItems,
  type QueueFilters
} from './queue-filters'
import './queue-filters.css'

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
          <label className="px-check">
            <input
              type="checkbox"
              checked={state?.embedMetadata ?? false}
              disabled={busy || !state}
              onChange={(e) =>
                void action(() =>
                  window.nais.invoke('pixai:metadata-setting', { enabled: e.target.checked })
                )
              }
            />
            PNG 안에 생성 요청 정보 기록
          </label>
          <small>
            기본 꺼짐. 다음에 새로 시작하는 작업부터 적용합니다. PNG 픽셀·기존 정보는 유지하고
            프롬프트·모델·LoRA·요청 시드를 넣습니다. 이미지를 공유하면 이 정보도 전달됩니다.
            JPEG·WebP는 원본 그대로 저장합니다. 별도 JSON은 만들지 않습니다. 꺼짐은 기존 정보를
            삭제하는 설정이 아니라, 새 기록을 추가하지 않는 설정입니다.
          </small>
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
  const { workspace, busy, conflict, draftSaving } = store()
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
  const [filter, setFilter] = useState('all')
  const [filters, setFilters] = useState(defaultQueueFilters)
  const [filtersOpen, setFiltersOpen] = useState(true)
  const bodyRef = useRef<HTMLDivElement>(null)
  function changeFilter(key: keyof QueueFilters, value: string): void {
    setFilters((current) => ({ ...current, [key]: value }))
    setSelected([])
    setRemove([])
  }
  const records = new Map(status?.jobs.map((job) => [job.id, job]))
  const items = queueItems(workspace, status?.jobs ?? [])
  const category = (id: string): string => {
    const state = records.get(id)?.state ?? 'queued'
    if (['submitting', 'waiting', 'saving'].includes(state)) return 'active'
    if (['submission_unknown', 'check_required', 'save_failed'].includes(state)) return 'attention'
    return state
  }
  const categories = [
    ['all', '전체'],
    ['queued', '제출 대기'],
    ['active', '진행'],
    ['attention', '확인 필요'],
    ['failed', '실패'],
    ['done', '저장 완료'],
    ['cancelled', '제외됨']
  ]
  const matching = items.filter((item) => matchesQueueFilters(item, filters))
  const visible = matching.filter((item) => filter === 'all' || category(item.id) === filter)
  const dateLabel = {
    '7d': '최근 7일',
    today: '오늘',
    '30d': '최근 30일',
    custom:
      filters.from || filters.to ? `${filters.from || '…'} ~ ${filters.to || '…'}` : '기간 선택',
    all: '전체 날짜'
  }[filters.date]
  const materialOptions = {
    character: new Map(items.map((item) => [item.character.key, item.character.name])),
    scene: new Map(items.map((item) => [item.scene.key, item.scene.name])),
    preset: new Map(items.map((item) => [item.preset.key, item.preset.name]))
  }
  const nameOf = (key: 'character' | 'scene' | 'preset'): string =>
    materialOptions[key].get(filters[key]) ?? filters[key]
  const activeFilters = [
    filters.character && `캐릭터 ${nameOf('character')}`,
    filters.scene && `씬 ${nameOf('scene')}`,
    filters.preset && `프리셋 ${nameOf('preset')}`,
    filters.ratio && `비율 ${filters.ratio}`
  ].filter((text): text is string => !!text)
  const visibleDone = visible.filter((item) => item.state === 'done')
  const visibleSelection = selected.filter((id) => visible.some((item) => item.id === id))
  const groups = new Map<string, typeof items>()
  for (const item of visible) {
    const key = item.batchId ?? ''
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  const newJobs = items.filter(
    (job) => !records.has(job.id) || records.get(job.id)?.state === 'queued'
  )
  const removable = (id: string): boolean =>
    !records.has(id) || ['done', 'queued', 'cancelled', 'failed'].includes(records.get(id)!.state)
  const removalChanged = remove.some((id) => !visible.some((item) => item.id === id))
  async function action(run: () => Promise<void>): Promise<void> {
    setWorking(true)
    setError('')
    try {
      await run()
    } catch (e) {
      if (isWorkspaceConflict(e))
        store.setState({ conflict: true, error: WORKSPACE_CONFLICT_MESSAGE })
      setError(e instanceof Error ? e.message : '실행 실패')
    } finally {
      setWorking(false)
    }
  }
  const disabled = busy || working || conflict || draftSaving || (!browser && !status)
  return (
    <section className="px-pane px-queue">
      <header>
        <h2>생성 대기열</h2>
        <StageChips stage={3} />
        <div className="px-toolbar">
          <button
            className="px-primary"
            disabled={browser || disabled || status?.running || !items.length}
            onClick={() => {
              setConfirm(true)
              setCosts(false)
              setRelocate(false)
              if (bodyRef.current) bodyRef.current.scrollTop = 0
            }}
          >
            시작·저장 재개
          </button>
          <button
            disabled={working || !status?.running}
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
      <div className="px-scroll px-queue-body" ref={bodyRef}>
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
              제출한 서버 작업을 취소하지 않습니다. 목록 필터와 관계없이 전체 대기 작업에
              적용합니다.
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
                  const expectedWorkspaceRevision = await store.getState().verifyCurrent()
                  setStatus(
                    await window.nais.invoke('pixai:start', {
                      jobs: workspace.jobs,
                      expectedWorkspaceRevision: expectedWorkspaceRevision ?? '',
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
        <details
          className="px-queue-filter-panel"
          open={filtersOpen}
          onToggle={(event) => setFiltersOpen(event.currentTarget.open)}
        >
          <summary
            aria-label={`대기열 필터 접기·펼치기 · ${dateLabel} · ${activeFilters.join(' · ') || '다른 조건 없음'} · 표시 ${visible.length} / 전체 ${items.length}작업`}
          >
            <SlidersHorizontal size={15} aria-hidden="true" />
            <span className="px-queue-filter-summary">
              <strong>{dateLabel}</strong>
              {activeFilters.map((text) => (
                <span className="px-queue-filter-chip" key={text}>
                  {text}
                </span>
              ))}
              {!activeFilters.length && (
                <span className="px-queue-filter-chip">다른 조건 없음</span>
              )}
            </span>
            <small>
              표시 {visible.length} / 전체 {items.length}작업
            </small>
          </summary>
          <div className="px-queue-filters" aria-label="대기열 조건 필터">
            <label>
              등록 날짜
              <select
                aria-label="대기열 날짜"
                value={filters.date}
                onChange={(e) => changeFilter('date', e.target.value)}
              >
                <option value="7d">최근 7일</option>
                <option value="today">오늘</option>
                <option value="30d">최근 30일</option>
                <option value="custom">기간 선택</option>
                <option value="all">전체 날짜</option>
              </select>
            </label>
            {filters.date === 'custom' && (
              <>
                <label>
                  시작일
                  <input
                    type="date"
                    aria-label="대기열 시작일"
                    value={filters.from}
                    onChange={(e) => changeFilter('from', e.target.value)}
                  />
                </label>
                <label>
                  종료일
                  <input
                    type="date"
                    aria-label="대기열 종료일"
                    value={filters.to}
                    onChange={(e) => changeFilter('to', e.target.value)}
                  />
                </label>
              </>
            )}
            {(['character', 'scene', 'preset'] as const).map((key) => {
              const name = { character: '캐릭터', scene: '씬', preset: '프리셋' }[key]
              const options = materialOptions[key]
              return (
                <label key={key}>
                  {name}
                  <select
                    aria-label={`대기열 ${name}`}
                    value={filters[key]}
                    onChange={(e) => changeFilter(key, e.target.value)}
                  >
                    <option value="">전체 {name}</option>
                    {[...options].map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              )
            })}
            <label>
              이미지 비율
              <select
                aria-label="대기열 이미지 비율"
                value={filters.ratio}
                onChange={(e) => changeFilter('ratio', e.target.value)}
              >
                <option value="">전체 비율</option>
                {[...new Set(items.map((item) => item.ratio))].map((ratio) => (
                  <option key={ratio} value={ratio}>
                    가로:세로 {ratio}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {queueDateError(filters) && (
            <p role="alert" className="px-error">
              {queueDateError(filters)}
            </p>
          )}
          <div className="px-queue-filter-note">
            <small>
              날짜 밖 미완료 작업도 표시합니다 (다른 조건은 적용). 필터는 목록에만 적용되며
              시작·저장 재개는 전체 대기 작업에 적용합니다.
              {items.some((item) => item.dateKind !== 'registered') &&
                ' 이전 작업은 마지막 변경일을 사용하며, 날짜 없는 작업도 표시합니다.'}
            </small>
            <button
              onClick={() => {
                setFilters(defaultQueueFilters())
                setFilter('all')
                setSelected([])
                setRemove([])
              }}
            >
              기본 필터로
            </button>
          </div>
        </details>
        <div className="px-group-chips" aria-label="대기열 상태 필터">
          {categories.map(([key, label]) => (
            <button
              key={key}
              aria-pressed={filter === key}
              onClick={() => {
                setFilter(key)
                setSelected([])
                setRemove([])
              }}
            >
              {label} {matching.filter((item) => key === 'all' || category(item.id) === key).length}
            </button>
          ))}
        </div>
        <div className="px-toolbar px-queue-list-tools">
          <label className="px-check">
            <input
              type="checkbox"
              checked={!!visible.length && visible.every((item) => selected.includes(item.id))}
              onChange={(e) => setSelected(e.target.checked ? visible.map((job) => job.id) : [])}
            />
            현재 목록 전체 선택
          </label>
          <button
            disabled={disabled || status?.running || !visibleSelection.length}
            title="현재 목록에 표시된 작업만 삭제합니다. 이미지 파일은 지우지 않습니다."
            onClick={() => setRemove(visibleSelection)}
          >
            선택 삭제
          </button>
          <button
            disabled={disabled || status?.running || !visibleDone.length}
            title="현재 필터에 표시된 완료 작업만 목록에서 지웁니다."
            onClick={() => setRemove(visibleDone.map((job) => job.id))}
          >
            완료 목록 비우기
          </button>
          <small>현재 목록에 표시된 작업만 삭제합니다.</small>
        </div>
        {!!remove.length && (
          <div className="px-confirm">
            <p>{remove.length}개를 목록에서 지울까요? 저장된 이미지 파일은 그대로 남습니다.</p>
            {removalChanged ? (
              <p className="px-error">
                표시 목록이 바뀌었습니다. 취소 후 현재 목록에서 다시 선택해 주세요.
              </p>
            ) : remove.some((id) => !removable(id)) ? (
              <p className="px-error">제출된 미완료 작업은 지울 수 없습니다.</p>
            ) : (
              <button
                disabled={disabled || status?.running}
                onClick={() =>
                  void action(async () => {
                    const currentVisible = items.filter(
                      (item) =>
                        matchesQueueFilters(item, filters) &&
                        (filter === 'all' || category(item.id) === filter)
                    )
                    if (
                      status?.running ||
                      remove.some(
                        (id) => !removable(id) || !currentVisible.some((item) => item.id === id)
                      )
                    )
                      throw new Error(
                        '표시 목록이나 실행 상태가 바뀌었습니다. 취소 후 다시 선택해 주세요.'
                      )
                    if (!browser)
                      setStatus(await window.nais.invoke('pixai:remove', { ids: remove }))
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
        <div className="px-queue-jobs">
          {[...groups].map(([id, entries]) => (
            <details className="px-queue-group" key={id} open>
              <summary>
                {entries[0].batchName || '개별 작업'} · {entries.length}작업{' '}
                <small>
                  {categories
                    .slice(1)
                    .map(([key, label]) => {
                      const count = entries.filter((item) => category(item.id) === key).length
                      return count ? label + ' ' + count : ''
                    })
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </summary>
              {entries.map((job) => {
                const record = records.get(job.id)
                return (
                  <article className="px-queue-item" key={job.id}>
                    <div className="px-queue-head">
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
                        <strong className="px-queue-title" title={job.title}>
                          {job.title}
                        </strong>
                      </label>
                      <small className="px-queue-date">
                        {job.at
                          ? `${job.dateKind === 'updated' ? '이전 기록 변경' : '등록'} ${new Date(job.at).toLocaleString()}`
                          : '등록 날짜 미기록'}
                      </small>
                    </div>
                    <div className="px-queue-meta">
                      <span className={'px-status-chip is-' + category(job.id)}>
                        {record ? labels[record.state] : '등록됨 · 미제출'}
                      </span>
                      <span>{job.images || '미지정'}장</span>
                      <span className="px-queue-ratio">
                        <RatioMark ratio={job.ratio} />
                      </span>
                      {record?.taskId && <span>작업 ID {record.taskId}</span>}
                    </div>
                    <p className="px-queue-materials">
                      <small>
                        {job.character.name} · {job.scene.name} · {job.preset.name}
                      </small>
                    </p>
                    {record?.error && <p className="px-error">{record.error}</p>}
                    {record?.warnings?.map((warning, index) => (
                      <p className="px-warning" key={index}>
                        {warning}
                      </p>
                    ))}
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
                              PixAI에서 결과를 직접 확인해 주세요. 이 조작은 서버 작업을 취소하지
                              않으며 이 작업을 다시 제출하지 않습니다. 기록은 남기고 다른 작업의 새
                              생성을 허용합니다.
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
                      {record && (
                        <p className="px-path">남은 이미지 저장 위치: {record.outputDir}</p>
                      )}
                      {record?.files.map((file) => (
                        <p className="px-path" key={file}>
                          {file}
                        </p>
                      ))}
                    </details>
                  </article>
                )
              })}
            </details>
          ))}
          {!items.length && <p className="px-empty">조합 예약에서 예약을 대기열에 등록하세요.</p>}
          {!!items.length && !visible.length && (
            <p className="px-empty">
              이 조건에 맞는 작업이 없습니다. 날짜나 다른 필터를 바꿔 보세요.
            </p>
          )}
        </div>
        <footer>
          <small>
            목록 삭제는 이미지 파일을 지우지 않습니다. 제출된 미완료 작업은 삭제할 수 없습니다.
          </small>
        </footer>
      </div>
    </section>
  )
}
