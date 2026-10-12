import { expect, it } from 'vitest'
import sharp from 'sharp'
import { deflateSync, gzipSync } from 'node:zlib'
import { readImageInfo, embedGenerationInfo } from '../src/main/pixai/image-info'
import { imageInfoFields, IMAGE_INFO_MAX_BYTES } from '../src/shared/pixai/image-info'
import { buildPayload, type ExecutionJob } from '../src/shared/pixai/execution'
import { pixaiLibrary } from './fixtures/pixai-workspace'
import {
  expandReservations,
  strictLibrary,
  composePrompts,
  resolvePresetCommon
} from '../src/shared/pixai/library'
import { emptyWorkspace, createPixaiStore, readWorkspace } from '../src/renderer/src/pixai/store'
import { emptyDraft } from '../src/renderer/src/pixai/composition'
import { importImageComposition, noImageSelection } from '../src/renderer/src/pixai/image-import'

async function png(): Promise<Buffer> {
  return sharp({ create: { width: 5, height: 3, channels: 4, background: '#71ccbc' } })
    .png()
    .toBuffer()
}
function crc(data: Buffer): number {
  let c = 0xffffffff
  for (const b of data) {
    c ^= b
    for (let n = 0; n < 8; n++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0)
  }
  return (c ^ 0xffffffff) >>> 0
}
function add(data: Buffer, type: string, body: Buffer): Buffer {
  const b = Buffer.alloc(body.length + 12)
  b.writeUInt32BE(body.length)
  b.write(type, 4)
  body.copy(b, 8)
  b.writeUInt32BE(crc(b.subarray(4, -4)), b.length - 4)
  return Buffer.concat([data.subarray(0, -12), b, data.subarray(-12)])
}
function job(): ExecutionJob {
  const library = pixaiLibrary()
  library.reservations = [
    { id: 'r1', presetId: 'p1', characterId: 'c1', sceneIds: ['s1'], count: 1 }
  ]
  const request = expandReservations(library)[0]
  return {
    id: 'test-job',
    title: 'private title',
    state: 'saving',
    outputDir: 'private folder',
    files: [],
    error: '',
    updatedAt: 1,
    embedMetadata: true,
    metadataReferences: { modelId: '10', loraModelIds: ['20'] },
    taskId: '123',
    payload: buildPayload({ request, imageCount: 4, options: emptyWorkspace().options }, 42)
  }
}
it('roundtrips the request without re-encoding pixels, preserves existing EXIF/text, omits private fields', async () => {
  const original = add(await png(), 'tEXt', Buffer.from('Software\0Original generator'))
  const recorded = embedGenerationInfo(original, job(), '11')
  const result = await readImageInfo(recorded)
  expect(result.raw.find((v) => v.label === 'PNG Software')?.text).toBe('Original generator')
  expect(result.sources[0].fields).toMatchObject({
    seed: 42,
    seedKind: 'request',
    batchSize: 4,
    modelId: '10',
    modelVersionId: '100',
    loras: [{ id: '20', versionId: '200', weight: 0.5 }]
  })
  expect(result.warnings.join(' ')).toContain('개별 시드')
  expect(recorded.includes(Buffer.from('private'))).toBe(false)
  expect(recorded.subarray(0, original.length - 12)).toEqual(original.subarray(0, -12))
  expect(await sharp(recorded).raw().toBuffer()).toEqual(await sharp(original).raw().toBuffer())
  expect(embedGenerationInfo(original, job(), '11')).toEqual(recorded)
})
it('reads Unicode iTXt, zTXt parameters and distinguishes file dimensions', async () => {
  let data = add(
    await png(),
    'iTXt',
    Buffer.from(
      'Comment\0\0\0\0\0' + JSON.stringify({ prompt: '미소', uc: 'blur', width: 1280, height: 768 })
    )
  )
  data = add(
    data,
    'zTXt',
    Buffer.concat([
      Buffer.from('parameters\0\0'),
      deflateSync('smile\nNegative prompt: blur\nSteps: 20, Seed: 123, Size: 1280x768')
    ])
  )
  const info = await readImageInfo(data)
  expect(info.width).toBe(5)
  expect(info.sources.map((v) => v.fields)).toContainEqual({
    prompt: '미소',
    negativePrompt: 'blur',
    width: 1280,
    height: 768
  })
  expect(info.sources.find((v) => v.label.includes('parameters'))?.fields).toMatchObject({
    prompt: 'smile',
    negativePrompt: 'blur',
    seed: 123,
    width: 1280
  })
})
it('reads supported JPEG/WebP EXIF descriptions without treating software as a prompt', async () => {
  for (const format of ['jpeg', 'webp'] as const) {
    const data = await sharp(await png())
      .withExif({
        IFD0: {
          ImageDescription: JSON.stringify({ prompt: 'image prompt', negative_prompt: 'bad' }),
          Software: 'editor'
        }
      })
      [format]()
      .toBuffer()
    const info = await readImageInfo(data)
    expect(info.format).toBe(format)
    expect(info.sources[0].fields).toMatchObject({ prompt: 'image prompt', negativePrompt: 'bad' })
    expect(info.raw.some((v) => v.text === 'editor')).toBe(true)
  }
})
it('reads XMP descriptions as text without executing or loading XML entities', async () => {
  const xml =
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:description><rdf:Alt><rdf:li xml:lang="x-default">{&quot;prompt&quot;:&quot;smile&quot;}</rdf:li></rdf:Alt></dc:description></rdf:Description></rdf:RDF></x:xmpmeta>'
  const data = await sharp(await png())
    .withXmp(xml)
    .webp()
    .toBuffer()
  const info = await readImageInfo(data)
  expect(info.sources.some((v) => v.fields.prompt === 'smile')).toBe(true)
})
it('reads the supported NovelAI alpha stealth record', async () => {
  const width = 64,
    height = 64
  const raw = Buffer.alloc(width * height * 4, 254)
  const compressed = gzipSync(
    JSON.stringify({ Comment: JSON.stringify({ prompt: 'stealth prompt', uc: 'bad', seed: 9 }) })
  )
  const length = Buffer.alloc(4)
  length.writeUInt32BE(compressed.length * 8)
  const encoded = Buffer.concat([Buffer.from('stealth_pngcomp'), length, compressed])
  for (let i = 0; i < encoded.length * 8; i++) {
    const x = Math.floor(i / height),
      y = i % height
    raw[(y * width + x) * 4 + 3] |= (encoded[i >> 3] >> (7 - (i & 7))) & 1
  }
  const data = await sharp(raw, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer()
  expect((await readImageInfo(data)).sources[0].fields).toMatchObject({
    prompt: 'stealth prompt',
    negativePrompt: 'bad',
    seed: 9
  })
})
it('reports no generation data and rejects damaged/oversized input and compressed metadata bombs', async () => {
  expect((await readImageInfo(await png())).sources).toEqual([])
  await expect(readImageInfo(new Uint8Array(IMAGE_INFO_MAX_BYTES + 1))).rejects.toThrow('32MB')
  await expect(readImageInfo(Buffer.from('not image'))).rejects.toThrow()
  const broken = await png()
  broken[broken.length - 1] ^= 1
  await expect(readImageInfo(broken)).rejects.toThrow('무결성')
  const bomb = add(
    await png(),
    'zTXt',
    Buffer.concat([Buffer.from('Comment\0\0'), deflateSync('x'.repeat(2 * 1024 * 1024))])
  )
  expect((await readImageInfo(bomb)).sources).toEqual([])
})
it('drops unsupported and invalid settings, never invents model IDs or per-image seeds', () => {
  expect(
    imageInfoFields({
      seed: -1,
      modelVersionId: 'nai-diffusion',
      width: Infinity,
      mode: 'turbo',
      loras: [{ versionId: '1', weight: 2 }]
    })
  ).toEqual({})
})

it('keeps NAIS local data readable and combines NAI Description only with its own Comment', async () => {
  let data = add(await png(), 'tEXt', Buffer.from('Description\0nai prompt'))
  data = add(data, 'tEXt', Buffer.from('Comment\0' + JSON.stringify({ seed: 2, uc: 'bad' })))
  data = add(
    data,
    'tEXt',
    Buffer.from(
      'nais3-params\0' +
        Buffer.from(JSON.stringify({ version: 1, promptParts: { base: 'nai base' } })).toString(
          'base64'
        )
    )
  )
  const info = await readImageInfo(data)
  expect(info.sources.find((v) => v.label === 'PNG Comment + Description')?.fields).toMatchObject({
    prompt: 'nai prompt',
    negativePrompt: 'bad',
    seed: 2
  })
  expect(info.raw.find((v) => v.label.includes('decoded'))?.text).toContain('nai base')
})
it('applies selected fields atomically without double common/trigger text or changing existing jobs', async () => {
  const workspace = {
    ...emptyWorkspace(),
    library: pixaiLibrary(),
    composeDraft: { ...emptyDraft(), presetId: 'p1', characterId: 'c1', sceneIds: ['s1'] }
  }
  const original = JSON.stringify(workspace)
  const selection = { ...noImageSelection(), prompt: true, image: true, seed: true }
  const next = importImageComposition(
    workspace,
    { prompt: 'imported final prompt', aspectRatio: '5:3', seed: 123, seedKind: 'request' },
    selection,
    'import'
  )
  const library = strictLibrary(next.library),
    draft = next.composeDraft!
  const preset = library.presets.find((v) => v.id === draft.presetId)!
  const output = composePrompts(
    resolvePresetCommon(library, preset),
    library.characters.find((v) => v.id === draft.characterId)!,
    library.scenes.filter((v) => draft.sceneIds.includes(v.id)),
    preset,
    draft.triggerPosition
  )
  expect(output).toEqual({ prompt: 'imported final prompt', negativePrompt: 'blur' })
  expect(next.options.api?.seed).toBe('123')
  expect(next.composeDraft?.imageOptions?.aspectRatio).toBe('5:3')
  expect(next.jobs).toEqual(workspace.jobs)
  expect(JSON.stringify(workspace)).toBe(original)
  expect(readWorkspace(JSON.stringify(next)).composeDraft).toEqual(next.composeDraft)
  const store = createPixaiStore({
    read: async () => original,
    write: async () => {
      throw new Error('full')
    }
  })
  await store.getState().hydrate()
  await expect(store.getState().commit(() => next)).rejects.toThrow('저장하지 못했습니다')
  expect(store.getState().workspace).toEqual(workspace)
})
it('reconstructs a complete PixAI model/LoRA preset and preserves frozen reservations', async () => {
  const info = await readImageInfo(embedGenerationInfo(await png(), job(), '11'))
  const workspace = { ...emptyWorkspace(), library: pixaiLibrary() }
  const before = structuredClone(workspace.library)
  const next = importImageComposition(
    workspace,
    info.sources[0].fields,
    { ...noImageSelection(), prompt: true, negativePrompt: true, model: true },
    'roundtrip'
  )
  const checked = readWorkspace(JSON.stringify(next))
  expect(checked.library.presets.at(-1)?.model).toEqual({ id: '10', versionId: '100', name: '' })
  expect(checked.library.presets.at(-1)?.loras[0]).toMatchObject({
    id: '20',
    versionId: '200',
    weight: 0.5
  })
  expect(workspace.library).toEqual(before)
})
