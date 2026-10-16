import {
  makeLibrary,
  makeSettingsBackup,
  parseSettingsBackup,
  strictLibrary,
  normalizeSnapshot,
  stripFolder,
  resolvePresetCommon,
  batchRowKey,
  batchCellKey,
  type Library,
  type SettingsBackup,
  type SettingsOptions,
  type Reservation
} from './library'
import { jsonBytes } from './expansion-budget'

export const BACKUP_CATEGORIES = [
  'sceneCards',
  'scenes',
  'characters',
  'presets',
  'commonPresets',
  'casts',
  'batchPlans',
  'reservations',
  'combinations'
] as const
export type BackupCategory = (typeof BACKUP_CATEGORIES)[number]
export type BackupSelection = Record<BackupCategory | 'common' | 'options', boolean>
export const BACKUP_FOLDER_CATEGORIES = ['sceneCards', 'scenes'] as const
export type BackupFolderCategory = (typeof BACKUP_FOLDER_CATEGORIES)[number]
/** Omitted category means its whole list; an empty string selects unfiled materials. */
export type BackupFolderSelection = Partial<Record<BackupFolderCategory, string[]>>
export type ImportMode = 'append' | 'replace'
export const BACKUP_LABELS: Record<keyof BackupSelection, string> = {
  sceneCards: '씬',
  scenes: '청크',
  characters: '캐릭터',
  presets: '모델·LoRA 프리셋',
  commonPresets: '공통문 세트',
  casts: '저장 출연',
  batchPlans: '일괄 예약 구성',
  reservations: '조합 예약',
  combinations: '최근 조합·즐겨찾기',
  common: '기본 공통문',
  options: '생성·화면 설정'
}
const FOLDERS = {
  characters: 'characterFolders',
  scenes: 'chunkFolders',
  sceneCards: 'sceneFolders'
} as const
const COLLECTIONS = [...BACKUP_CATEGORIES, ...Object.values(FOLDERS)] as const
type Collection = (typeof COLLECTIONS)[number]
export interface TransferBackup {
  format: 'pixai-clack-helper-selection'
  version: 1 | 2
  selection: BackupSelection
  folderSelection?: BackupFolderSelection
  backup: SettingsBackup
}

export function backupFolderChoices(
  library: Library,
  category: BackupFolderCategory
): Array<{ id: string; name: string; count: number }> {
  return [...(library[FOLDERS[category]] ?? []), { id: '', name: '미분류' }].map((folder) => ({
    ...folder,
    count: (library[category] ?? []).filter((item) => (item.folderId ?? '') === folder.id).length
  }))
}

function validateFolderSelection(
  value: BackupFolderSelection,
  library: Library
): BackupFolderSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('백업 폴더 선택 범위를 확인해 주세요.')
  const result: BackupFolderSelection = {}
  for (const key of Object.keys(value)) {
    if (!BACKUP_FOLDER_CATEGORIES.includes(key as BackupFolderCategory))
      throw new Error('백업 폴더 선택 범위를 확인해 주세요.')
    const category = key as BackupFolderCategory
    const ids = value[category]
    const allowed = new Set(backupFolderChoices(library, category).map((x) => x.id))
    if (
      !Array.isArray(ids) ||
      ids.some((id) => typeof id !== 'string' || !allowed.has(id)) ||
      new Set(ids).size !== ids.length
    )
      throw new Error('백업에 없는 폴더가 선택되어 있습니다. 폴더 선택을 다시 확인해 주세요.')
    result[category] = [...ids]
  }
  return result
}

function isSelectedItem(
  category: BackupCategory,
  item: { folderId?: string },
  selection: BackupSelection,
  folders: BackupFolderSelection
): boolean {
  const scope = folders[category as BackupFolderCategory]
  return selection[category] && (!scope || scope.includes(item.folderId ?? ''))
}

export function backupSelectionLabels(
  library: Library,
  selection: BackupSelection,
  folders: BackupFolderSelection = {}
): string[] {
  return (Object.keys(selection) as Array<keyof BackupSelection>)
    .filter((key) => selection[key])
    .map((key) => {
      const scope = folders[key as BackupFolderCategory]
      if (!scope) return BACKUP_LABELS[key]
      const names = backupFolderChoices(library, key as BackupFolderCategory)
        .filter((folder) => scope.includes(folder.id))
        .map((folder) => `${folder.name} (${folder.count}개)`)
      return `${BACKUP_LABELS[key]}: ${names.join(', ') || '선택한 폴더 없음'}`
    })
}

