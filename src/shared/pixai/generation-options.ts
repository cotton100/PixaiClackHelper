import {
  API_RATIOS,
  normalizeImageOptions,
  type ImageOptions,
  type SettingsOptions
} from './library'

/** Fill missing fields once when reserving; later edits must not change a reservation. */
export function resolveImageOptions(
  value: ImageOptions | undefined,
  options: SettingsOptions,
  fallback?: ImageOptions
): ImageOptions {
  const api = options.api ?? {}
  return normalizeImageOptions({
    aspectRatio: API_RATIOS.includes(String(api.aspectRatio)) ? api.aspectRatio : '1:1',
    size: api.size === '1.5k' ? '1.5k' : '1k',
    mode: ['', 'lite', 'standard', 'pro', 'ultra'].includes(String(api.mode ?? ''))
      ? (api.mode ?? '')
      : '',
    batchSize: options.imageCount === 1 ? 1 : 4,
    ...fallback,
    ...value
  })
}
