import { randomInt } from 'node:crypto'
import {
  buildPayload,
  numericId,
  type ExecutionJob,
  type QueuedJob,
  type RunnerStatus,
  type SavedMedia
} from '../../shared/pixai/execution'
import { presetIdentifier, presetText } from '../../shared/pixai/library'
import { ApiError, type Task } from './client'

interface RunnerIO {
  read(): string | null
  write(text: string): void
  create(job: ExecutionJob): Promise<string>
  task(id: string): Promise<Task>
  save(job: ExecutionJob, mediaId: string): Promise<SavedMedia>
  sleep(ms: number): Promise<void>
}
export class PixaiRunner {
  private jobs: ExecutionJob[] = []
  private running = false
  private stopping = false
  private error = ''
  private fatal = false
  constructor(private io: RunnerIO) {
    const text = io.read()
    if (!text) return
    const saved = JSON.parse(text) as ExecutionJob[]
    if (
      !Array.isArray(saved) ||
      saved.some(
        (job) =>
          !job?.id ||
          !Array.isArray(job.files) ||
          !job.payload ||
          ![
            'queued',
            'submitting',
            'submission_unknown',
            'waiting',
            'saving',
            'check_required',
            'save_failed',
            'failed',
            'done',
            'cancelled'
          ].includes(job.state)
      )
    )
      throw new Error('생성 기록을 읽지 못했습니다. 기존 기록을 보존합니다.')
    this.jobs = saved.map((job) =>
      job.state === 'submitting'
        ? {
            ...job,
            state: 'submission_unknown',
            error: '앱 종료 전 제출 결과를 확인하지 못했습니다. 재생성하지 않습니다.'
          }
        : job.state === 'saving'
          ? { ...job, state: 'save_failed' }
          : job
    )
    this.persist(this.jobs)
  }
  status(): RunnerStatus {
    return structuredClone({
      running: this.running,
      stopping: this.stopping,
      error: this.error,
      jobs: this.jobs
    })
  }
  private persist(next: ExecutionJob[]): void {
    try {
      this.io.write(JSON.stringify(next))
    } catch {
      this.fatal = true
      this.error = '생성 기록 저장 실패. 재시작 후 작업 상태를 확인해 주세요.'
      this.stopping = true
      throw new Error(this.error)
    }
    this.jobs = next
  }
  private patch(id: string, value: Partial<ExecutionJob>): void {
    this.persist(
      this.jobs.map((job) => (job.id === id ? { ...job, ...value, updatedAt: Date.now() } : job))
    )
  }
  start(
    inputs: QueuedJob[],
    outputDir: string,
    limit: number,
    relocatePending = false,
    embedMetadata = false
  ): void {
    if (this.running) throw new Error('이미 실행 중입니다.')
    if (this.fatal) throw new Error(this.error)
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 5 ||
      !Array.isArray(inputs) ||
      inputs.length > 1000
    )
      throw new Error('실행 수량을 확인해 주세요.')
    const ids = new Set(this.jobs.map((job) => job.id))
    const added: ExecutionJob[] = []
    for (const input of inputs) {
      const id = input?.request?.id
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id))
        throw new Error('작업 ID 형식을 확인해 주세요.')
      if (ids.has(id)) continue
      ids.add(id)
      added.push({
        id,
        title: String(input.request.title).slice(0, 300),
        payload: buildPayload(input, randomInt(0, 4294967296)),
        ...(input.request.composition.reservation.sourceSceneId !== undefined
          ? {
              sourceSceneId: presetIdentifier(
                input.request.composition.reservation.sourceSceneId,
                '원본 씬'
              )
            }
          : {}),
        ...(input.request.composition.reservation.batch
          ? {
              batchId: presetIdentifier(
                input.request.composition.reservation.batch.id,
                '예약 묶음'
              ),
              batchName: presetText(input.request.composition.reservation.batch.name)
            }
          : {}),
        state: 'queued',
        embedMetadata,
        ...(embedMetadata
          ? {
              metadataReferences: {
                modelId: numericId(input.request.configuration.model.id),
                loraModelIds: input.request.configuration.loras.map((v) => numericId(v.id))
              }
            }
          : {}),
        outputDir,
        files: [],
        error: '',
        updatedAt: Date.now()
      })
    }
    const next = [...this.jobs, ...added].map((job) =>
      relocatePending && ['queued', 'waiting', 'check_required', 'save_failed'].includes(job.state)
        ? { ...job, outputDir }
        : job
    )
    const unknown = next.some((job) => job.state === 'submission_unknown')
    if (
      unknown &&
      !next.some((job) => ['waiting', 'check_required', 'save_failed'].includes(job.state))
    )
      throw new Error(
        '제출 여부를 확인하지 못한 작업이 있습니다. 서버 결과를 확인한 뒤 해당 작업의 보류를 종료해 주세요.'
      )
    if (
      !next.some((job) =>
        ['queued', 'waiting', 'check_required', 'save_failed'].includes(job.state)
      )
    )
      throw new Error('실행하거나 저장을 재개할 작업이 없습니다.')
    this.persist(next)
    this.error = ''
    this.stopping = false
    this.running = true
    void this.run(limit)
  }
  pause(): void {
    this.stopping = true
  }
  dismissUnknown(id: string, acknowledged: boolean): void {
    if (this.running || this.fatal) throw new Error('실행을 멈춘 뒤 정리해 주세요.')
    if (
      !acknowledged ||
      !this.jobs.some((job) => job.id === id && job.state === 'submission_unknown')
    )
      throw new Error('제출 결과 확인 안내를 확인해 주세요.')
    this.patch(id, {
      state: 'cancelled',
      error: '제출 결과 불명확 · 사용자 보류 종료. 서버 취소·자동 재제출 없음.'
    })
    this.error = ''
  }
  remove(ids: string[]): void {
    if (this.running || this.fatal) throw new Error('실행을 멈춘 뒤 정리해 주세요.')
    const selected = new Set(ids)
    if (
      this.jobs.some(
        (job) =>
          selected.has(job.id) && !['queued', 'done', 'failed', 'cancelled'].includes(job.state)
      )
    )
      throw new Error('제출된 미완료 작업은 지울 수 없습니다. 같은 ID로 확인·저장을 재개해 주세요.')
    // Keep a tombstone even if the renderer's subsequent save fails.
    this.persist(
      this.jobs.map((job) =>
        selected.has(job.id) && job.state === 'queued' ? { ...job, state: 'cancelled' } : job
      )
    )
  }
  private async run(limit: number): Promise<void> {
    try {
      while (!this.stopping) {
        const live = this.jobs.filter((job) =>
          ['waiting', 'check_required', 'save_failed'].includes(job.state)
        )
        for (const job of live) {
          if (this.stopping) break
          try {
            await this.check(job)
          } catch (error) {
            if (this.fatal) throw error
            const current = this.jobs.find((item) => item.id === job.id)!
            this.patch(job.id, {
              state: current.mediaIds ? 'save_failed' : 'check_required',
              error: error instanceof Error ? error.message : '확인 실패'
            })
            this.error =
              '작업 확인 또는 저장을 중단했습니다. 시작을 누르면 같은 작업 ID로 재개합니다.'
            this.stopping = true
          }
        }
        while (
          !this.stopping &&
          !this.jobs.some((job) => job.state === 'submission_unknown') &&
          this.jobs.filter((job) =>
            ['waiting', 'check_required', 'save_failed'].includes(job.state)
          ).length < limit
        ) {
          const job = this.jobs.find((item) => item.state === 'queued')
          if (!job) break
          this.patch(job.id, { state: 'submitting', error: '' })
          try {
            const taskId = numericId(await this.io.create(job))
            this.patch(job.id, { taskId, state: 'waiting' })
          } catch (error) {
            if (this.fatal) throw error
            this.patch(job.id, {
              state:
                error instanceof ApiError && error.notSubmitted ? 'failed' : 'submission_unknown',
              error: error instanceof Error ? error.message : '제출 결과 불명확'
            })
            this.error = '생성 요청을 중단했습니다. 오류가 난 작업을 확인해 주세요.'
            this.stopping = true
          }
        }
        if (
          !this.jobs.some(
            (job) =>
              ['waiting', 'check_required', 'save_failed'].includes(job.state) ||
              (job.state === 'queued' &&
                !this.jobs.some((item) => item.state === 'submission_unknown'))
          )
        )
          break
        if (!this.stopping) await this.io.sleep(5000)
      }
    } catch {
      this.error ||= '작업을 중단했습니다. 저장된 작업 ID를 확인해 주세요.'
    } finally {
      this.running = false
      this.stopping = false
    }
  }
  private async check(job: ExecutionJob): Promise<void> {
    if (!job.taskId) throw new Error('저장된 작업 ID가 없습니다.')
    let mediaIds = job.mediaIds
    if (!mediaIds) {
      const task = await this.io.task(job.taskId)
      if (task.id !== job.taskId) throw new Error('작업 ID 불일치')
      if (['waiting', 'running'].includes(task.status)) {
        this.patch(job.id, { state: 'waiting', error: '' })
        return
      }
      if (['failed', 'cancelled'].includes(task.status)) {
        this.patch(job.id, {
          state: 'failed',
          error: '서버가 생성 실패 또는 취소를 보고했습니다. 자동 재생성하지 않습니다.'
        })
        this.stopping = true
        return
      }
      if (task.status !== 'completed') throw new Error('알 수 없는 생성 상태입니다.')
      mediaIds = task.outputs?.mediaIds
      if (
        !Array.isArray(mediaIds) ||
        mediaIds.length !== job.payload.batchSize ||
        new Set(mediaIds).size !== mediaIds.length
      )
        throw new Error('원본 이미지 개수가 요청한 배치 장수와 다릅니다.')
      mediaIds.forEach(numericId)
    }
    this.patch(job.id, { state: 'saving', mediaIds, error: '' })
    const files = [...job.files]
    const warnings = [...(job.warnings ?? [])]
    for (let index = files.length; index < mediaIds.length; index++) {
      if (this.stopping) {
        this.patch(job.id, { state: 'save_failed' })
        return
      }
      const saved = await this.io.save(job, mediaIds[index])
      files.push(saved.path)
      if (saved.warning) warnings.push(`${index + 1}번째 이미지: ${saved.warning}`)
      this.patch(job.id, { files: [...files], warnings: [...warnings] })
    }
    this.patch(job.id, { state: 'done', error: '' })
  }
}
