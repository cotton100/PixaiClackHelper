import {
  API_RATIOS,
  normalizeSettingsOptions,
  type ExpandedRequest,
  type SettingsOptions
} from './library'
import type { ModelLinkInfo } from './model-link'
import type { UpdateStatus } from './updates'

export interface QueuedJob {
  request: ExpandedRequest
  imageCount: number
  options: SettingsOptions
}
export interface ApiPayload {
  modelVersionId: string
  prompt: string
  negativePrompt: string
  aspectRatio: string
  size: '1k' | '1.5k'
  batchSize: 1 | 4
  seed: number
  promptHelper: 'disable'
  loras: { modelId: string; weight: number; triggerWords: string }[]
  mode?: string
  style?: { type: 'preset'; key: string }
}
export type JobState =
  | 'queued'
  | 'submitting'
  | 'submission_unknown'
  | 'waiting'
  | 'saving'
  | 'check_required'
  | 'save_failed'
  | 'failed'
  | 'done'
  | 'cancelled'
export interface ExecutionJob {
  id: string
  title: string
  payload: ApiPayload
  state: JobState
  taskId?: string
  outputDir: string
  sourceSceneId?: string
  mediaIds?: string[]
  files: string[]
  error: string
  updatedAt: number
}
export interface RunnerStatus {
  running: boolean
  stopping: boolean
  error: string
  jobs: ExecutionJob[]
}
export interface ConnectionStatus {
  connected: boolean
  remembered: boolean
  encryptionAvailable: boolean
  outputDir: string
  maxInFlight: number
}
export interface SceneThumbnail {
  sceneId: string
  dataUrl: string
  savedAt: number
}
export interface SceneThumbnailStatus {
  revision: string
  images?: SceneThumbnail[]
}
export interface PixaiInvokeMap {
  'pixai:scene-thumbnails': { req: { revision?: string }; res: SceneThumbnailStatus }
  'pixai:update-status': { req: Record<string, never>; res: UpdateStatus }
  'pixai:update-check': { req: Record<string, never>; res: UpdateStatus }
  'pixai:update-latest': { req: Record<string, never>; res: UpdateStatus }
  'pixai:update-download': { req: { version: string }; res: UpdateStatus }
  'pixai:update-install': { req: { confirmed: boolean }; res: UpdateStatus }
  'pixai:model-link': { req: { url: string }; res: ModelLinkInfo }
  'pixai:status': { req: Record<string, never>; res: RunnerStatus }
  'pixai:connection': { req: Record<string, never>; res: ConnectionStatus }
  'pixai:connect': { req: { key: string; remember: boolean }; res: ConnectionStatus }
  'pixai:forget': { req: Record<string, never>; res: ConnectionStatus }
  'pixai:folder': { req: Record<string, never>; res: ConnectionStatus }
  'pixai:concurrency': { req: { count: number }; res: ConnectionStatus }
  'pixai:start': {
    req: { jobs: QueuedJob[]; costsAccepted: boolean; relocatePending?: boolean }
    res: RunnerStatus
  }
  'pixai:dismiss-unknown': { req: { id: string; acknowledged: boolean }; res: RunnerStatus }
  'pixai:pause': { req: Record<string, never>; res: RunnerStatus }
  'pixai:remove': { req: { ids: string[] }; res: RunnerStatus }
  'pixai:open-folder': { req: Record<string, never>; res: void }
}
export function numericId(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{1,40}$/.test(value))
    throw new Error('공식 API ID는 숫자 문자열이어야 합니다.')
  return value
}
export function buildPayload(job: QueuedJob, randomSeed: number): ApiPayload {
  const options = normalizeSettingsOptions(job.options)
  const api = options.api ?? {}
  const mode = job.request.imageOptions?.mode ?? api.mode
  const batchSize = job.request.imageOptions?.batchSize ?? job.imageCount
  const image = job.request.imageOptions ?? api
  const ratio = image.aspectRatio ?? '1:1',
    size = image.size ?? '1k'
  if (!API_RATIOS.includes(String(ratio)) || !['1k', '1.5k'].includes(String(size)))
    throw new Error('이미지 비율·크기를 확인해 주세요.')
  if (![1, 4].includes(batchSize))
    throw new Error('생성당 이미지 수를 1장 또는 4장으로 정한 뒤 대기열에 다시 등록해 주세요.')
  if (!job.request.prompt?.trim()) throw new Error('프롬프트가 비어 있습니다.')
  const config = job.request.configuration
  if (!config || !Array.isArray(config.loras) || config.loras.length > 5)
    throw new Error('모델과 LoRA(최대 5개)를 확인해 주세요.')
  const seed = api.seed === '' || api.seed === undefined ? randomSeed : Number(api.seed)
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295)
    throw new Error('시드 범위를 확인해 주세요.')
  const seen = new Set<string>()
  const payload: ApiPayload = {
    modelVersionId: numericId(config.model.versionId),
    prompt: job.request.prompt,
    negativePrompt: job.request.negativePrompt,
    aspectRatio: String(ratio),
    size: size as ApiPayload['size'],
    batchSize: batchSize as 1 | 4,
    seed,
    promptHelper: 'disable',
    loras: config.loras.map((lora) => {
      const modelId = numericId(lora.versionId)
      if (seen.has(modelId)) throw new Error('같은 LoRA 버전이 중복됐습니다.')
      seen.add(modelId)
      if (!Number.isFinite(lora.weight) || lora.weight < 0 || lora.weight > 1)
        throw new Error('공식 API LoRA 가중치는 0~1입니다. 자동 보정하지 않습니다.')
      return { modelId, weight: lora.weight, triggerWords: '' }
    })
  }
  if (mode) {
    if (!['lite', 'standard', 'pro', 'ultra'].includes(String(mode)))
      throw new Error('생성 모드를 확인해 주세요.')
    payload.mode = String(mode)
  }
  if (api.style) {
    if (typeof api.style !== 'string' || !/^[a-z][a-z0-9-]{0,80}$/.test(api.style))
      throw new Error('스타일 이름을 확인해 주세요.')
    payload.style = { type: 'preset', key: api.style }
  }
  return payload
}
