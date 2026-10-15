/**
 * 여러 캐릭터(출연) × 여러 씬 일괄 예약.
 *
 * 행 = 캐릭터 또는 출연(A1, A2, A3, B1, B2 …), 열 = 씬(표정1, 표정2 …). 쌍마다 **별도 작업**으로 펼친다 —
 * 한 장에 여러 명을 넣는 단체 구성이 아니다. 결과는 보통의 예약(Reservation) 여러 개라 등록·확정·복구는 기존 흐름 그대로다.
 * 설계: docs/plans/2026-10-10_pixai-batch-reservation-design.md §2–§3.
 */
import {
  type BatchPlan,
  type BatchRow,
  type Cast,
  type Chunk,
  type ExtraText,
  type ImageOptions,
  type Library,
  type Reservation,
  type SceneCard,
  type TriggerPosition,
  MAX_RESERVED_JOBS,
  batchCellKey,
  batchRowKey,
  normalizeBatchPlan,
  normalizeImageOptions,
  normalizeLibrary,
  resolvePresetCommon,
  normalizeSnapshot,
  normalizeTriggerPosition,
  presetIdentifier,
  presetInteger,
  presetObject,
  presetText,
  stripFolder
} from './library'

import { expansionBudget } from './expansion-budget'

const defaultIdFactory = (): string => globalThis.crypto.randomUUID()

export interface SceneCardInput {
  id?: string
  name?: string
  sceneIds: string[]
  extra?: ExtraText
  imageOptions?: ImageOptions
  triggerPosition?: TriggerPosition
  folderId?: string
}

/** 라이브러리 청크로 씬 카드를 만든다. 이름이 비면 청크 이름을 ' · '로 잇는다. 캐릭터·프리셋은 절대 넣지 않는다. */
export function makeSceneCard(
  value: unknown,
  input: SceneCardInput,
  options: { idFactory?: () => string } = {}
): SceneCard {
  const library = normalizeLibrary(value)
  const source = presetObject(input, '씬') as unknown as SceneCardInput
  if (!Array.isArray(source.sceneIds) || !source.sceneIds.length)
    throw new Error('씬에 넣을 청크를 하나 이상 골라 주세요.')
  const chunks: Chunk[] = source.sceneIds.map((id) => {
    const found = library.scenes.find((item) => item.id === id)
    if (!found) throw new Error(`씬에 넣을 청크가 없습니다: ${id}`)
    return stripFolder(found)
  })
  const card: Record<string, unknown> = {
    id: source.id ?? (options.idFactory ?? defaultIdFactory)(),
    name: presetText(source.name ?? '') || chunks.map((item) => item.name || '청크').join(' · '),
    sceneIds: [...source.sceneIds],
    chunks
  }
  for (const key of ['extra', 'imageOptions', 'triggerPosition', 'folderId'] as const)
    if (source[key] != null) card[key] = source[key]
  const sceneFolders = library.sceneFolders ?? []
  const normalized = normalizeLibrary({ ...library, sceneFolders, sceneCards: [card] })
  return normalized.sceneCards![0]
}

/** 카드의 청크 사본과 현재 라이브러리를 비교만 한다. 카드는 바꾸지 않는다 — 사용자가 차이를 확인하면 돌려준 card로 교체. */
export function refreshSceneCard(
  value: unknown,
  cardId: string
): {
  card: SceneCard
  changes: {
    id: string
    field: 'name' | 'prompt' | 'negativePrompt'
    before: string
    after: string
  }[]
  missing: string[]
} {
  const library = normalizeLibrary(value)
  const card = (library.sceneCards ?? []).find((item) => item.id === cardId)
  if (!card) throw new Error('갱신할 씬이 없습니다.')
  const changes: {
    id: string
    field: 'name' | 'prompt' | 'negativePrompt'
    before: string
    after: string
  }[] = []
  const missing: string[] = []
  const chunks = card.chunks.map((copy) => {
    const live = library.scenes.find((item) => item.id === copy.id)
    if (!live) {
      missing.push(copy.id)
      return copy
    }
    for (const field of ['name', 'prompt', 'negativePrompt'] as const)
      if (live[field] !== copy[field])
        changes.push({ id: copy.id, field, before: copy[field], after: live[field] })
    return stripFolder(live)
  })
  return { card: { ...card, chunks }, changes, missing }
}

