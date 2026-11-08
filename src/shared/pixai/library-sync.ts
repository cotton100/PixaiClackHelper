import { strictLibrary, type Library } from './library'
import { freezeReservation } from './backup-transfer'
import { jsonBytes, MAX_WORKSPACE_BYTES } from './expansion-budget'

export const SYNC_COLLECTIONS = [
  'commonPresets',
  'presets',
  'characters',
  'characterFolders',
  'chunkFolders',
  'scenes',
  'sceneFolders',
  'sceneCards',
  'casts',
  'batchPlans'
] as const
export type SyncCollection = (typeof SYNC_COLLECTIONS)[number]
export type SyncLibrary = { version: 1; common: Library['common'] } & {
  [K in SyncCollection]: NonNullable<Library[K]>
}
export interface SyncConflict {
  key: string
  label: string
  app: unknown
  script: unknown
}
export type SyncChoices = Record<string, 'app' | 'script'>
export const SYNC_MAX_BYTES = MAX_WORKSPACE_BYTES

const LABELS: Record<SyncCollection, string> = {
  commonPresets: '공통문 세트',
  presets: '모델·LoRA 프리셋',
  characters: '캐릭터',
  characterFolders: '캐릭터 폴더',
  chunkFolders: '청크 폴더',
  scenes: '청크',
  sceneFolders: '씬 폴더',
  sceneCards: '씬',
  casts: '출연',
  batchPlans: '저장 구성'
}

/** Stable property order, preserving the meaningful order of arrays. */
export function canonicalSync(value: unknown): string {
  const seen = new Set<object>()
  const canonical = (item: unknown, depth: number): unknown => {
    if (depth > 64) throw new Error('동기화 자료가 지나치게 중첩되어 있습니다.')
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item
    if (typeof item === 'number' && Number.isFinite(item)) return item
    if (!item || typeof item !== 'object' || seen.has(item))
      throw new Error('동기화 자료의 JSON 형식을 확인해 주세요.')
    seen.add(item)
    let result: unknown
    if (Array.isArray(item)) result = item.map((child) => canonical(child, depth + 1))
    else {
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
        throw new Error('동기화 자료의 객체 형식을 확인해 주세요.')
      result = Object.fromEntries(
        Object.keys(item)
          .sort()
          .map((key) => {
            if (['__proto__', 'constructor', 'prototype'].includes(key))
              throw new Error('허용되지 않은 동기화 필드입니다.')
            return [key, canonical((item as Record<string, unknown>)[key], depth + 1)]
          })
      )
    }
    seen.delete(item)
    return result
  }
  const normalized = canonical(value, 0)
  jsonBytes(normalized, SYNC_MAX_BYTES)
  return JSON.stringify(normalized)
}

export function parseSyncLibrary(value: unknown): SyncLibrary {
  canonicalSync(value)
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('동기화 라이브러리 형식을 확인해 주세요.')
  const source = value as Record<string, unknown>
  const keys: readonly string[] = ['version', 'common', ...SYNC_COLLECTIONS]
  if (
    Object.keys(source).some((key) => !keys.includes(key)) ||
    keys.some((key) => !Object.hasOwn(source, key)) ||
    SYNC_COLLECTIONS.some((key) => !Array.isArray(source[key]))
  )
    throw new Error('동기화에는 라이브러리 재료만 포함할 수 있습니다.')
  const library = strictLibrary({ ...source, reservations: [] })
  const projected = { version: 1, common: library.common } as SyncLibrary
  for (const key of SYNC_COLLECTIONS)
    (projected as unknown as Record<string, unknown>)[key] = library[key] ?? []
  return structuredClone(projected)
}

export function projectSyncLibrary(library: Library): SyncLibrary {
  const projected: Record<string, unknown> = { version: 1, common: library.common }
  for (const key of SYNC_COLLECTIONS) projected[key] = library[key] ?? []
  return parseSyncLibrary(projected)
}

type Item = { id: string; name?: string }
const equal = (a: unknown, b: unknown): boolean =>
  a === undefined || b === undefined ? a === b : canonicalSync(a) === canonicalSync(b)

/** Missing live chunks in a scene are valid: scenes contain frozen chunk copies. */
function danglingReferences(library: SyncLibrary): Set<string> {
  const missing = new Set<string>()
  const has = (key: SyncCollection, id: string): boolean =>
    library[key].some((item) => item.id === id)
  const check = (owner: string, key: SyncCollection, id: string | undefined): void => {
    if (id && !has(key, id)) missing.add(`${owner}->${key}:${id}`)
  }
  for (const c of library.characters) check(`character:${c.id}`, 'presets', c.defaultPresetId)
  for (const c of library.casts) {
    check(`cast:${c.id}`, 'presets', c.presetId)
    check(`cast:${c.id}`, 'characters', c.characterId)
  }
  for (const p of library.batchPlans) {
    for (const r of p.rows) {
      check(`plan:${p.id}`, r.kind === 'cast' ? 'casts' : 'characters', r.id)
      check(`plan:${p.id}`, 'presets', r.presetId)
    }
    for (const id of p.columns) check(`plan:${p.id}`, 'sceneCards', id)
    for (const id of p.extraChunkIds ?? []) check(`plan:${p.id}`, 'scenes', id)
  }
  return missing
}

