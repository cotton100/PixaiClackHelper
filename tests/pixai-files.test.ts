import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { saveMedia } from '../src/main/pixai/files'
import type { ExecutionJob } from '../src/shared/pixai/execution'

let folder: string
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'pixais-files-test-'))
})
afterEach(async () => {
  await rm(folder, { recursive: true, force: true })
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
  expect(await readFile(first)).toEqual(png)
  expect(await saveMedia(client, job, '11')).toBe(first)
  expect(await readdir(folder)).toHaveLength(1)
  await writeFile(first, 'original unrelated file')
  const second = await saveMedia(client, job, '11')
  expect(second).not.toBe(first)
  expect(await readFile(first, 'utf8')).toBe('original unrelated file')
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
