import sharp from 'sharp'
import { parsePngTextChunks, extractStealthComment } from '../images/metadata'
import {
  IMAGE_INFO_KEY,
  IMAGE_INFO_MAX_BYTES,
  IMAGE_INFO_TEXT_LIMIT,
  imageInfoFields,
  type ImageInfo,
  type ImageInfoFields
} from '../../shared/pixai/image-info'
import type { ExecutionJob } from '../../shared/pixai/execution'

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
function pngChunks(data: Buffer): { start: number; end: number; type: string }[] {
  if (!data.subarray(0, 8).equals(SIG)) throw new Error('PNG 형식이 아닙니다.')
  const chunks: { start: number; end: number; type: string }[] = []
  for (let start = 8; start + 12 <= data.length;) {
    const size = data.readUInt32BE(start)
    const end = start + size + 12
    if (end > data.length || chunks.length > 10000) throw new Error('손상된 PNG입니다.')
    const type = data.toString('ascii', start + 4, start + 8)
    if (crc32(data.subarray(start + 4, end - 4)) !== data.readUInt32BE(end - 4))
      throw new Error('PNG 무결성 확인에 실패했습니다.')
    chunks.push({ start, end, type })
    if (type === 'IEND') return chunks
    start = end
  }
  throw new Error('PNG 끝 정보를 찾지 못했습니다.')
}

/** Insert one deterministic iTXt record. IDAT, EXIF and existing text remain byte-identical. */
export function embedGenerationInfo(data: Buffer, job: ExecutionJob, mediaId: string): Buffer {
  const chunks = pngChunks(data)
  const p = job.payload
  // Whitelist only public generation settings. Never serialize a job, key or local path.
  const fields = imageInfoFields({
    prompt: p.prompt,
    negativePrompt: p.negativePrompt,
    modelVersionId: p.modelVersionId,
    modelId: job.metadataReferences?.modelId,
    loras: p.loras.map((v, index) => ({
      id: job.metadataReferences?.loraModelIds[index],
      versionId: v.modelId,
      weight: v.weight
    })),
    seed: p.seed,
    seedKind: 'request',
    batchSize: p.batchSize,
    aspectRatio: p.aspectRatio,
    size: p.size,
    mode: p.mode,
    style: p.style?.key
  })
  const json = JSON.stringify({
    format: IMAGE_INFO_KEY,
    version: 1,
    source: 'local-request',
    fields,
    taskId: job.taskId,
    mediaId
  })
  if (Buffer.byteLength(json) > IMAGE_INFO_TEXT_LIMIT) throw new Error('생성 정보 용량 초과')
  const body = Buffer.concat([Buffer.from(IMAGE_INFO_KEY + '\0\0\0\0\0'), Buffer.from(json)])
  const chunk = Buffer.alloc(body.length + 12)
  chunk.writeUInt32BE(body.length, 0)
  chunk.write('iTXt', 4, 'ascii')
  body.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4)
  const end = chunks.find((v) => v.type === 'IEND')!.start
  return Buffer.concat([data.subarray(0, end), chunk, data.subarray(end)])
}