/** Three-way merge of saved entities. A missing initial baseline never implies deletion. */
export function mergeSyncLibraries(
  rawBase: SyncLibrary | null,
  rawApp: SyncLibrary,
  rawScript: SyncLibrary,
  choices: SyncChoices = {}
): { library: SyncLibrary; conflicts: SyncConflict[] } {
  const base = rawBase === null ? null : parseSyncLibrary(rawBase)
  const app = parseSyncLibrary(rawApp),
    script = parseSyncLibrary(rawScript)
  if (
    !choices ||
    typeof choices !== 'object' ||
    Array.isArray(choices) ||
    Object.values(choices).some((value) => value !== 'app' && value !== 'script')
  )
    throw new Error('충돌 항목마다 앱 또는 스크립트를 선택해 주세요.')
  const conflicts: SyncConflict[] = [],
    knownChoices = new Set<string>()
  function pick(
    key: string,
    label: string,
    before: unknown,
    left: unknown,
    right: unknown
  ): unknown {
    if (equal(left, right)) return left
    if (base !== null && equal(left, before)) return right
    if (base !== null && equal(right, before)) return left
    if (base === null && left === undefined) return right
    if (base === null && right === undefined) return left
    knownChoices.add(key)
    if (Object.hasOwn(choices, key)) return choices[key] === 'app' ? left : right
    conflicts.push({ key, label, app: left ?? null, script: right ?? null })
    return left
  }
  const merged: Record<string, unknown> = {
    version: 1,
    common: pick('common', '기본 공통문', base?.common, app.common, script.common)
  }
  for (const key of SYNC_COLLECTIONS) {
    const a = new Map<string, Item>(app[key].map((item) => [item.id, item] as const))
    const b = new Map<string, Item>(script[key].map((item) => [item.id, item] as const))
    const old = new Map<string, Item>((base?.[key] ?? []).map((item) => [item.id, item] as const))
    const items = new Map<string, Item>()
    for (const id of new Set([...a.keys(), ...b.keys(), ...old.keys()])) {
      const selected = pick(
        `${key}:${id}`,
        `${LABELS[key]} · ${a.get(id)?.name ?? b.get(id)?.name ?? id}`,
        old.get(id),
        a.get(id),
        b.get(id)
      ) as Item | undefined
      if (selected !== undefined) items.set(id, selected)
    }
    // Independent additions/removals do not count as reordering shared entries.
    const commonIds = new Set([...a.keys()].filter((id) => b.has(id) && items.has(id)))
    const appOrder = [...a.keys()].filter((id) => commonIds.has(id))
    const scriptOrder = [...b.keys()].filter((id) => commonIds.has(id))
    const baseOrder = [...old.keys()].filter((id) => commonIds.has(id))
    const comparable = new Set(baseOrder)
    const appExisting = appOrder.filter((id) => comparable.has(id))
    const scriptExisting = scriptOrder.filter((id) => comparable.has(id))
    let preferred: 'app' | 'script' = 'app'
    if (!equal(appOrder, scriptOrder)) {
      if (base && equal(appExisting, baseOrder) && !equal(scriptExisting, baseOrder))
        preferred = 'script'
      else if (base && !equal(appExisting, baseOrder) && equal(scriptExisting, baseOrder))
        preferred = 'app'
      else {
        const orderKey = `order:${key}`
        knownChoices.add(orderKey)
        if (Object.hasOwn(choices, orderKey)) preferred = choices[orderKey]
        else
          conflicts.push({
            key: orderKey,
            label: `${LABELS[key]} 순서`,
            app: appOrder,
            script: scriptOrder
          })
      }
    }
    // Insert other-side additions next to their closest preceding saved neighbour.
    const primary = preferred === 'app' ? a : b,
      secondary = preferred === 'app' ? b : a
    const order = [...primary.keys()].filter((id) => items.has(id))
    let previous: string | undefined
    for (const id of secondary.keys()) {
      if (!items.has(id)) continue
      if (!order.includes(id)) {
        const index = previous === undefined ? 0 : order.indexOf(previous) + 1
        order.splice(index, 0, id)
      }
      previous = id
    }
    merged[key] = order.map((id) => items.get(id))
  }
  if (Object.keys(choices).some((key) => !knownChoices.has(key)))
    throw new Error('충돌 내용이 바뀌었습니다. 최신 미리보기를 다시 확인해 주세요.')
  // Unresolved previews must never be applied; placeholder stays schema-valid.
  if (conflicts.length) return { library: app, conflicts }
  const library = parseSyncLibrary(merged)
  const previouslyMissing = new Set([...danglingReferences(app), ...danglingReferences(script)])
  if ([...danglingReferences(library)].some((ref) => !previouslyMissing.has(ref)))
    throw new Error(
      '삭제된 재료와 새 연결이 충돌합니다. 원본의 연결을 정리한 뒤 다시 동기화해 주세요.'
    )
  return { library, conflicts: [] }
}

export function applySyncLibrary(current: Library, incoming: SyncLibrary): Library {
  const validated = parseSyncLibrary(incoming)
  const original = strictLibrary(current)
  if (equal(projectSyncLibrary(original), validated)) return structuredClone(original)
  return strictLibrary({
    ...original,
    ...validated,
    reservations: original.reservations.map((item) => freezeReservation(original, item))
  })
}
