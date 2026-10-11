import {
  resolvePresetCommon,
  type Library,
  type ExtraText,
  type Preset
} from '@shared/pixai/library'

export function MaterialPreview({
  item,
  library
}: {
  item: Partial<ExtraText> & Partial<Pick<Preset, 'model' | 'loras' | 'commonPresetId'>>
  library?: Library
}): React.JSX.Element {
  const configuration = item.model
    ? [
        item.model.name || item.model.versionId,
        ...(item.loras ?? []).map((lora) => (lora.name || lora.id) + ' × ' + lora.weight)
      ].join(' · ')
    : ''
  const common = library && item.model ? resolvePresetCommon(library, item) : undefined
  const negative = [common?.negativePrompt, item.negativePrompt].filter(Boolean).join(', ')
  const positive = [
    common?.prompt,
    item.prompt,
    ...(item.loras ?? []).map((lora) => lora.triggerWords)
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <span className="px-material-preview">
      {configuration && (
        <small className="px-preview-config" title={configuration}>
          {configuration}
        </small>
      )}
      {positive && (
        <small className="px-preview-tags" title={positive}>
          {positive}
        </small>
      )}
      {negative && (
        <small className="px-preview-negative" title={negative}>
          네거: {negative}
        </small>
      )}
      {!positive && !configuration && !item.negativePrompt && <small>문구 없음</small>}
    </span>
  )
}