export function defaultBatchName(rowCount: number, columnCount: number, now?: number): string {
  const at = new Date(now ?? Date.now())
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `캐릭터 ${rowCount} × 씬 ${columnCount} · ${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

export interface ResolvedRow {
  key: string
  kind: BatchRow['kind']
  id: string
  name: string
  characterId: string
  presetId: string
  extra?: ExtraText
  triggerPosition?: TriggerPosition
  problems: string[]
}

/** 행 하나를 캐릭터+프리셋으로 해석한다. 프리셋 미지정·삭제된 재료는 problems로 알린다(임의 대체 없음). */
export function resolveBatchRow(value: unknown, row: BatchRow): ResolvedRow {
  return resolveRow(normalizeLibrary(value), row)
}

function resolveRow(library: Library, row: BatchRow): ResolvedRow {
  const key = batchRowKey(row)
  const problems: string[] = []
  let characterId = ''
  let presetId = ''
  let name = row.id
  let extra: ExtraText | undefined
  let triggerPosition: TriggerPosition | undefined
  if (row.kind === 'cast') {
    const cast: Cast | undefined = (library.casts ?? []).find((item) => item.id === row.id)
    if (!cast)
      return {
        key,
        kind: 'cast',
        id: row.id,
        name,
        characterId,
        presetId,
        problems: [`출연 ${row.id}이(가) 없습니다.`]
      }
    ;({ characterId, presetId, extra, triggerPosition } = cast)
    name = cast.name || cast.id
  } else {
    const character = library.characters.find((item) => item.id === row.id)
    if (!character)
      return {
        key,
        kind: 'character',
        id: row.id,
        name,
        characterId,
        presetId,
        problems: [`캐릭터 ${row.id}이(가) 없습니다.`]
      }
    characterId = character.id
    name = character.name || character.id
    presetId = row.presetId || character.defaultPresetId || ''
    if (!presetId) problems.push(`캐릭터 「${name}」의 모델·LoRA 프리셋이 지정되지 않았습니다.`)
  }
  if (presetId && !library.presets.some((item) => item.id === presetId))
    problems.push(`「${name}」의 프리셋 ${presetId}이(가) 없습니다.`)
  if (characterId && !library.characters.some((item) => item.id === characterId))
    problems.push(`출연 「${name}」의 캐릭터 ${characterId}이(가) 없습니다.`)
  return {
    key,
    kind: row.kind,
    id: row.id,
    name,
    characterId,
    presetId,
    ...(extra ? { extra } : {}),
    ...(triggerPosition !== undefined ? { triggerPosition } : {}),
    problems
  }
}

export interface BatchProblem {
  level: 'error' | 'warning'
  message: string
  rowKey?: string
  rowName?: string
  columnId?: string
  columnName?: string
}

export interface BatchExpansion {
  batch: { id: string; name: string }
  plan: BatchPlan
  reservations: Reservation[]
  problems: BatchProblem[]
  totals: { pairs: number; jobs: number; images: number; batchSize: number }
  order: { rowKey: string; rowName: string; columnId: string; columnName: string; count: number }[]
}

export interface ExpandOptions {
  idFactory?: () => string
  /** 생성당 장수(1 또는 4). 0/미지정은 4장 기준 추정 */
  batchSize?: number
  batchId?: string
  now?: number
}

/**
 * 행 × 열 × 반복 수를 예약으로 펼친다.
 * - 반복 수: 조합별 예외 > 공통값. 0 = 제외.
 * - 순회: byRow = 캐릭터별로 씬 순회, byColumn = 씬별로 캐릭터 순회. 순서는 수량을 바꾸지 않는다.
 * - 비율/크기: 씬 > 구성 > 없음(전역 설정). 트리거 위치: 씬 > 출연 > 기본.
 * - 오류(problems.level 'error')가 하나라도 있으면 reservations는 비어 있다. 경고(청크 연결 끊김)는 저장된 사본으로 진행한다.
 */
export function expandBatchPlan(
  value: unknown,
  planInput: unknown,
  options: ExpandOptions = {}
): BatchExpansion {
  const library = normalizeLibrary(value)
  const plan = normalizeBatchPlan(planInput, (planInput as { id?: string } | null)?.id ?? 'plan')
  const batchSize =
    options.batchSize == null || options.batchSize === 0
      ? 4
      : presetInteger(options.batchSize, '배치 장수', 1, 4)
  const refused = (message: string, jobs: number): BatchExpansion => ({
    batch: { id: options.batchId ?? 'capacity-error', name: plan.name },
    plan,
    reservations: [],
    problems: [{ level: 'error', message }],
    order: [],
    totals: {
      pairs: plan.rows.length * plan.columns.length,
      jobs,
      images: jobs * batchSize,
      batchSize
    }
  })
  if (
    plan.rows.length > MAX_RESERVED_JOBS ||
    plan.columns.length > MAX_RESERVED_JOBS ||
    plan.rows.length * plan.columns.length > MAX_RESERVED_JOBS
  )
    return refused('한 번에 선택할 수 있는 조합은 1,000쌍입니다. 행 또는 씬 선택을 줄여 주세요.', 0)
  let plannedJobs = 0
  for (const row of plan.rows)
    for (const column of plan.columns)
      plannedJobs += plan.exceptions[batchCellKey(batchRowKey(row), column)] ?? plan.count
  if (plannedJobs > MAX_RESERVED_JOBS)
    return refused(
      '예약 작업은 한 번에 1,000개까지 만들 수 있습니다. 반복 수를 줄여 주세요.',
      plannedJobs
    )
  const idFactory = options.idFactory ?? defaultIdFactory
  const problems: BatchProblem[] = []
  const rows = plan.rows.map((row) => resolveRow(library, row))
  for (const row of rows)
    for (const message of row.problems)
      problems.push({ level: 'error', rowKey: row.key, rowName: row.name, message })
  const columns = plan.columns.map((id): SceneCard | null => {
    const card = (library.sceneCards ?? []).find((item) => item.id === id)
    if (!card) {
      problems.push({
        level: 'error',
        columnId: id,
        columnName: id,
        message: `씬 ${id}이(가) 없습니다.`
      })
      return null
    }
    const missing = card.sceneIds.filter(
      (sceneId) => !library.scenes.some((item) => item.id === sceneId)
    )
    if (missing.length)
      problems.push({
        level: 'warning',
        columnId: id,
        columnName: card.name,
        message: `씬 「${card.name}」의 청크 ${missing.join(', ')} 연결이 끊겨 저장된 사본을 사용합니다.`
      })
    return card
  })
  const sequence: [ResolvedRow, SceneCard | null][] =
    plan.order === 'byColumn'
      ? columns.flatMap((column) =>
          rows.map((row): [ResolvedRow, SceneCard | null] => [row, column])
        )
      : rows.flatMap((row) =>
          columns.map((column): [ResolvedRow, SceneCard | null] => [row, column])
        )
  const pairs: { row: ResolvedRow; column: SceneCard; count: number }[] = []
  for (const [row, column] of sequence) {
    if (!column) continue
    const key = batchCellKey(row.key, column.id)
    const count = Object.prototype.hasOwnProperty.call(plan.exceptions, key)
      ? plan.exceptions[key]
      : plan.count
    if (count > 0) pairs.push({ row, column, count })
  }
  const budget = expansionBudget()
  if (!problems.some((item) => item.level === 'error'))
    for (const { row, column, count } of pairs) {
      const preset = library.presets.find((item) => item.id === row.presetId)!
      budget(
        {
          common: resolvePresetCommon(library, preset),
          preset,
          character: library.characters.find((item) => item.id === row.characterId),
          column,
          extra: row.extra,
          name: plan.name
        },
        count
      )
    }
  const batch = {
    id: options.batchId ?? idFactory(),
    name: plan.name || defaultBatchName(rows.length, columns.filter(Boolean).length, options.now)
  }
  const reservations: Reservation[] = []
  if (!problems.some((item) => item.level === 'error')) {
    for (const { row, column, count } of pairs) {
      const preset = library.presets.find((item) => item.id === row.presetId)!
      const character = library.characters.find((item) => item.id === row.characterId)!
      const extras: { cast?: ExtraText; scene?: ExtraText } = {}
      if (row.extra) extras.cast = row.extra
      if (column.extra) extras.scene = column.extra
      const triggerPosition = column.triggerPosition ?? row.triggerPosition
      const imageOptions = column.imageOptions ?? plan.imageOptions
      const reservation: Reservation = {
        id: presetIdentifier(idFactory(), '예약'),
        presetId: row.presetId,
        characterId: row.characterId,
        sceneIds: [...column.sceneIds],
        sourceSceneId: column.id,
        count,
        snapshot: normalizeSnapshot({
          common: resolvePresetCommon(library, preset),
          preset,
          character,
          chunks: column.chunks,
          ...(Object.keys(extras).length ? { extras } : {})
        }),
        batch: { id: batch.id, name: batch.name, rowName: row.name, columnName: column.name }
      }
      if (triggerPosition !== undefined)
        reservation.triggerPosition =
          triggerPosition === 'end'
            ? 'end'
            : Math.min(
                normalizeTriggerPosition(triggerPosition, 1000) as number,
                column.sceneIds.length + 2
              )
      if (imageOptions) reservation.imageOptions = normalizeImageOptions(imageOptions)
      reservations.push(reservation)
    }
  }
  const jobs = pairs.reduce((sum, item) => sum + item.count, 0)
  return {
    batch,
    plan,
    reservations,
    problems,
    totals: { pairs: pairs.length, jobs, images: jobs * batchSize, batchSize },
    order: pairs.map((item) => ({
      rowKey: item.row.key,
      rowName: item.row.name,
      columnId: item.column.id,
      columnName: item.column.name,
      count: item.count
    }))
  }
}

/** 전부 추가하거나(새 라이브러리 반환) 아무것도 바꾸지 않고 throw. 입력 라이브러리는 건드리지 않는다. */
export function appendBatchReservations(value: unknown, expansion: BatchExpansion): Library {
  if (!expansion || !Array.isArray(expansion.reservations))
    throw new Error('일괄 예약 결과 형식을 확인해 주세요.')
  const errors = (expansion.problems ?? []).filter((item) => item.level === 'error')
  if (errors.length)
    throw new Error(`해결할 조합이 있습니다: ${errors.map((item) => item.message).join(' / ')}`)
  if (!expansion.reservations.length)
    throw new Error('예약할 조합이 없습니다. 반복 수와 제외 항목을 확인해 주세요.')
  const library = normalizeLibrary(value)
  const reserved = library.reservations.reduce((sum, item) => sum + item.count, 0)
  if (reserved + expansion.totals.jobs > MAX_RESERVED_JOBS)
    throw new Error(
      `예약 작업은 한 번에 ${MAX_RESERVED_JOBS.toLocaleString()}개까지 만들 수 있습니다.`
    )
  return normalizeLibrary({
    ...library,
    reservations: [...library.reservations, ...expansion.reservations]
  })
}