export function backupSelection(enabled = true): BackupSelection {
  return Object.fromEntries(
    [...BACKUP_CATEGORIES, 'common', 'options'].map((k) => [k, enabled])
  ) as BackupSelection
}

/** Dependencies are copied, not made replacement targets. Folder order survives. */
export function selectBackupLibrary(
  value: Library,
  selection: BackupSelection,
  folderSelection: BackupFolderSelection = {}
): {
  library: Library
  dependencies: Partial<Record<BackupCategory, number>>
} {
  const source = strictLibrary(value)
  const folders = validateFolderSelection(folderSelection, source)
  const ids = Object.fromEntries(COLLECTIONS.map((k) => [k, new Set<string>()])) as Record<
    Collection,
    Set<string>
  >
  const index = Object.fromEntries(
    COLLECTIONS.map((k) => [k, new Map((source[k] ?? []).map((x) => [x.id, x] as const))])
  ) as { [K in Collection]: Map<string, NonNullable<Library[K]>[number]> }
  const pending: Array<[Collection, string]> = []
  const add = (key: Collection, id?: string): void => {
    if (!id || ids[key].has(id) || !index[key].has(id)) return
    ids[key].add(id)
    pending.push([key, id])
  }
  for (const key of BACKUP_CATEGORIES) {
    if (!selection[key]) continue
    for (const item of source[key] ?? [])
      if (isSelectedItem(key, item as { folderId?: string }, selection, folders)) add(key, item.id)
    const folderKey = FOLDERS[key as keyof typeof FOLDERS]
    const scope = folders[key as BackupFolderCategory]
    if (folderKey)
      for (const folder of source[folderKey] ?? [])
        if (!scope || scope.includes(folder.id)) add(folderKey, folder.id)
  }
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const [key, id] = pending[cursor]
    if (key === 'presets') add('commonPresets', index.presets.get(id)!.commonPresetId)
    if (key === 'characters') {
      const item = index.characters.get(id)!
      add('presets', item.defaultPresetId)
      add('characterFolders', item.folderId)
    }
    if (key === 'scenes') add('chunkFolders', index.scenes.get(id)!.folderId)
    if (key === 'sceneCards') {
      const item = index.sceneCards.get(id)!
      add('sceneFolders', item.folderId)
      item.sceneIds.forEach((x) => add('scenes', x))
    }
    if (key === 'casts') {
      const item = index.casts.get(id)!
      add('characters', item.characterId)
      add('presets', item.presetId)
    }
    if (key === 'batchPlans') {
      const item = index.batchPlans.get(id)!
      item.rows.forEach((row) => {
        add(row.kind === 'cast' ? 'casts' : 'characters', row.id)
        add('presets', row.presetId)
      })
      item.columns.forEach((x) => add('sceneCards', x))
    }
    if (key === 'reservations' || key === 'combinations') {
      const item = index[key].get(id)!
      add('characters', item.characterId)
      add('presets', item.presetId)
      item.sceneIds.forEach((x) => add('scenes', x))
      if ('sourceSceneId' in item) add('sceneCards', item.sourceSceneId)
    }
  }
  const library = makeLibrary()
  for (const key of COLLECTIONS)
    Object.assign(library, { [key]: (source[key] ?? []).filter((x) => ids[key].has(x.id)) })
  // A preset without a linked set needs the source default, even when it is not
  // a replacement target. No key or path setting travels with these materials.
  if (selection.common || library.presets.some((x) => !x.commonPresetId) || selection.reservations)
    library.common = source.common
  const dependencies = Object.fromEntries(
    BACKUP_CATEGORIES.map((key) => [
      key,
      (source[key] ?? []).filter(
        (item) =>
          ids[key].has(item.id) &&
          !isSelectedItem(key, item as { folderId?: string }, selection, folders)
      ).length
    ]).filter(([, count]) => count)
  )
  return { library: strictLibrary(library), dependencies }
}

