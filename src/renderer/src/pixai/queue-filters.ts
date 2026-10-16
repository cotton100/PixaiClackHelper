import type { ExecutionJob, JobState } from '@shared/pixai/execution'
import type { Workspace } from './store'

export interface QueueItem {
  id: string
  title: string
  prompt: string
  ratio: string
  images: number
  batchId?: string
  batchName?: string
  character: { key: string; name: string }
  scene: { key: string; name: string }
  preset: { key: string; name: string }
  state: JobState
  at?: number
  dateKind: 'registered' | 'updated' | 'unknown'
}
export interface QueueFilters {
  date: '7d' | 'today' | '30d' | 'custom' | 'all'
  from: string
  to: string
  character: string
  scene: string
  preset: string
  ratio: string
}
export const defaultQueueFilters = (): QueueFilters => ({
  date: '7d',
  from: '',
  to: '',
  character: '',
  scene: '',
  preset: '',
  ratio: ''
})
function validDate(value?: number): number | undefined {
  return Number.isSafeInteger(value) && value! > 0 && value! <= 8640000000000000 ? value : undefined
}
function dates(registered?: number, updated?: number): Pick<QueueItem, 'at' | 'dateKind'> {
  const at = validDate(registered)
  if (at) return { at, dateKind: 'registered' }
  const fallback = validDate(updated)
  return fallback ? { at: fallback, dateKind: 'updated' } : { dateKind: 'unknown' }
}
const material = (id: string | undefined, name: string): { key: string; name: string } => ({
  key: id ? `id:${id}` : 'none',
  name
})

/** Names/IDs come from each job's frozen composition, never from the current preset or character. */
export function queueItems(workspace: Workspace, records: ExecutionJob[]): QueueItem[] {
  const byId = new Map(records.map((job) => [job.id, job]))
  const localIds = new Set(workspace.jobs.map((job) => job.request.id))
  return [
    ...workspace.jobs.map((job): QueueItem => {
      const record = byId.get(job.request.id)
      const { reservation, character, preset } = job.request.composition
      const sceneId = reservation.sourceSceneId ?? record?.sourceSceneId
      return {
        id: job.request.id,
        title: job.request.title,
        prompt: job.request.prompt,
        ratio:
          job.request.imageOptions?.aspectRatio ?? String(job.options.api?.aspectRatio ?? '1:1'),
        images: job.imageCount,
        batchId: reservation.batch?.id ?? record?.batchId,
        batchName: reservation.batch?.name ?? record?.batchName,
        character: material(character.id, character.name),
        preset: material(preset.id, preset.name),
        scene: material(
          sceneId,
          reservation.batch?.columnName ||
            workspace.library.sceneCards?.find((scene) => scene.id === sceneId)?.name ||
            (sceneId ? '이전 씬 · ' + sceneId : '씬 없이 조합')
        ),
        state: record?.state ?? 'queued',
        ...dates(job.registeredAt ?? record?.registeredAt, record?.updatedAt)
      }
    }),
    ...records
      .filter(
        (job) => !localIds.has(job.id) && !['done', 'cancelled', 'failed'].includes(job.state)
      )
      .map((job): QueueItem => ({
        id: job.id,
        title: job.title,
        prompt: job.payload.prompt,
        ratio: job.payload.aspectRatio,
        images: job.payload.batchSize,
        batchId: job.batchId,
        batchName: job.batchName,
        character: material(undefined, '캐릭터 정보 없음'),
        preset: material(undefined, '프리셋 정보 없음'),
        scene: material(
          job.sourceSceneId,
          workspace.library.sceneCards?.find((scene) => scene.id === job.sourceSceneId)?.name ||
            (job.sourceSceneId ? '이전 씬 · ' + job.sourceSceneId : '씬 정보 없음')
        ),
        state: job.state,
        ...dates(job.registeredAt, job.updatedAt)
      }))
  ]
}

function inputDate(value: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const [year, month, day] = value.split('-').map(Number)
  const result = new Date(year, month - 1, day)
  if (result.getFullYear() !== year || result.getMonth() !== month - 1 || result.getDate() !== day)
    return undefined
  return result.getTime()
}
export function queueDateError(filters: QueueFilters): string {
  if (filters.date !== 'custom') return ''
  const from = inputDate(filters.from),
    to = inputDate(filters.to)
  if (from === undefined || to === undefined) return '시작일과 종료일을 모두 선택해 주세요.'
  return from > to ? '종료일은 시작일 이후로 선택해 주세요.' : ''
}
export function matchesQueueFilters(
  item: QueueItem,
  filters: QueueFilters,
  now = new Date()
): boolean {
  for (const key of ['character', 'scene', 'preset'] as const)
    if (filters[key] && filters[key] !== item[key].key) return false
  if (filters.ratio && filters.ratio !== item.ratio) return false
  // Old unfinished records, failures and unknown dates stay reachable even outside the date range.
  if (!['done', 'cancelled'].includes(item.state) || !item.at || filters.date === 'all') return true
  if (queueDateError(filters)) return false
  let from: number, end: Date
  if (filters.date === 'custom') {
    from = inputDate(filters.from)!
    end = new Date(inputDate(filters.to)!)
    end.setDate(end.getDate() + 1)
  } else {
    const days = filters.date === 'today' ? 1 : filters.date === '30d' ? 30 : 7
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    end = new Date(start)
    end.setDate(end.getDate() + 1)
    start.setDate(start.getDate() - days + 1)
    from = start.getTime()
  }
  return item.at >= from && item.at < end.getTime()
}
