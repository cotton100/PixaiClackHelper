import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { saveMedia } from '../src/main/pixai/files'
import type { ExecutionJob } from '../src/shared/pixai/execution'
import { readImageInfo } from '../src/main/pixai/image-info'

let folder: string
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'pixais-files-test-'))
})

it('reuses metadata-enriched PNG on recovery; default off and non-PNG preserve original bytes', async () => {
  const png = await sharp({ create: { width: 5, height: 3, channels: 3, background: '#123456' } })
    .png()
    .toBuffer()
  const client = {
    media: async () => ({ id: '11', fileUrl: 'https://pixai.art/test.png' }),
    image: async () => png
  }
  const job = {
    id: 'recorded',
    title: 'test',
    outputDir: folder,
    embedMetadata: true,
    payload: {
      prompt: 'test',
      negativePrompt: '',
      modelVersionId: '100',
      seed: 42,
      batchSize: 4,
      aspectRatio: '5:3',
      size: '1k',
      loras: []
    }
  } as unknown as ExecutionJob
  const first = await saveMedia(client, job, '11')
  const info = await readImageInfo(await readFile(first.path))
  expect(info.sources[0].fields).toMatchObject({
    prompt: 'test',
    seedKind: 'request',
    batchSize: 4
  })
  expect(first.warning).toBeUndefined()
  expect(await saveMedia(client, job, '11')).toEqual(first)
  expect(await readdir(folder)).toHaveLength(1)
  const jpeg = await sharp(png).jpeg().toBuffer()
  const second = await saveMedia(
    { ...client, image: async () => jpeg },
    { ...job, id: 'jpeg' },
    '12'
  )
  expect(await readFile(second.path)).toEqual(jpeg)
  expect(await readdir(folder)).toHaveLength(2)
})
afterEach(async () => {
  await rm(folder, { recursive: true, force: true })
})
it('saves the original with a warning when an ancillary CRC prevents metadata insertion, including recovery', async () => {
  const png = await sharp({ create: { width: 5, height: 3, channels: 3, background: '#123456' } })
    .png()
    .toBuffer()
  const text = Buffer.from('Software\0test')
  const chunk = Buffer.alloc(text.length + 12)
  chunk.writeUInt32BE(text.length, 0)
  chunk.write('tEXt', 4)
  text.copy(chunk, 8)
  // Deliberately invalid CRC in ancillary text; image pixels and structure remain intact.
  const original = Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)])
  expect((await sharp(original).metadata()).width).toBe(5)
  await expect(readImageInfo(original)).rejects.toThrow('PNG 무결성')
  const client = {
    media: async () => ({ id: '11', width: 5, height: 3, fileUrl: 'https://pixai.art/test.png' }),
    image: async () => original
  }
  const job: ExecutionJob = {
    id: 'fallback',
    title: 'test',
    outputDir: folder,
    embedMetadata: true,
    state: 'saving',
    files: [],
    error: '',
    updatedAt: 0,
    payload: {
      prompt: 'test',
      negativePrompt: '',
      modelVersionId: '100',
      loras: [],
      seed: 42,
      batchSize: 4,
      aspectRatio: '5:3',
      size: '1k',
      promptHelper: 'disable'
    }
  }
  const first = await saveMedia(client, job, '11')
  expect(first.warning).toBe('생성 요청 정보를 추가하지 못해 원본 그대로 저장했습니다.')
  expect(await readFile(first.path)).toEqual(original)
  expect(await saveMedia(client, job, '11')).toEqual(first)
  expect(await readdir(folder)).toHaveLength(1)
  // Real validation and I/O failures must still fail, rather than claim a successful save.
  await expect(
    saveMedia({ ...client, image: async () => Buffer.from('not an image') }, job, '11')
  ).rejects.toThrow()
  await expect(
    saveMedia(client, { ...job, outputDir: join(folder, 'missing') }, '11')
  ).rejects.toThrow()
  expect(await readdir(folder)).toHaveLength(1)
})
it('writes only verified original images, reuses an identical output, and preserves collisions', async () => {
  const png = await sharp({ create: { width: 5, height: 3, channels: 3, background: '#71ccbc' } })
    .png()
    .toBuffer()
  const client = {
    media: vi.fn(async () => ({
      id: '11',
      width: 5,
      height: 3,
      urls: [{ variant: 'PUBLIC', url: 'https://pixai.art/images/orig/test.png' }]
    })),
    image: vi.fn(async () => png)
  }
  const job = { id: 'job1', title: 'bad:/title?', outputDir: folder } as ExecutionJob
  const first = await saveMedia(client, job, '11')
  expect(await readFile(first.path)).toEqual(png)
  expect(await saveMedia(client, job, '11')).toEqual(first)
  expect(await readdir(folder)).toHaveLength(1)
  await writeFile(first.path, 'original unrelated file')
  const second = await saveMedia(client, job, '11')
  expect(second.path).not.toBe(first.path)
  expect(await readFile(first.path, 'utf8')).toBe('original unrelated file')
  expect((await readdir(folder)).every((name) => name.endsWith('.png'))).toBe(true)
  client.media.mockResolvedValueOnce({
    id: '11',
    width: 50,
    height: 30,
    urls: [{ variant: 'PUBLIC', url: 'https://pixai.art/test.png' }]
  })
  await expect(saveMedia(client, job, '11')).rejects.toThrow('크기가 원본과 다릅니다')
  expect(await readdir(folder)).toHaveLength(2)
})