/** Selected textual TIFF/EXIF tags only; offsets/counts checked before every read. */
function exifText(input: Buffer): Record<string, string> {
  const b = input.subarray(input.subarray(0, 6).equals(Buffer.from('Exif\0\0')) ? 6 : 0)
  const out: Record<string, string> = {}
  if (b.length < 8) return out
  const le = b.toString('ascii', 0, 2) === 'II'
  if (!le && b.toString('ascii', 0, 2) !== 'MM') return out
  const u16 = (p: number): number => (le ? b.readUInt16LE(p) : b.readUInt16BE(p))
  const u32 = (p: number): number => (le ? b.readUInt32LE(p) : b.readUInt32BE(p))
  if (u16(2) !== 42) return out
  const seen = new Set<number>()
  function visit(offset: number): void {
    if (seen.has(offset) || seen.size >= 8 || offset < 8 || offset + 2 > b.length) return
    seen.add(offset)
    const count = u16(offset)
    if (count > 512 || offset + 2 + count * 12 + 4 > b.length) return
    for (let n = 0; n < count; n++) {
      const entry = offset + 2 + n * 12,
        tag = u16(entry),
        type = u16(entry + 2),
        size = u32(entry + 4)
      if (tag === 0x8769 && type === 4 && size === 1) {
        visit(u32(entry + 8))
        continue
      }
      if (![0x10e, 0x131, 0x9286, 0x9c9c].includes(tag) || ![1, 2, 7].includes(type)) continue
      const p = size <= 4 ? entry + 8 : u32(entry + 8)
      if (size > IMAGE_INFO_TEXT_LIMIT || p + size > b.length) continue
      let value = b.subarray(p, p + size)
      let text: string
      if (tag === 0x9c9c) text = value.toString('utf16le')
      else if (value.subarray(0, 8).equals(Buffer.from('UNICODE\0'))) {
        value = Buffer.from(value.subarray(8))
        if (value.length % 2) continue
        if (!le) value.swap16()
        text = value.toString('utf16le')
      } else
        text = value
          .subarray(value.subarray(0, 8).equals(Buffer.from('ASCII\0\0\0')) ? 8 : 0)
          .toString('utf8')
      out[`EXIF ${tag.toString(16)}`] = text.replace(/\0+$/g, '')
    }
  }
  visit(u32(4))
  return out
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
function fieldsFromText(text: string): ImageInfoFields {
  try {
    const p = object(JSON.parse(text))
    const c = typeof p.Comment === 'string' ? object(JSON.parse(p.Comment)) : object(p.Comment)
    const q = Object.keys(c).length ? c : p
    return imageInfoFields({
      ...q,
      prompt: q.prompt ?? p.Description,
      negativePrompt: q.negativePrompt ?? q.negative_prompt ?? q.uc,
      // Preserve generator-specific settings in raw, never map NAI model names to PixAI IDs.
      modelVersionId: q.modelVersionId
    })
  } catch {
    const match = /(?:^|\n)Steps:\s*\d+[^\n]*$/m.exec(text)
    if (!match) return {}
    const prefix = text.slice(0, match.index).trim()
    const split = prefix.indexOf('\nNegative prompt:')
    const seed = /(?:^|,\s*)Seed:\s*(\d+)/.exec(match[0].trim())
    const size = /(?:^|,\s*)Size:\s*(\d+)x(\d+)/.exec(match[0].trim())
    return imageInfoFields({
      prompt: split < 0 ? prefix : prefix.slice(0, split),
      ...(split < 0 ? {} : { negativePrompt: prefix.slice(split + 17).trim() }),
      seed: seed ? Number(seed[1]) : undefined,
      width: size ? Number(size[1]) : undefined,
      height: size ? Number(size[2]) : undefined
    })
  }
}
export async function readImageInfo(input: Uint8Array): Promise<ImageInfo> {
  if (!(input instanceof Uint8Array) || !input.length || input.length > IMAGE_INFO_MAX_BYTES)
    throw new Error('PNG·JPEG·WebP 이미지 한 장(32MB 이하)을 선택해 주세요.')
  const data = Buffer.from(input)
  const meta = await sharp(data, { limitInputPixels: 40000000 }).metadata()
  if (!['png', 'jpeg', 'webp'].includes(meta.format ?? '') || (meta.pages ?? 1) > 1)
    throw new Error('정지 PNG·JPEG·WebP만 지원합니다.')
  const result: ImageInfo = {
    format: meta.format!,
    width: meta.width!,
    height: meta.height!,
    sources: [],
    raw: [],
    warnings: []
  }
  let total = 0
  function add(label: string, text: string): void {
    total += Buffer.byteLength(text)
    if (total > IMAGE_INFO_TEXT_LIMIT || result.raw.length >= 128)
      throw new Error('메타데이터 용량 초과')
    result.raw.push({ label, text })
    let fields: ImageInfoFields
    try {
      const p = object(JSON.parse(text))
      fields =
        p.format === IMAGE_INFO_KEY && p.version === 1 && p.source === 'local-request'
          ? imageInfoFields({ ...object(p.fields), seedKind: 'request' })
          : fieldsFromText(text)
      if (p.format === IMAGE_INFO_KEY) label += ' · 앱 요청 사본 (서버 확정값 아님)'
    } catch {
      fields = fieldsFromText(text)
    }
    if (Object.keys(fields).length) result.sources.push({ label, fields })
  }
  if (meta.format === 'png') {
    pngChunks(data)
    const texts = parsePngTextChunks(data)
    for (const [key, value] of Object.entries(texts)) {
      add(`PNG ${key}`, value)
      if (['nais3-params', 'nais2-params'].includes(key)) {
        try {
          add(`PNG ${key} · decoded`, Buffer.from(value, 'base64').toString('utf8'))
        } catch {
          /* Keep the original text. */
        }
      }
      if (key === 'Description' && value && !result.sources.some((v) => v.fields.prompt))
        result.sources.push({ label: 'PNG Description (문구)', fields: { prompt: value } })
    }
    if (texts.Comment && texts.Description) {
      try {
        const comment = object(JSON.parse(texts.Comment))
        if (comment.prompt === undefined)
          result.sources.push({
            label: 'PNG Comment + Description',
            fields: fieldsFromText(JSON.stringify({ ...comment, prompt: texts.Description }))
          })
      } catch {
        /* Original fields remain individually visible. */
      }
    }
    const stealth = meta.hasAlpha ? await extractStealthComment(data) : null
    if (stealth) add('PNG stealth · 파일 기록', JSON.stringify(stealth))
  }
  if (meta.exif) for (const [key, value] of Object.entries(exifText(meta.exif))) add(key, value)
  if (meta.xmp) {
    const xmp = meta.xmp.toString('utf8')
    add('XMP 원문', xmp)
    // Decode textual RDF descriptions only. No XML parser, entities, URLs or external resources.
    for (const match of xmp.matchAll(/<rdf:li\b[^>]*>([^<]*)<\/rdf:li>/g)) {
      const text = match[1]
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
      if (text) add('XMP 설명', text)
    }
  }
  if (!result.sources.length)
    result.warnings.push('적용 가능한 생성 정보가 없습니다. 원문이 있으면 아래에서 확인하세요.')
  if (result.sources.length > 1)
    result.warnings.push(
      '출처별 값이 다를 수 있습니다. 자동으로 합치지 않으니 적용할 출처를 선택하세요.'
    )
  if (result.sources.some((v) => v.fields.seedKind === 'request'))
    result.warnings.push(
      '요청 시드는 개별 결과의 확정 시드가 아닙니다. 특히 4장 배치의 개별 시드는 추측하지 않습니다.'
    )
  result.warnings.push(
    '파일의 기록은 검증된 서버 응답이 아닙니다. NAI 전용 옵션·캐릭터 영역·레퍼런스는 PixAI로 변환하지 않습니다.'
  )
  return result
}