export function makeTransferBackup(
  library: Library,
  options: SettingsOptions,
  selection: BackupSelection,
  meta: { appVersion: string; exportedAt: string },
  folderSelection: BackupFolderSelection = {}
): TransferBackup {
  if (!Object.values(selection).some(Boolean))
    throw new Error('백업할 항목을 하나 이상 선택해 주세요.')
  const folders = validateFolderSelection(folderSelection, library)
  for (const category of BACKUP_FOLDER_CATEGORIES) {
    if (!selection[category]) delete folders[category]
    else if (folders[category]?.length === 0)
      throw new Error(`${BACKUP_LABELS[category]}에서 폴더를 하나 이상 선택해 주세요.`)
  }
  const selected = selectBackupLibrary(library, selection, folders).library
  const result: TransferBackup = {
    format: 'pixai-clack-helper-selection',
    version: Object.keys(folders).length ? 2 : 1,
    selection: { ...selection },
    ...(Object.keys(folders).length ? { folderSelection: folders } : {}),
    backup: makeSettingsBackup(
      selected,
      selection.options ? options : { maxCredits: null, filePrefix: '', repeat: 1 },
      meta
    )
  }
  jsonBytes(result, 5 * 1024 * 1024)
  return result
}

export function parseTransferBackup(text: string): TransferBackup {
  if (text.length > 5 * 1024 * 1024 || new TextEncoder().encode(text).byteLength > 5 * 1024 * 1024)
    throw new Error('설정 파일은 5MiB 이하만 불러올 수 있습니다.')
  let parsed: unknown
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''), (key, value) => {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('객체 속성')
      return value
    })
  } catch {
    throw new Error('설정 파일의 JSON 형식 또는 허용하지 않는 객체 속성을 확인해 주세요.')
  }
  const value = parsed as Partial<TransferBackup> | null
  if (value?.format !== 'pixai-clack-helper-selection')
    return {
      format: 'pixai-clack-helper-selection',
      version: 1,
      selection: backupSelection(),
      backup: parseSettingsBackup(text)
    }
  if (
    (value.version !== 1 && value.version !== 2) ||
    Object.keys(value).some(
      (k) =>
        ![
          'format',
          'version',
          'selection',
          'backup',
          ...(value.version === 2 ? ['folderSelection'] : [])
        ].includes(k)
    ) ||
    (value.version === 2 && !value.folderSelection)
  )
    throw new Error('지원하지 않는 선택 백업 형식입니다.')
  const selection = backupSelection(false)
  if (
    !value.selection ||
    typeof value.selection !== 'object' ||
    Array.isArray(value.selection) ||
    Object.keys(value.selection).length !== Object.keys(selection).length ||
    Object.keys(value.selection).some((k) => !Object.hasOwn(selection, k)) ||
    Object.values(value.selection).some((v) => typeof v !== 'boolean')
  )
    throw new Error('백업 선택 범위를 확인해 주세요.')
  const backup = parseSettingsBackup(JSON.stringify(value.backup))
  const folders =
    value.version === 2
      ? validateFolderSelection(value.folderSelection!, backup.library)
      : undefined
  if (
    folders &&
    (Object.keys(folders).length === 0 ||
      BACKUP_FOLDER_CATEGORIES.some(
        (key) => folders[key] && (!value.selection![key] || folders[key]!.length === 0)
      ))
  )
    throw new Error('백업 폴더 선택 범위를 확인해 주세요.')
  return {
    format: value.format,
    version: value.version,
    selection: { ...value.selection },
    ...(folders ? { folderSelection: folders } : {}),
    backup
  }
}

/** Keep retained, not-yet-registered reservations unchanged when materials change. */
function freezeReservation(library: Library, reservation: Reservation): Reservation {
  if (reservation.snapshot) return reservation
  const preset = library.presets.find((x) => x.id === reservation.presetId)
  const character = library.characters.find((x) => x.id === reservation.characterId)
  const chunks = reservation.sceneIds.map((id) => library.scenes.find((x) => x.id === id))
  if (!preset || !character || chunks.some((x) => !x))
    throw new Error('기존 예약에 삭제된 재료가 있습니다. 해당 예약을 정리한 뒤 가져와 주세요.')
  return {
    ...reservation,
    snapshot: normalizeSnapshot({
      common: resolvePresetCommon(library, preset),
      preset,
      character,
      chunks: chunks.map((chunk) => stripFolder(chunk!))
    })
  }
}

