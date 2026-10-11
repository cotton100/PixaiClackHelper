/**
 * PixAI 재료 라이브러리 — 유저스크립트(pixai-web-queue)의 설정 백업 형식과 호환되는 데이터 모델.
 *
 * 스크립트 쪽 정규화 규칙(허용 키·ID 형식·한도)을 그대로 옮겼고, 앱 전용 항목(씬 카드·출연·일괄 예약 구성)은
 * 모두 선택 항목이라 옛 백업은 그대로 읽히고, 앱이 내보낸 백업도 스크립트가 거부하지 않도록 새 키를 늘리지 않는다
 * (스크립트는 모르는 키를 거부하므로, 스크립트용 내보내기에서는 앱 전용 키를 뺀다 — exportForScript 참고).
 *
 * 용어: 청크(chunk) = 스크립트의 scenes 배열 항목. 씬(scene card) = 청크 순서+사본. 출연(cast) = 캐릭터+프리셋(+복장 문구).
 */

export interface ExtraText {
  prompt: string
  negativePrompt: string
}

export interface LoraRef {
  id: string
  name: string
  weight: number
  versionId?: string
  triggerWords?: string
}

export interface ModelRef {
  id: string
  name: string
  versionId: string
  family?: string
}

export interface Preset {
  id: string
  name: string
  model: ModelRef
  loras: LoraRef[]
  /** 이 프리셋을 고른 조합에 전역 공통문과 함께 들어가는 문구 (없으면 빈 문구로 해석) */
  prompt?: string
  negativePrompt?: string
}

/** 프리셋에 공통 문구가 하나라도 있으면 true. 스크립트는 이 필드를 모르므로 내보내기 때 구분한다. */
export function presetHasText(preset: Pick<Preset, 'prompt' | 'negativePrompt'>): boolean {
  return !!(presetText(preset.prompt) || presetText(preset.negativePrompt))
}

export interface Character {
  id: string
  name: string
  prompt: string
  negativePrompt: string
  /** 기본 모델·LoRA 프리셋 (없으면 일괄 예약 때 행마다 지정) */
  defaultPresetId?: string
  folderId?: string
}

export interface Chunk {
  id: string
  name: string
  prompt: string
  negativePrompt: string
  folderId?: string
}

export interface Folder {
  id: string
  name: string
}

export type TriggerPosition = number | 'end'

export interface ImageOptions {
  aspectRatio: string
  size: '1k' | '1.5k'
  mode?: '' | 'lite' | 'standard' | 'pro' | 'ultra'
  batchSize?: 1 | 4
}

export interface BatchTag {
  id: string
  name: string
  rowName: string
  columnName: string
}

export interface Snapshot {
  common: ExtraText
  preset: Preset
  character: Character
  chunks: Chunk[]
  extras?: { cast?: ExtraText; scene?: ExtraText }
}

export interface Reservation {
  id: string
  presetId: string
  characterId: string
  sceneIds: string[]
  count: number
  triggerPosition?: TriggerPosition
  imageOptions?: ImageOptions
  snapshot?: Snapshot
  sourceSceneId?: string
  batch?: BatchTag
}

export interface Combination {
  id: string
  presetId: string
  characterId: string
  sceneIds: string[]
  count: number
  triggerPosition?: TriggerPosition
  imageOptions?: ImageOptions
  favorite: boolean
  name: string
  at: number
}

/** 씬 카드: 어떤 장면인지만 저장. 캐릭터·모델은 넣지 않는다. */
export interface SceneCard {
  id: string
  name: string
  sceneIds: string[]
  chunks: Chunk[]
  extra?: ExtraText
  imageOptions?: ImageOptions
  triggerPosition?: TriggerPosition
  folderId?: string
}

/** 출연: 누가, 어떤 모델·LoRA로. 캐릭터 하나에 복장별 출연 여러 개 가능 (A1, A2, …). */
export interface Cast {
  id: string
  name: string
  characterId: string
  presetId: string
  extra?: ExtraText
  triggerPosition?: TriggerPosition
}

export interface BatchRow {
  kind: 'character' | 'cast'
  id: string
  presetId?: string
}

export interface BatchPlan {
  id: string
  name: string
  rows: BatchRow[]
  columns: string[]
  count: number
  exceptions: Record<string, number>
  order: 'byRow' | 'byColumn'
  imageOptions?: ImageOptions
}

export interface Library {
  version: 1
  common: ExtraText
  presets: Preset[]
  characters: Character[]
  characterFolders?: Folder[]
  chunkFolders: Folder[]
  scenes: Chunk[]
  reservations: Reservation[]
  combinations?: Combination[]
  sceneFolders?: Folder[]
  sceneCards?: SceneCard[]
  casts?: Cast[]
  batchPlans?: BatchPlan[]
}

export const API_RATIOS = [
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '3:5',
  '5:3',
  '9:16',
  '16:9',
  '1:3',
  '3:1'
]
export const MAX_RESERVED_JOBS = 1000

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key)
type Rec = Record<string, unknown>

export function presetText(value: unknown): string {
  if (value != null && typeof value !== 'string')
    throw new Error('프롬프트와 이름은 문자열이어야 합니다.')
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .trim()
}

