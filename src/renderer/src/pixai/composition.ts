import {
  makeLibrary,
  strictLibrary,
  normalizeImageOptions,
  normalizeTriggerPosition,
  normalizeMaterialOrder,
  type ImageOptions,
  type MaterialOrderItem,
  type SceneCard,
  type TriggerPosition
} from '@shared/pixai/library'

export interface ComposeDraft {
  presetId: string
  characterId: string
  sceneIds: string[]
  count: number
  triggerPosition: TriggerPosition
  materialOrder?: MaterialOrderItem[]
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
  if (draft.materialOrder !== undefined)
    result.materialOrder = normalizeMaterialOrder(draft.materialOrder, draft.sceneIds)
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

/** Trigger numbers remain anchors to their original material, not screen positions. */
export function triggerAfter(item: string, sceneIds: string[]): number {
  if (item === 'common') return 1
  if (item === 'character') return 2
  const index = sceneIds.indexOf(item.slice(6))
  if (!item.startsWith('chunk:') || index < 0) throw new Error('문구 순서를 확인해 주세요.')
  return index + 3
}

export function composeOrder(draft: ComposeDraft): string[] {
  const order: string[] = draft.materialOrder
    ? [...draft.materialOrder]
    : ['common', 'character', ...draft.sceneIds.map((id) => `chunk:${id}`)]
  const position = draft.triggerPosition
  const after =
    position === 'end' || position === 0
      ? undefined
      : position === 1
        ? 'common'
        : position === 2
          ? 'character'
          : `chunk:${draft.sceneIds[position - 3]}`
  const index = position === 'end' ? order.length : after ? order.indexOf(after) + 1 : 0
  order.splice(index, 0, 'triggers')
  return order
}

export function reorderComposeDraft(draft: ComposeDraft, order: string[]): ComposeDraft {
  const materials = order.filter((id) => id !== 'triggers')
  const sceneIds = materials.filter((id) => id.startsWith('chunk:')).map((id) => id.slice(6))
  const materialOrder = normalizeMaterialOrder(materials, sceneIds)
  const triggerIndex = order.indexOf('triggers')
  if (triggerIndex < 0 || order.lastIndexOf('triggers') !== triggerIndex)
    throw new Error('LoRA 트리거 위치를 확인해 주세요.')
  const defaults = ['common', 'character', ...sceneIds.map((id) => `chunk:${id}`)]
  return {
    ...draft,
    sceneIds,
    materialOrder: materialOrder.every((item, index) => item === defaults[index])
      ? undefined
      : materialOrder,
    triggerPosition:
      draft.triggerPosition === 'end' && triggerIndex === order.length - 1
        ? 'end'
        : triggerIndex === 0
          ? 0
          : triggerAfter(order[triggerIndex - 1], sceneIds)
  }
}

export function toggleComposeChunk(draft: ComposeDraft, id: string): ComposeDraft {
  const order = composeOrder(draft)
  const token = `chunk:${id}`
  if (draft.sceneIds.includes(id))
    return reorderComposeDraft(
      draft,
      order.filter((item) => item !== token)
    )
  order.splice(draft.triggerPosition === 'end' ? order.length - 1 : order.length, 0, token)
  return reorderComposeDraft(draft, order)
}