export function prepareBackupImport(
  current: Library,
  transfer: TransferBackup,
  selection: BackupSelection,
  mode: ImportMode,
  idFactory: () => string = () => crypto.randomUUID(),
  folderSelection: BackupFolderSelection = transfer.folderSelection ?? {}
): {
  library: Library
  options?: SettingsOptions
  dependencies: Partial<Record<BackupCategory, number>>
  warnings: string[]
} {
  if (!Object.values(selection).some(Boolean))
    throw new Error('가져올 항목을 하나 이상 선택해 주세요.')
  const folders = validateFolderSelection(
    { ...transfer.folderSelection, ...folderSelection },
    transfer.backup.library
  )
  for (const key of BACKUP_FOLDER_CATEGORIES) {
    if (!selection[key]) continue
    const limit = transfer.folderSelection?.[key]
    if (
      folders[key]?.length === 0 ||
      (limit && folders[key]?.some((id) => !limit.includes(id))) ||
      (transfer.version === 2 && !transfer.selection[key])
    )
      throw new Error(`${BACKUP_LABELS[key]}의 백업에 포함된 폴더를 하나 이상 선택해 주세요.`)
  }
  const selected = selectBackupLibrary(transfer.backup.library, selection, folders)
  const incoming = structuredClone(selected.library)
  const result = structuredClone(strictLibrary(current))
  const warnings: string[] = []
  // Folder collections follow their material category, including empty folders.
  const replace = (key: Collection, item: { id: string; folderId?: string }): boolean => {
    if (mode !== 'replace') return false
    const category = Object.entries(FOLDERS).find(([, folder]) => folder === key)?.[0] as
      BackupCategory | undefined
    if (category) {
      const scope = folders[category as BackupFolderCategory]
      return selection[category] && (!scope || scope.includes(item.id))
    }
    return isSelectedItem(key as BackupCategory, item, selection, folders)
  }
  if (
    mode === 'replace' &&
    !selection.reservations &&
    ['common', 'presets', 'characters', 'scenes', 'commonPresets'].some(
      (k) => selection[k as keyof BackupSelection]
    )
  )
    result.reservations = result.reservations.map((x) => freezeReservation(result, x))
  const retained = Object.fromEntries(
    COLLECTIONS.map((key) => [key, (result[key] ?? []).filter((item) => !replace(key, item))])
  ) as { [K in Collection]: NonNullable<Library[K]> }
  const maps = Object.fromEntries(
    [...COLLECTIONS, 'batch'].map((k) => [k, new Map<string, string>()])
  ) as Record<Collection | 'batch', Map<string, string>>
  const used = new Set([
    ...COLLECTIONS.flatMap((k) => [...(result[k] ?? []), ...(incoming[k] ?? [])].map((x) => x.id)),
    ...result.reservations.flatMap((x) => (x.batch ? [x.batch.id] : []))
  ])
  const fresh = (): string => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const id = idFactory()
      if (id && !used.has(id)) {
        used.add(id)
        return id
      }
    }
    throw new Error('가져올 자료의 새 ID를 만들지 못했습니다.')
  }
  const remap = (key: Collection | 'batch', id: string): string => {
    if (!maps[key].has(id)) {
      const item =
        key === 'batch' ? undefined : (selected.library[key] ?? []).find((x) => x.id === id)
      const keep =
        key !== 'batch' && item && replace(key, item) && !retained[key].some((x) => x.id === id)
      maps[key].set(id, keep ? id : fresh())
    }
    return maps[key].get(id)!
  }
  for (const key of COLLECTIONS)
    for (const item of incoming[key] ?? []) item.id = remap(key, item.id)
  // Append never changes the user's default common text. Preserve imported
  // unlinked presets by assigning their old default to a new named set.
  const replacingDefault = mode === 'replace' && selection.common
  const defaultDiffers = JSON.stringify(incoming.common) !== JSON.stringify(result.common)
  let importedDefault: Library['commonPresets'] = []
  if (
    !replacingDefault &&
    ((selection.common && mode === 'append') ||
      (defaultDiffers && incoming.presets.some((x) => !x.commonPresetId)))
  ) {
    const id = fresh()
    importedDefault = [{ id, name: '가져온 기본 공통문', ...incoming.common }]
    for (const preset of incoming.presets) if (!preset.commonPresetId) preset.commonPresetId = id
    // Mark this local ID as already remapped.
    maps.commonPresets.set(id, id)
    warnings.push('가져온 기본 공통문은 새 공통문 세트로 보관하고, 필요한 프리셋에 연결합니다.')
  }
  if (replacingDefault) result.common = incoming.common
  const presetRef = (p: Library['presets'][number]): void => {
    if (p.commonPresetId) p.commonPresetId = remap('commonPresets', p.commonPresetId)
  }
  for (const preset of incoming.presets) presetRef(preset)
  for (const character of incoming.characters) {
    if (character.defaultPresetId)
      character.defaultPresetId = remap('presets', character.defaultPresetId)
    if (character.folderId) character.folderId = remap('characterFolders', character.folderId)
  }
  for (const chunk of incoming.scenes)
    if (chunk.folderId) chunk.folderId = remap('chunkFolders', chunk.folderId)
  for (const card of incoming.sceneCards ?? []) {
    if (card.folderId) card.folderId = remap('sceneFolders', card.folderId)
    card.sceneIds = card.sceneIds.map((id) => remap('scenes', id))
    for (const chunk of card.chunks) chunk.id = remap('scenes', chunk.id)
  }
  for (const cast of incoming.casts ?? []) {
    cast.characterId = remap('characters', cast.characterId)
    cast.presetId = remap('presets', cast.presetId)
  }
  for (const plan of incoming.batchPlans ?? []) {
    const rows = new Map(
      plan.rows.map((row) => {
        const before = batchRowKey(row)
        row.id = remap(row.kind === 'cast' ? 'casts' : 'characters', row.id)
        if (row.presetId) row.presetId = remap('presets', row.presetId)
        return [before, batchRowKey(row)]
      })
    )
    const exceptions: Record<string, number> = {}
    for (const [cell, count] of Object.entries(plan.exceptions)) {
      const separator = cell.indexOf('|')
      const row = rows.get(cell.slice(0, separator))
      if (row) exceptions[batchCellKey(row, remap('sceneCards', cell.slice(separator + 1)))] = count
    }
    plan.exceptions = exceptions
    plan.columns = plan.columns.map((id) => remap('sceneCards', id))
  }
  for (const item of [...incoming.reservations, ...(incoming.combinations ?? [])]) {
    item.presetId = remap('presets', item.presetId)
    item.characterId = remap('characters', item.characterId)
    item.sceneIds = item.sceneIds.map((id) => remap('scenes', id))
    if ('snapshot' in item && item.snapshot) {
      item.snapshot.preset.id = item.presetId
      // Frozen common is authoritative; a deleted live set must not bind elsewhere.
      delete item.snapshot.preset.commonPresetId
      item.snapshot.character.id = item.characterId
      if (item.snapshot.character.defaultPresetId)
        item.snapshot.character.defaultPresetId = remap(
          'presets',
          item.snapshot.character.defaultPresetId
        )
      for (const chunk of item.snapshot.chunks) chunk.id = remap('scenes', chunk.id)
    }
    if ('sourceSceneId' in item && item.sourceSceneId)
      item.sourceSceneId = remap('sceneCards', item.sourceSceneId)
    if ('batch' in item && item.batch) item.batch.id = remap('batch', item.batch.id)
  }
  for (const key of COLLECTIONS)
    Object.assign(result, {
      [key]: [...retained[key], ...(incoming[key] ?? [])]
    })
  result.commonPresets = [...(result.commonPresets ?? []), ...importedDefault]
  // A removed linked set cannot silently switch existing presets to the default.
  if (
    result.presets.some(
      (p) => p.commonPresetId && !result.commonPresets?.some((x) => x.id === p.commonPresetId)
    )
  )
    throw new Error(
      '남겨 둔 프리셋이 사용하는 공통문 세트가 교체로 없어집니다. 추가 방식으로 가져오거나 프리셋도 함께 선택해 주세요.'
    )
  const broken =
    result.characters.filter(
      (x) => x.defaultPresetId && !result.presets.some((p) => p.id === x.defaultPresetId)
    ).length +
    (result.casts ?? []).filter(
      (x) =>
        !result.characters.some((c) => c.id === x.characterId) ||
        !result.presets.some((p) => p.id === x.presetId)
    ).length
  if (broken)
    warnings.push(
      `교체 후 캐릭터·출연 ${broken}개의 연결 재료가 없습니다. 사용 전에 프리셋·캐릭터를 다시 지정해 주세요.`
    )
  if (mode === 'replace' && selection.scenes && (result.sceneCards?.length ?? 0))
    warnings.push(
      '기존 씬은 저장된 청크 사본을 유지합니다. 바뀐 청크를 씬에 반영하려면 씬에서 갱신해 주세요.'
    )
  // normalizeLibrary trims recent history; do not silently discard imports.
  const history = result.combinations ?? []
  if (
    history.filter((x) => !x.favorite).length > 50 ||
    history.filter((x) => x.favorite).length > 1000
  )
    throw new Error(
      '최근 조합은 50개, 즐겨찾기는 1,000개까지입니다. 기존 기록을 정리하거나 이 항목을 빼 주세요.'
    )
  jsonBytes(result)
  return {
    library: strictLibrary(result),
    ...(selection.options ? { options: transfer.backup.options } : {}),
    dependencies: selected.dependencies,
    warnings
  }
}