export function presetObject(value: unknown, label: string): Rec {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} 형식을 확인해 주세요.`)
  return value as Rec
}

export function presetIdentifier(value: unknown, label: string, numeric = false): string {
  const result = presetText(value)
  if (!result || (numeric && !/^\d+$/.test(result))) throw new Error(`${label} ID를 확인해 주세요.`)
  return result
}

export function presetInteger(value: unknown, label: string, min: number, max: number): number {
  if (
    !['number', 'string'].includes(typeof value) ||
    (typeof value === 'string' && !value.trim())
  ) {
    throw new Error(`${label}은 ${min}~${max} 사이의 정수여야 합니다.`)
  }
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < min || result > max)
    throw new Error(`${label}은 ${min}~${max} 사이의 정수여야 합니다.`)
  return result
}

/** 필수 키가 모두 있고, 허용 키 밖의 키가 없어야 한다 (스크립트 백업 규칙 그대로). */
export function allowedKeys(
  value: unknown,
  label: string,
  required: string[],
  allowed: string[] = required
): Rec {
  const source = presetObject(value, label)
  if (
    required.some((key) => !hasOwn(source, key)) ||
    Object.keys(source).some((key) => !allowed.includes(key))
  ) {
    throw new Error(`${label}의 필수 항목이나 형식을 확인해 주세요.`)
  }
  return source
}

export function normalizeTriggerPosition(value: unknown, chunkCount: number): TriggerPosition {
  if (value === undefined) return 1
  if (value === 'end') return 'end'
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > chunkCount + 2)
    throw new Error('LoRA 트리거 위치를 확인해 주세요.')
  return value as number
}

export function normalizeImageOptions(value: unknown): ImageOptions {
  const source = allowedKeys(
    value,
    '예약 이미지 설정',
    ['aspectRatio', 'size'],
    ['aspectRatio', 'size', 'mode', 'batchSize']
  )
  if (
    !API_RATIOS.includes(source.aspectRatio as string) ||
    !['1k', '1.5k'].includes(source.size as string)
  ) {
    throw new Error('예약 이미지 비율·크기를 확인해 주세요.')
  }
  const result: ImageOptions = {
    aspectRatio: source.aspectRatio as string,
    size: source.size as '1k' | '1.5k'
  }
  if (hasOwn(source, 'mode')) {
    if (!['', 'lite', 'standard', 'pro', 'ultra'].includes(source.mode as string))
      throw new Error('예약 생성 모드를 확인해 주세요.')
    result.mode = source.mode as ImageOptions['mode']
  }
  if (hasOwn(source, 'batchSize')) {
    if (![1, 4].includes(source.batchSize as number))
      throw new Error('예약 배치 수는 1장 또는 4장이어야 합니다.')
    result.batchSize = source.batchSize as 1 | 4
  }
  return result
}

export function normalizeExtraText(value: unknown, label: string): ExtraText {
  const source = allowedKeys(value, label, [], ['prompt', 'negativePrompt'])
  return {
    prompt: presetText(source.prompt ?? ''),
    negativePrompt: presetText(source.negativePrompt ?? '')
  }
}

export function validatePresetConfiguration(
  value: unknown,
  options: { minLoraWeight?: number; maxLoraWeight?: number } = {}
): { model: ModelRef; loras: LoraRef[] } {
  const source = presetObject(value, '모델·LoRA 설정')
  const model = presetObject(source.model, '모델')
  const minWeight = options.minLoraWeight ?? -2
  const maxWeight = options.maxLoraWeight ?? 2
  if (!Array.isArray(source.loras)) throw new Error('LoRA 목록 형식을 확인해 주세요.')
  const seen = new Set<string>()
  const loras = (source.loras as unknown[]).map((item) => {
    const entry = presetObject(item, 'LoRA')
    const id = presetIdentifier(entry.id, 'LoRA', true)
    if (seen.has(id)) throw new Error(`같은 LoRA가 중복됐습니다: ${id}`)
    seen.add(id)
    if (
      !['number', 'string'].includes(typeof entry.weight) ||
      (typeof entry.weight === 'string' && !entry.weight.trim())
    ) {
      throw new Error(`LoRA ${id} 수치를 입력해 주세요.`)
    }
    const weight = Number(entry.weight)
    if (!Number.isFinite(weight) || weight < minWeight || weight > maxWeight)
      throw new Error(`LoRA ${id} 수치는 ${minWeight}~${maxWeight} 사이여야 합니다.`)
    const lora: LoraRef = { id, name: presetText(entry.name), weight }
    if (entry.versionId != null && presetText(entry.versionId))
      lora.versionId = presetIdentifier(entry.versionId, 'LoRA 버전', true)
    if (hasOwn(entry, 'triggerWords')) {
      if (typeof entry.triggerWords !== 'string')
        throw new Error(`LoRA ${id} 트리거는 문자열이어야 합니다.`)
      const triggerWords = presetText(entry.triggerWords)
      if (triggerWords) lora.triggerWords = triggerWords
    }
    return lora
  })
  const normalizedModel: ModelRef = {
    id: presetIdentifier(model.id, '모델', true),
    name: presetText(model.name),
    versionId: presetIdentifier(model.versionId, '모델 버전', true)
  }
  if (model.family != null && presetText(model.family))
    normalizedModel.family = presetText(model.family)
  return { model: normalizedModel, loras }
}

/** 청크에서 폴더 연결을 뺀 사본 (씬 카드·예약 사본용). */
export function stripFolder(chunk: Chunk): Chunk {
  return {
    id: chunk.id,
    name: chunk.name,
    prompt: chunk.prompt,
    negativePrompt: chunk.negativePrompt
  }
}

export function omitKey<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const copy = { ...value }
  delete copy[key]
  return copy
}

export function makeLibrary(): Library {
  return {
    version: 1,
    common: { prompt: '', negativePrompt: '' },
    presets: [],
    characters: [],
    chunkFolders: [],
    scenes: [],
    reservations: []
  }
}

function normalizeSceneCard(item: Rec, id: string, folderIds: Set<string>): SceneCard {
  if (!Array.isArray(item.sceneIds)) throw new Error('씬의 청크 목록 형식을 확인해 주세요.')
  const sceneIds = (item.sceneIds as unknown[]).map((value) => presetIdentifier(value, '씬 청크'))
  if (new Set(sceneIds).size !== sceneIds.length)
    throw new Error('씬에 같은 청크를 중복 넣을 수 없습니다.')
  if (!Array.isArray(item.chunks)) throw new Error('씬의 청크 사본 형식을 확인해 주세요.')
  const chunks = normalizeChunkList(item.chunks as unknown[], new Set(), '씬 청크 사본').map(
    stripFolder
  )
  if (JSON.stringify(chunks.map((chunk) => chunk.id)) !== JSON.stringify(sceneIds))
    throw new Error('씬 사본과 청크 순서가 다릅니다.')
  const card: SceneCard = { id, name: presetText(item.name), sceneIds, chunks }
  if (hasOwn(item, 'extra')) card.extra = normalizeExtraText(item.extra, '씬 추가 문구')
  if (hasOwn(item, 'imageOptions')) card.imageOptions = normalizeImageOptions(item.imageOptions)
  if (hasOwn(item, 'triggerPosition'))
    card.triggerPosition = normalizeTriggerPosition(item.triggerPosition, sceneIds.length)
  if (hasOwn(item, 'folderId')) {
    const folderId = presetIdentifier(item.folderId, '씬 모음')
    if (!folderIds.has(folderId)) throw new Error(`씬 ${id}의 모음이 없습니다: ${folderId}`)
    card.folderId = folderId
  }
  return card
}

function normalizeCast(item: Rec, id: string): Cast {
  const cast: Cast = {
    id,
    name: presetText(item.name),
    characterId: presetIdentifier(item.characterId, '출연 캐릭터'),
    presetId: presetIdentifier(item.presetId, '출연 프리셋')
  }
  if (hasOwn(item, 'extra')) cast.extra = normalizeExtraText(item.extra, '출연 추가 문구')
  if (hasOwn(item, 'triggerPosition'))
    cast.triggerPosition = normalizeTriggerPosition(item.triggerPosition, 1000)
  return cast
}

export const batchRowKey = (row: Pick<BatchRow, 'kind' | 'id'>): string => `${row.kind}:${row.id}`
export const batchCellKey = (rowKey: string, columnId: string): string => `${rowKey}|${columnId}`

export function normalizeBatchPlan(item: unknown, id = 'plan'): BatchPlan {
  const source = allowedKeys(
    item,
    '일괄 예약 구성',
    ['rows', 'columns', 'count'],
    ['id', 'name', 'rows', 'columns', 'count', 'exceptions', 'order', 'imageOptions']
  )
  if (!Array.isArray(source.rows) || !Array.isArray(source.columns))
    throw new Error('일괄 예약의 행·열 목록 형식을 확인해 주세요.')
  const rows = (source.rows as unknown[]).map((row) => {
    const entry = allowedKeys(row, '일괄 예약 행', ['kind', 'id'], ['kind', 'id', 'presetId'])
    if (entry.kind !== 'character' && entry.kind !== 'cast')
      throw new Error('일괄 예약 행 종류는 캐릭터 또는 출연이어야 합니다.')
    const result: BatchRow = { kind: entry.kind, id: presetIdentifier(entry.id, '일괄 예약 행') }
    if (hasOwn(entry, 'presetId') && presetText(entry.presetId))
      result.presetId = presetIdentifier(entry.presetId, '행 프리셋')
    return result
  })
  if (new Set(rows.map(batchRowKey)).size !== rows.length)
    throw new Error('일괄 예약 행이 중복됐습니다.')
  const columns = (source.columns as unknown[]).map((value) =>
    presetIdentifier(value, '일괄 예약 씬')
  )
  if (new Set(columns).size !== columns.length) throw new Error('일괄 예약 씬이 중복됐습니다.')
  const plan: BatchPlan = {
    id: presetIdentifier(id, '일괄 예약 구성'),
    name: presetText(source.name ?? ''),
    rows,
    columns,
    count: presetInteger(source.count, '일괄 반복 수', 1, 100),
    exceptions: {},
    order: 'byRow'
  }
  if (hasOwn(source, 'order') && source.order != null) {
    if (source.order !== 'byRow' && source.order !== 'byColumn')
      throw new Error('순회 순서는 캐릭터별 또는 씬별이어야 합니다.')
    plan.order = source.order
  }
  if (hasOwn(source, 'exceptions') && source.exceptions != null) {
    const exceptions = presetObject(source.exceptions, '조합별 예외')
    const rowKeys = new Set(rows.map(batchRowKey))
    for (const [key, value] of Object.entries(exceptions)) {
      const split = key.indexOf('|')
      if (split < 0) throw new Error(`조합별 예외의 대상을 확인해 주세요: ${key}`)
      // 선택에서 빠진 행/열의 예외는 오류가 아니라 버린다 — 저장한 구성이 체크 해제에도 살아남게.
      if (!rowKeys.has(key.slice(0, split)) || !columns.includes(key.slice(split + 1))) continue
      plan.exceptions[key] = presetInteger(value, '조합별 반복 수', 0, 100)
    }
  }
  if (hasOwn(source, 'imageOptions') && source.imageOptions != null)
    plan.imageOptions = normalizeImageOptions(source.imageOptions)
  return plan
}

function normalizeBatchTag(value: unknown): BatchTag {
  const source = allowedKeys(
    value,
    '예약 묶음',
    ['id', 'name'],
    ['id', 'name', 'rowName', 'columnName']
  )
  return {
    id: presetIdentifier(source.id, '예약 묶음'),
    name: presetText(source.name),
    rowName: presetText(source.rowName ?? ''),
    columnName: presetText(source.columnName ?? '')
  }
}

function normalizeChunkList(items: unknown[], folderIds: Set<string>, label: string): Chunk[] {
  const seen = new Set<string>()
  return items.map((raw) => {
    const item = presetObject(raw, label)
    const id = presetIdentifier(item.id, label)
    if (seen.has(id)) throw new Error(`${label} ID가 중복됐습니다: ${id}`)
    seen.add(id)
    const chunk: Chunk = {
      id,
      name: presetText(item.name),
      prompt: presetText(item.prompt),
      negativePrompt: presetText(item.negativePrompt)
    }
    if (hasOwn(item, 'folderId')) {
      const folderId = presetIdentifier(item.folderId, '청크 폴더')
      if (!folderIds.has(folderId)) throw new Error(`청크 ${id}의 폴더가 없습니다: ${folderId}`)
      chunk.folderId = folderId
    }
    return chunk
  })
}

export function normalizeSnapshot(value: unknown): Snapshot {
  const source = allowedKeys(
    value,
    '예약 사본',
    ['common', 'preset', 'character', 'chunks'],
    ['common', 'preset', 'character', 'chunks', 'extras']
  )
  const frozen = normalizeLibrary({
    version: 1,
    common: source.common,
    presets: [source.preset],
    // Folders organize the live library; frozen prompts must survive folder deletion.
    characters: [omitKey(presetObject(source.character, '캐릭터 사본'), 'folderId')],
    scenes: source.chunks,
    reservations: []
  })
  const snapshot: Snapshot = {
    common: frozen.common,
    preset: frozen.presets[0],
    character: frozen.characters[0],
    chunks: frozen.scenes
  }
  if (hasOwn(source, 'extras')) {
    const extras = allowedKeys(source.extras, '사본 추가 문구', [], ['cast', 'scene'])
    snapshot.extras = {}
    if (hasOwn(extras, 'cast'))
      snapshot.extras.cast = normalizeExtraText(extras.cast, '출연 추가 문구')
    if (hasOwn(extras, 'scene'))
      snapshot.extras.scene = normalizeExtraText(extras.scene, '씬 추가 문구')
  }
  return snapshot
}

/** 라이브러리 정규화 — 스크립트의 normalizePresetLibrary와 같은 규칙. 없는 선택 키는 만들지 않는다. */
export function normalizeLibrary(value: unknown): Library {
  const source = presetObject(value, '프리셋 라이브러리')
  if (source.version !== 1) throw new Error('지원하지 않는 프리셋 라이브러리 버전입니다.')
  const common = presetObject(source.common, '공통 프롬프트')
  function entries<T>(key: string, build: (item: Rec, id: string) => T, optional = false): T[] {
    if (optional && !hasOwn(source, key)) return []
    if (!Array.isArray(source[key])) throw new Error(`${key} 목록 형식을 확인해 주세요.`)
    const seen = new Set<string>()
    return (source[key] as unknown[]).map((raw) => {
      const item = presetObject(raw, key)
      const id = presetIdentifier(item.id, key)
      if (seen.has(id)) throw new Error(`${key} ID가 중복됐습니다: ${id}`)
      seen.add(id)
      return build(item, id)
    })
  }
  const folders = (key: string, label: string): Folder[] =>
    entries(
      key,
      (item, id) => {
        if (typeof item.name !== 'string' || !presetText(item.name))
          throw new Error(`${label} 이름을 입력해 주세요.`)
        return { id, name: presetText(item.name) }
      },
      true
    )
  const chunkFolders = folders('chunkFolders', '청크 폴더')
  const characterFolders = folders('characterFolders', '캐릭터 폴더')
  const characterFolderIds = new Set(characterFolders.map((item) => item.id))
  const sceneFolders = folders('sceneFolders', '씬 모음')
  const folderIds = new Set(chunkFolders.map((item) => item.id))
  const library: Library = {
    version: 1,
    common: {
      prompt: presetText(common.prompt),
      negativePrompt: presetText(common.negativePrompt)
    },
    presets: entries('presets', (item, id) => {
      const preset: Preset = {
        id,
        name: presetText(item.name),
        ...validatePresetConfiguration(item)
      }
      // Optional per-preset common text; older presets keep their shape untouched.
      if (hasOwn(item, 'prompt')) preset.prompt = presetText(item.prompt)
      if (hasOwn(item, 'negativePrompt')) preset.negativePrompt = presetText(item.negativePrompt)
      return preset
    }),
    characters: entries('characters', (item, id) => {
      const character: Character = {
        id,
        name: presetText(item.name),
        prompt: presetText(item.prompt),
        negativePrompt: presetText(item.negativePrompt)
      }
      if (hasOwn(item, 'defaultPresetId') && presetText(item.defaultPresetId))
        character.defaultPresetId = presetIdentifier(item.defaultPresetId, '기본 프리셋')
      if (hasOwn(item, 'folderId')) {
        const folderId = presetIdentifier(item.folderId, '캐릭터 폴더')
        if (!characterFolderIds.has(folderId))
          throw new Error(`캐릭터 ${id}의 폴더가 없습니다: ${folderId}`)
        character.folderId = folderId
      }
      return character
    }),
    chunkFolders,
    scenes: [],
    reservations: []
  }
  if (!Array.isArray(source.scenes)) throw new Error('scenes 목록 형식을 확인해 주세요.')
  library.scenes = normalizeChunkList(source.scenes as unknown[], folderIds, 'scenes')
  library.reservations = entries('reservations', (item, id) => {
    const sourceIds = hasOwn(item, 'sceneIds') ? item.sceneIds : [item.sceneId]
    if (!Array.isArray(sourceIds))
      throw new Error('선택한 프롬프트 청크 목록 형식을 확인해 주세요.')
    const sceneIds = (sourceIds as unknown[]).map((sceneId) =>
      presetIdentifier(sceneId, '프롬프트 청크')
    )
    if (new Set(sceneIds).size !== sceneIds.length)
      throw new Error('같은 프롬프트 청크를 중복 선택할 수 없습니다.')
    const reservation: Reservation = {
      id,
      presetId: presetIdentifier(item.presetId, '설정 프리셋'),
      characterId: presetIdentifier(item.characterId, '캐릭터'),
      sceneIds,
      count: presetInteger(item.count, '예약 반복 횟수', 1, 100)
    }
    if (hasOwn(item, 'triggerPosition'))
      reservation.triggerPosition = normalizeTriggerPosition(item.triggerPosition, sceneIds.length)
    if (hasOwn(item, 'imageOptions'))
      reservation.imageOptions = normalizeImageOptions(item.imageOptions)
    if (hasOwn(item, 'sourceSceneId'))
      reservation.sourceSceneId = presetIdentifier(item.sourceSceneId, '원본 씬')
    if (hasOwn(item, 'batch')) reservation.batch = normalizeBatchTag(item.batch)
    if (hasOwn(item, 'snapshot')) {
      reservation.snapshot = normalizeSnapshot(item.snapshot)
      const frozen = reservation.snapshot
      if (
        frozen.preset.id !== reservation.presetId ||
        frozen.character.id !== reservation.characterId ||
        JSON.stringify(frozen.chunks.map((chunk) => chunk.id)) !== JSON.stringify(sceneIds)
      ) {
        throw new Error('예약 사본과 재료 ID가 다릅니다.')
      }
    }
    return reservation
  })
  if (hasOwn(source, 'combinations')) {
    library.combinations = entries('combinations', (item, id) => {
      const sceneIds = item.sceneIds
      if (!Array.isArray(sceneIds) || new Set(sceneIds).size !== sceneIds.length)
        throw new Error('조합 기록의 청크 순서를 확인해 주세요.')
      if (typeof item.favorite !== 'boolean') throw new Error('조합 즐겨찾기 형식을 확인해 주세요.')
      const entry: Combination = {
        id,
        presetId: presetIdentifier(item.presetId, '기록 프리셋'),
        characterId: presetIdentifier(item.characterId, '기록 캐릭터'),
        sceneIds: (sceneIds as unknown[]).map((value) => presetIdentifier(value, '기록 청크')),
        count: presetInteger(item.count, '기록 횟수', 1, 100),
        favorite: item.favorite,
        name: presetText(item.name),
        at: presetInteger(item.at, '기록 시각', 0, Number.MAX_SAFE_INTEGER)
      }
      if (hasOwn(item, 'triggerPosition'))
        entry.triggerPosition = normalizeTriggerPosition(item.triggerPosition, sceneIds.length)
      if (hasOwn(item, 'imageOptions'))
        entry.imageOptions = normalizeImageOptions(item.imageOptions)
      return entry
    })
    if (
      library.combinations.filter((item) => !item.favorite).length > 50 ||
      library.combinations.filter((item) => item.favorite).length > 1000
    ) {
      throw new Error('최근 조합은 50개, 즐겨찾기는 1,000개까지 저장할 수 있습니다.')
    }
  }
  if (hasOwn(source, 'characterFolders')) library.characterFolders = characterFolders
  if (hasOwn(source, 'sceneFolders')) library.sceneFolders = sceneFolders
  const sceneFolderIds = new Set(sceneFolders.map((item) => item.id))
  if (hasOwn(source, 'sceneCards'))
    library.sceneCards = entries('sceneCards', (item, id) =>
      normalizeSceneCard(item, id, sceneFolderIds)
    )
  if (hasOwn(source, 'casts'))
    library.casts = entries('casts', (item, id) => normalizeCast(item, id))
  if (hasOwn(source, 'batchPlans'))
    library.batchPlans = entries('batchPlans', (item, id) => normalizeBatchPlan(item, id))
  if (library.reservations.reduce((sum, item) => sum + item.count, 0) > MAX_RESERVED_JOBS)
    throw new Error('예약 작업은 한 번에 1,000개까지 만들 수 있습니다.')
  return library
}

/** 스크립트 백업과 같은 엄격한 키 검사 (앱 전용 키 포함). */
export function strictLibrary(value: unknown): Library {
  const source = allowedKeys(
    value,
    '프리셋 라이브러리',
    ['version', 'common', 'presets', 'characters', 'scenes', 'reservations'],
    [
      'version',
      'common',
      'presets',
      'characters',
      'characterFolders',
      'chunkFolders',
      'scenes',
      'reservations',
      'combinations',
      'sceneFolders',
      'sceneCards',
      'casts',
      'batchPlans'
    ]
  )
  allowedKeys(source.common, '공통 프롬프트', ['prompt', 'negativePrompt'])
  const library = normalizeLibrary(source)
  const list = (key: string): unknown[] =>
    Array.isArray(source[key]) ? (source[key] as unknown[]) : []
  for (const folder of [
    ...list('characterFolders'),
    ...list('chunkFolders'),
    ...list('sceneFolders')
  ])
    allowedKeys(folder, '폴더', ['id', 'name'])
  for (const item of list('presets')) {
    const preset = allowedKeys(
      item,
      '설정 프리셋',
      ['id', 'name', 'model', 'loras'],
      ['id', 'name', 'model', 'loras', 'prompt', 'negativePrompt']
    )
    allowedKeys(
      preset.model,
      '모델',
      ['id', 'name', 'versionId'],
      ['id', 'name', 'versionId', 'family']
    )
    for (const lora of preset.loras as unknown[])
      allowedKeys(
        lora,
        'LoRA',
        ['id', 'name', 'weight'],
        ['id', 'name', 'weight', 'versionId', 'triggerWords']
      )
  }
  const fields = ['id', 'name', 'prompt', 'negativePrompt']
  for (const item of list('characters'))
    allowedKeys(item, '캐릭터', fields, [...fields, 'defaultPresetId', 'folderId'])
  for (const item of list('scenes')) allowedKeys(item, '청크', fields, [...fields, 'folderId'])
  for (const item of list('reservations')) {
    allowedKeys(
      item,
      '조합 예약',
      ['id', 'presetId', 'characterId', 'count'],
      [
        'id',
        'presetId',
        'characterId',
        'count',
        'sceneId',
        'sceneIds',
        'snapshot',
        'triggerPosition',
        'imageOptions',
        'batch',
        'sourceSceneId'
      ]
    )
  }
  for (const item of list('combinations')) {
    allowedKeys(
      item,
      '조합 기록',
      ['id', 'presetId', 'characterId', 'sceneIds', 'count', 'favorite', 'name', 'at'],
      [
        'id',
        'presetId',
        'characterId',
        'sceneIds',
        'count',
        'favorite',
        'name',
        'at',
        'triggerPosition',
        'imageOptions'
      ]
    )
  }
  for (const item of list('sceneCards'))
    allowedKeys(
      item,
      '씬',
      ['id', 'name', 'sceneIds', 'chunks'],
      ['id', 'name', 'sceneIds', 'chunks', 'extra', 'imageOptions', 'triggerPosition', 'folderId']
    )
  for (const item of list('casts'))
    allowedKeys(
      item,
      '출연',
      ['id', 'name', 'characterId', 'presetId'],
      ['id', 'name', 'characterId', 'presetId', 'extra', 'triggerPosition']
    )
  for (const item of list('batchPlans'))
    allowedKeys(
      item,
      '일괄 예약 구성',
      ['id', 'rows', 'columns', 'count'],
      ['id', 'name', 'rows', 'columns', 'count', 'exceptions', 'order', 'imageOptions']
    )
  return library
}

/** 스크립트(0.9.x)가 읽을 수 있는 모양: 앱 전용 키·필드를 뺀다. 예약 사본의 extras는 문구에 녹여 넣을 수 없으므로 그런 예약은 제외하고 개수를 알려 준다. */
export interface ScriptExportDropped {
  /** 제외한 예약 수 (출연·씬 추가 문구 또는 실제 적용할 프리셋 문구가 있는 것) */
  reservations: number
  /** 그중 프리셋 문구 때문에 제외한 예약 수 */
  reservationsWithPresetText: number
  /** 문구가 있는 프리셋 이름 — 스크립트에서는 문구 없이 적용된다 */
  presetsWithText: string[]
  /** 문구 있는 프리셋을 참조하는 최근 조합·즐겨찾기 수 — 스크립트에서 불러오면 문구가 빠진다 */
  combinationsWithPresetText: number
  keys: string[]
}

/** 스크립트가 아는 프리셋 모양: 문구 필드를 뺀다. */
function presetForScript(preset: Preset): Preset {
  return omitKey(omitKey(preset, 'prompt'), 'negativePrompt')
}

export function exportForScript(value: unknown): {
  library: Library
  dropped: ScriptExportDropped
} {
  const library = normalizeLibrary(value)
  const dropped: ScriptExportDropped = {
    reservations: 0,
    reservationsWithPresetText: 0,
    presetsWithText: library.presets
      .filter(presetHasText)
      .map((preset) => preset.name || preset.id),
    combinationsWithPresetText: 0,
    keys: []
  }
  const textPresetIds = new Set(library.presets.filter(presetHasText).map((preset) => preset.id))
  dropped.combinationsWithPresetText = (library.combinations ?? []).filter((item) =>
    textPresetIds.has(item.presetId)
  ).length
  const out: Library = {
    version: 1,
    common: library.common,
    presets: library.presets.map(presetForScript),
    characters: library.characters.map((character) => omitKey(character, 'defaultPresetId')),
    chunkFolders: library.chunkFolders,
    scenes: library.scenes,
    reservations: library.reservations
      .filter((item) => {
        // Match expandReservations: use today's preset only when no frozen copy exists.
        const preset =
          item.snapshot?.preset ?? library.presets.find((preset) => preset.id === item.presetId)
        if (preset && presetHasText(preset)) {
          dropped.reservations++
          dropped.reservationsWithPresetText++
          return false
        }
        if (item.snapshot?.extras) {
          dropped.reservations++
          return false
        }
        return true
      })
      .map((item) => {
        const plain = omitKey(omitKey(item, 'batch'), 'sourceSceneId')
        return plain.snapshot
          ? {
              ...plain,
              snapshot: { ...plain.snapshot, preset: presetForScript(plain.snapshot.preset) }
            }
          : plain
      })
  }
  if (dropped.presetsWithText.length) dropped.keys.push('presets.prompt')
  if (library.combinations) out.combinations = library.combinations
  if (library.characterFolders) out.characterFolders = library.characterFolders
  for (const key of ['sceneFolders', 'sceneCards', 'casts', 'batchPlans'] as const)
    if (library[key]) dropped.keys.push(key)
  if (library.characters.some((item) => item.defaultPresetId))
    dropped.keys.push('characters.defaultPresetId')
  if (library.reservations.some((item) => item.batch)) dropped.keys.push('reservations.batch')
  return { library: out, dropped }
}

// ---- 설정 백업 (스크립트 형식 'pixai-web-queue-settings' v1) ----

export interface WorkspaceUI {
  paneRatios?: Partial<Record<'compose' | 'scenes' | 'library', number[]>>
  collapsedPane?: Partial<Record<'compose' | 'scenes' | 'library', number>>
  sceneView?: 'grid' | 'list'
}
export function normalizeWorkspaceUI(value: unknown): WorkspaceUI {
  const raw = allowedKeys(value, '화면 설정', [], ['paneRatios', 'collapsedPane', 'sceneView'])
  const result: WorkspaceUI = {}
  if (raw.sceneView !== undefined) {
    if (!['grid', 'list'].includes(raw.sceneView as string))
      throw new Error('씬 보기 방식을 확인해 주세요.')
    result.sceneView = raw.sceneView as 'grid' | 'list'
  }
  if (raw.paneRatios !== undefined) {
    const ratios = allowedKeys(raw.paneRatios, '칸 비율', [], ['compose', 'scenes', 'library'])
    result.paneRatios = {}
    for (const name of ['compose', 'scenes', 'library'] as const)
      if (ratios[name] !== undefined) {
        const values = ratios[name]
        if (
          !Array.isArray(values) ||
          values.length !== 3 ||
          values.some((n) => typeof n !== 'number' || !Number.isFinite(n) || n < 5 || n > 90) ||
          Math.abs(values.reduce((a, b) => a + b, 0) - 100) > 0.1
        )
          throw new Error('칸 비율을 확인해 주세요.')
        result.paneRatios[name] = [...values]
      }
  }
  if (raw.collapsedPane !== undefined) {
    const collapsed = allowedKeys(
      raw.collapsedPane,
      '접힌 칸',
      [],
      ['compose', 'scenes', 'library']
    )
    result.collapsedPane = {}
    for (const name of ['compose', 'scenes', 'library'] as const)
      if (collapsed[name] !== undefined)
        result.collapsedPane[name] = presetInteger(collapsed[name], '접힌 칸', 0, 2)
  }
  return result
}
export interface SettingsOptions {
  ui?: WorkspaceUI
  maxCredits: number | null
  filePrefix: string
  repeat: number
  imageCount?: number
  maxInFlight?: number
  api?: Record<string, unknown>
}

export interface SettingsBackup {
  format: 'pixai-web-queue-settings'
  version: 1
  appVersion: string
  exportedAt: string
  library: Library
  options: SettingsOptions
}

export function normalizeSettingsOptions(value: unknown): SettingsOptions {
  const source = allowedKeys(
    value,
    '대기열 옵션',
    ['maxCredits', 'filePrefix', 'repeat'],
    ['maxCredits', 'filePrefix', 'repeat', 'maxInFlight', 'imageCount', 'api', 'ui']
  )
  if (
    source.maxCredits !== null &&
    (typeof source.maxCredits !== 'number' ||
      !Number.isSafeInteger(source.maxCredits) ||
      source.maxCredits < 1)
  ) {
    throw new Error('크레딧 상한은 양의 정수 또는 제한 없음이어야 합니다.')
  }
  if (typeof source.filePrefix !== 'string') throw new Error('파일 이름은 문자열이어야 합니다.')
  if (typeof source.repeat !== 'number') throw new Error('반복 횟수는 1~100의 정수여야 합니다.')
  const options: SettingsOptions = {
    maxCredits: source.maxCredits as number | null,
    filePrefix: presetText(source.filePrefix),
    repeat: presetInteger(source.repeat, '반복 횟수', 1, 100)
  }
  if (hasOwn(source, 'ui')) options.ui = normalizeWorkspaceUI(source.ui)
  if (hasOwn(source, 'maxInFlight'))
    options.maxInFlight = presetInteger(source.maxInFlight, '미리 등록할 작업 수', 1, 10)
  if (hasOwn(source, 'imageCount')) {
    options.imageCount = presetInteger(source.imageCount, '생성당 이미지 수', 0, 4)
    if (![0, 1, 4].includes(options.imageCount))
      throw new Error('생성당 이미지 수는 사이트 선택·1장·4장 중 골라 주세요.')
  }
  if (hasOwn(source, 'api')) {
    const api = presetObject(source.api, '공식 API 옵션')
    if (
      Object.keys(api).some(
        (key) => !['modelVersionId', 'aspectRatio', 'size', 'mode', 'style', 'seed'].includes(key)
      )
    )
      throw new Error('공식 API 옵션 형식을 확인해 주세요. 키는 백업에 넣을 수 없습니다.')
    options.api = { ...api }
  }
  return options
}

export function parseSettingsBackup(text: string): SettingsBackup {
  if (typeof text !== 'string') throw new Error('설정 파일 내용을 읽을 수 없습니다.')
  const maxBytes = 5 * 1024 * 1024
  if (text.length > maxBytes || new TextEncoder().encode(text).byteLength > maxBytes)
    throw new Error('설정 파일은 5MiB 이하만 불러올 수 있습니다.')
  let value: unknown
  let forbiddenKey = false
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''), (key, item) => {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) {
        forbiddenKey = true
        throw new Error('허용하지 않는 객체 속성')
      }
      return item
    })
  } catch {
    throw new Error(
      forbiddenKey
        ? '설정 파일에 허용하지 않는 객체 속성이 있습니다.'
        : '설정 파일의 JSON 형식을 확인해 주세요.'
    )
  }
  const source = allowedKeys(value, '설정 백업', [
    'format',
    'version',
    'appVersion',
    'exportedAt',
    'library',
    'options'
  ])
  if (source.format !== 'pixai-web-queue-settings' || source.version !== 1)
    throw new Error('지원하지 않는 설정 백업 형식 또는 버전입니다.')
  if (typeof source.appVersion !== 'string' || !source.appVersion.trim())
    throw new Error('백업의 스크립트 버전을 확인해 주세요.')
  if (typeof source.exportedAt !== 'string' || !Number.isFinite(Date.parse(source.exportedAt)))
    throw new Error('백업의 저장 시각을 확인해 주세요.')
  return {
    format: 'pixai-web-queue-settings',
    version: 1,
    appVersion: source.appVersion.trim(),
    exportedAt: new Date(Date.parse(source.exportedAt)).toISOString(),
    library: strictLibrary(source.library),
    options: normalizeSettingsOptions(source.options)
  }
}

export function makeSettingsBackup(
  library: unknown,
  options: unknown,
  meta: { appVersion: string; exportedAt: string },
  target: 'app' | 'script' = 'app'
): SettingsBackup {
  const normalized = target === 'script' ? exportForScript(library).library : strictLibrary(library)
  return {
    format: 'pixai-web-queue-settings',
    version: 1,
    appVersion: meta.appVersion,
    exportedAt: meta.exportedAt,
    library: strictLibrary(normalized),
    options:
      target === 'script'
        ? (omitKey(normalizeSettingsOptions(options), 'ui') as unknown as SettingsOptions)
        : normalizeSettingsOptions(options)
  }
}

// ---- 문구 조립 ----

const joinParts = (...parts: Array<string | undefined>): string =>
  parts
    .map((part) => presetText(part))
    .filter(Boolean)
    .join(', ')

/**
 * 공통(전역 공통 + 프리셋 공통) → (트리거) → 캐릭터+출연 문구 → 청크들 → 씬 문구.
 * 트리거 위치: 0=맨 앞, 1=공통 블록 뒤, 2=캐릭터 뒤, k+2=청크 k 뒤, 'end'=맨 뒤.
 * 프리셋 문구는 전역 공통 바로 뒤에 붙는 같은 블록이라 트리거 인덱스를 바꾸지 않는다.
 */
export function composePrompts(
  common: ExtraText,
  character: ExtraText,
  chunks: ExtraText[],
  preset: { loras: LoraRef[]; prompt?: string; negativePrompt?: string },
  triggerPosition: TriggerPosition = 1,
  extras: { cast?: ExtraText; scene?: ExtraText } = {}
): ExtraText {
  const triggers = preset.loras.map((item) => presetText(item.triggerWords ?? ''))
  const promptParts = [
    joinParts(common.prompt, preset.prompt),
    joinParts(character.prompt, extras.cast?.prompt),
    ...chunks.map((item) => item.prompt)
  ]
  const position = normalizeTriggerPosition(triggerPosition, chunks.length)
  if (position === 'end') promptParts.push(extras.scene?.prompt ?? '', ...triggers)
  else {
    promptParts.splice(position, 0, ...triggers)
    promptParts.push(extras.scene?.prompt ?? '')
  }
  const negativeParts = [
    joinParts(common.negativePrompt, preset.negativePrompt),
    joinParts(character.negativePrompt, extras.cast?.negativePrompt),
    ...chunks.map((item) => item.negativePrompt),
    extras.scene?.negativePrompt ?? ''
  ]
  return { prompt: joinParts(...promptParts), negativePrompt: joinParts(...negativeParts) }
}

export interface ExpandedRequest {
  id: string
  title: string
  prompt: string
  negativePrompt: string
  configuration: { model: ModelRef; loras: LoraRef[] }
  imageOptions?: ImageOptions
  composition: {
    version: 2
    reservation: Reservation & { repeat: number }
    common: ExtraText
    preset: Preset
    character: Character
    chunks: Chunk[]
  }
}

/** 예약 → 생성 요청 재료(작업). 스크립트의 expandPresetReservations와 같은 규칙; 대기열 상태 필드는 앱 대기열이 붙인다. */
export function expandReservations(
  value: unknown,
  options: { idFactory?: () => string; titlePrefix?: string } = {}
): ExpandedRequest[] {
  const library = normalizeLibrary(value)
  const idFactory = options.idFactory ?? (() => globalThis.crypto.randomUUID())
  const prefix = presetText(options.titlePrefix)
  const copy = <T>(item: T): T => JSON.parse(JSON.stringify(item))
  const jobs: ExpandedRequest[] = []
  const ids = new Set<string>()
  for (const reservation of library.reservations) {
    const frozen = reservation.snapshot
    const common = frozen?.common ?? library.common
    const preset =
      frozen?.preset ?? library.presets.find((item) => item.id === reservation.presetId)
    const character =
      frozen?.character ?? library.characters.find((item) => item.id === reservation.characterId)
    if (!preset) throw new Error(`예약 ${reservation.id}의 설정 프리셋이 없습니다.`)
    if (!character) throw new Error(`예약 ${reservation.id}의 캐릭터가 없습니다.`)
    const chunks =
      frozen?.chunks ??
      reservation.sceneIds.map((sceneId) => {
        const chunk = library.scenes.find((item) => item.id === sceneId)
        if (!chunk) throw new Error(`예약 ${reservation.id}의 프롬프트 청크가 없습니다: ${sceneId}`)
        return chunk
      })
    const prompts = composePrompts(
      common,
      character,
      chunks,
      preset,
      reservation.triggerPosition,
      frozen?.extras
    )
    if (!prompts.prompt) throw new Error(`예약 ${reservation.id}의 조합 프롬프트가 비어 있습니다.`)
    for (let repeat = 1; repeat <= reservation.count; repeat++) {
      const id = presetIdentifier(idFactory(), '작업')
      if (ids.has(id)) throw new Error('새 작업 ID가 중복됐습니다.')
      ids.add(id)
      jobs.push({
        id,
        title: [
          prefix,
          character.name || '캐릭터',
          chunks.map((item) => item.name || '청크').join('+'),
          preset.name || '프리셋',
          String(repeat)
        ]
          .filter(Boolean)
          .join('_'),
        ...prompts,
        configuration: copy({ model: preset.model, loras: preset.loras }),
        ...(reservation.imageOptions ? { imageOptions: copy(reservation.imageOptions) } : {}),
        composition: {
          version: 2,
          reservation: copy({ ...reservation, repeat }),
          common: copy(common),
          preset: copy(preset),
          character: copy(character),
          chunks: copy(chunks)
        }
      })
    }
  }
  return jobs
}
