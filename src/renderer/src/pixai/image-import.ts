import { imageInfoFields, type ImageInfoFields } from '@shared/pixai/image-info'
import { composePrompts, resolvePresetCommon, type Preset } from '@shared/pixai/library'
import { resolveImageOptions } from '@shared/pixai/generation-options'
import { emptyDraft } from './composition'
import type { Workspace } from './store'

export type ImageImportSelection = Record<
  'prompt' | 'negativePrompt' | 'model' | 'image' | 'seed' | 'style',
  boolean
>
export const noImageSelection = (): ImageImportSelection => ({
  prompt: false,
  negativePrompt: false,
  model: false,
  image: false,
  seed: false,
  style: false
})
export function importedPreset(fields: ImageInfoFields, name: string, id: string): Preset {
  if (!fields.modelVersionId || !fields.modelId || fields.loras?.some((v) => !v.id))
    throw new Error(
      '모델·LoRA의 원본 ID와 버전 ID가 모두 필요합니다. 라이브러리에서 링크로 프리셋을 만든 뒤 모델 적용 체크를 끄고 사용해 주세요.'
    )
  return {
    id,
    name,
    model: { id: fields.modelId, versionId: fields.modelVersionId, name: '' },
    loras: (fields.loras ?? []).map((v) => ({
      id: v.id!,
      versionId: v.versionId,
      name: '',
      weight: v.weight,
      triggerWords: ''
    }))
  }
}
/** One atomic commit; existing library, snapshots and registered jobs are left intact. */
export function importImageComposition(
  workspace: Workspace,
  value: ImageInfoFields,
  selected: ImageImportSelection,
  name: string,
  idFactory: () => string = () => crypto.randomUUID()
): Workspace {
  const f = imageInfoFields(value)
  if (!Object.values(selected).some(Boolean)) throw new Error('적용할 정보를 선택해 주세요.')
  const draft = workspace.composeDraft ?? emptyDraft(),
    library = workspace.library
  const oldPreset = library.presets.find((v) => v.id === draft.presetId)
  const oldCharacter = library.characters.find((v) => v.id === draft.characterId)
  const chunks = draft.sceneIds.map(
    (id) => draft.card?.chunks.find((v) => v.id === id) ?? library.scenes.find((v) => v.id === id)
  )
  if (chunks.some((v) => !v)) throw new Error('현재 조합의 청크 연결부터 확인해 주세요.')
  const current = composePrompts(
    resolvePresetCommon(library, oldPreset),
    oldCharacter ?? { prompt: '', negativePrompt: '' },
    chunks.filter((v): v is NonNullable<typeof v> => !!v),
    oldPreset ?? { loras: [] },
    draft.triggerPosition,
    draft.card?.extra ? { scene: draft.card.extra } : {}
  )
  if (
    (selected.prompt && f.prompt === undefined) ||
    (selected.negativePrompt && f.negativePrompt === undefined)
  )
    throw new Error('선택한 문구가 파일에 없습니다.')
  const preset = selected.model
    ? importedPreset(f, name, idFactory())
    : oldPreset && {
        id: idFactory(),
        name,
        model: structuredClone(oldPreset.model),
        loras: oldPreset.loras.map((lora) => ({ ...lora, triggerWords: '' }))
      }
  if (!preset)
    throw new Error('PixAI 모델 정보가 없습니다. 조합 예약에서 사용할 프리셋을 먼저 골라 주세요.')
  const common = {
    id: idFactory(),
    name: `${name} · 가져온 문구 그대로`,
    prompt: '',
    negativePrompt: ''
  }
  preset.commonPresetId = common.id
  const character = {
    id: idFactory(),
    name: `${name} · 추가 문구 없음`,
    prompt: '',
    negativePrompt: ''
  }
  const chunk = {
    id: idFactory(),
    name,
    prompt: selected.prompt ? f.prompt! : current.prompt,
    negativePrompt: selected.negativePrompt ? f.negativePrompt! : current.negativePrompt
  }
  const imageOptions = resolveImageOptions(draft.imageOptions, workspace.options)
  if (selected.image) {
    for (const key of ['aspectRatio', 'size', 'mode', 'batchSize'] as const)
      if (f[key] !== undefined) Object.assign(imageOptions, { [key]: f[key] })
  }
  const api = { ...workspace.options.api }
  if (selected.seed && f.seed !== undefined) api.seed = String(f.seed)
  if (selected.style && f.style !== undefined) api.style = f.style
  return {
    ...workspace,
    options: { ...workspace.options, api },
    library: {
      ...library,
      presets: [...library.presets, preset],
      characters: [...library.characters, character],
      scenes: [...library.scenes, chunk],
      commonPresets: [...(library.commonPresets ?? []), common]
    },
    composeDraft: {
      ...emptyDraft(),
      presetId: preset.id,
      characterId: character.id,
      sceneIds: [chunk.id],
      imageOptions
    }
  }
}
