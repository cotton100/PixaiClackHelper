import { API_RATIOS, type ImageOptions } from './library'

export const IMAGE_INFO_MAX_BYTES = 32 * 1024 * 1024
export const IMAGE_INFO_TEXT_LIMIT = 1024 * 1024
export const IMAGE_INFO_KEY = 'pixai-clack-helper'
export interface ImageInfoFields {
  prompt?: string
  negativePrompt?: string
  modelVersionId?: string
  modelId?: string
  loras?: { id?: string; versionId: string; weight: number }[]
  seed?: number
  seedKind?: 'request' | 'file'
  batchSize?: 1 | 4
  width?: number
  height?: number
  aspectRatio?: string
  size?: '1k' | '1.5k'
  mode?: ImageOptions['mode']
  style?: string
}
export interface ImageInfoSource {
  label: string
  fields: ImageInfoFields
}
export interface ImageInfo {
  format: string
  width: number
  height: number
  sources: ImageInfoSource[]
  raw: { label: string; text: string }[]
  warnings: string[]
}
// Metadata is untrusted. Only explicit supported values become applicable settings.
export function imageInfoFields(value: unknown): ImageInfoFields {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const p = value as Record<string, unknown>
  const out: ImageInfoFields = {}
  for (const key of ['prompt', 'negativePrompt'] as const)
    if (typeof p[key] === 'string' && p[key].length <= 100000) out[key] = p[key]
  if (typeof p.modelVersionId === 'string' && /^\d{1,40}$/.test(p.modelVersionId))
    out.modelVersionId = p.modelVersionId
  if (typeof p.modelId === 'string' && /^\d{1,40}$/.test(p.modelId)) out.modelId = p.modelId
  if (
    Array.isArray(p.loras) &&
    p.loras.length <= 5 &&
    p.loras.every(
      (v) =>
        v &&
        typeof v.versionId === 'string' &&
        /^\d{1,40}$/.test(v.versionId) &&
        typeof v.weight === 'number' &&
        Number.isFinite(v.weight) &&
        v.weight >= 0 &&
        v.weight <= 1
    )
  )
    out.loras = p.loras.map((v) => ({
      versionId: v.versionId,
      weight: v.weight,
      ...(typeof v.id === 'string' && /^\d{1,40}$/.test(v.id) ? { id: v.id } : {})
    }))
  if (Number.isInteger(p.seed) && Number(p.seed) >= 0 && Number(p.seed) <= 4294967295) {
    out.seed = Number(p.seed)
    out.seedKind = p.seedKind === 'request' ? 'request' : 'file'
  }
  if (p.batchSize === 1 || p.batchSize === 4) out.batchSize = p.batchSize
  for (const key of ['width', 'height'] as const)
    if (Number.isInteger(p[key]) && Number(p[key]) > 0 && Number(p[key]) <= 40000)
      out[key] = Number(p[key])
  if (typeof p.aspectRatio === 'string' && API_RATIOS.includes(p.aspectRatio))
    out.aspectRatio = p.aspectRatio
  if (p.size === '1k' || p.size === '1.5k') out.size = p.size
  if (typeof p.mode === 'string' && ['lite', 'standard', 'pro', 'ultra'].includes(p.mode))
    out.mode = p.mode as ImageOptions['mode']
  if (typeof p.style === 'string' && /^[a-z][a-z0-9-]{0,80}$/.test(p.style)) out.style = p.style
  return out
}
