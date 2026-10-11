import {
  makeLibrary,
  strictLibrary,
  normalizeImageOptions,
  normalizeTriggerPosition,
  type ImageOptions,
  type SceneCard,
  type TriggerPosition
} from '@shared/pixai/library'

export interface ComposeDraft {
  presetId: string
  characterId: string
  sceneIds: string[]
  count: number
  triggerPosition: TriggerPosition
  imageOptions?: ImageOptions
  card?: SceneCard
}
export const emptyDraft = (): ComposeDraft => ({
  presetId: '',
  characterId: '',
  sceneIds: [],
  count: 1,
  triggerPosition: 1
})

// The draft may be incomplete (for example an empty repeat field). Preserve
// that state without turning it into a valid paid-generation request.
export function readComposeDraft(value: unknown): ComposeDraft {
  const draft = value as ComposeDraft
  if (
    !draft ||
    typeof draft.presetId !== 'string' ||
    typeof draft.characterId !== 'string' ||
    !Array.isArray(draft.sceneIds) ||
    draft.sceneIds.length > 1000 ||
    draft.sceneIds.some((id) => typeof id !== 'string' || !id) ||
    new Set(draft.sceneIds).size !== draft.sceneIds.length ||
    (draft.count !== null && typeof draft.count !== 'number')
  )
    throw new Error('저장된 조합 선택 상태를 확인해 주세요.')
  const result: ComposeDraft = {
    presetId: draft.presetId,
    characterId: draft.characterId,
    sceneIds: [...draft.sceneIds],
    count: draft.count === null ? NaN : draft.count,
    triggerPosition: normalizeTriggerPosition(draft.triggerPosition, draft.sceneIds.length)
  }
  if (draft.imageOptions !== undefined)
    result.imageOptions = normalizeImageOptions(draft.imageOptions)
  if (draft.card !== undefined) {
    // A loaded scene is a snapshot, even if its original folder was removed.
    result.card = strictLibrary({
      ...makeLibrary(),
      sceneFolders: draft.card.folderId ? [{ id: draft.card.folderId, name: '' }] : [],
      sceneCards: [draft.card]
    }).sceneCards![0]
  }
  return result
}
