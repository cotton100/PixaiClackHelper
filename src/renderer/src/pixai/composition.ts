import type { ImageOptions, SceneCard, TriggerPosition } from '@shared/pixai/library'

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
