import { constants } from 'node:fs'
import { access, open, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import type { ExecutionJob, SavedMedia } from '../../shared/pixai/execution'
import type { PixaiClient } from './client'
import { embedGenerationInfo } from './image-info'

export async function checkFolder(folder: string): Promise<void> {
  if (!folder || !(await stat(folder)).isDirectory()) throw new Error('저장 폴더를 선택해 주세요.')
  await access(folder, constants.W_OK)
}
function cleanTitle(title: string): string {
  return (
    title
      .replace(/[<>:"/\\|?*]/g, '_')
      .split('')
      .map((char) => (char.charCodeAt(0) < 32 ? '_' : char))
      .join('')
      .replace(/[. ]+$/g, '')
      .slice(0, 65) || 'PixAI'
  )
}
export async function saveMedia(
  client: Pick<PixaiClient, 'media' | 'image'>,
  job: ExecutionJob,
  mediaId: string
): Promise<SavedMedia> {
  const media = await client.media(mediaId)
  const url = media.urls?.find((item) => item.variant === 'PUBLIC')?.url ?? media.fileUrl
  if (!url) throw new Error('원본 이미지 주소가 없습니다. 썸네일로 대체하지 않습니다.')
  let data: Buffer = Buffer.from(await client.image(url))
  const metadata = await sharp(data, { limitInputPixels: 40000000 }).metadata()
  if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || !data.length)
    throw new Error('지원하지 않는 이미지입니다.')
  if (
    (media.width && media.width !== metadata.width) ||
    (media.height && media.height !== metadata.height)
  )
    throw new Error('다운로드한 이미지 크기가 원본과 다릅니다.')
  const ext = metadata.format === 'jpeg' ? 'jpg' : metadata.format
  let warning: string | undefined
  if (job.embedMetadata === true && metadata.format === 'png') {
    try {
      data = embedGenerationInfo(data, job, mediaId)
    } catch {
      // Optional metadata must never prevent saving an already paid-for image.
      // Keep the downloaded bytes and do not expose parser errors or prompt text.
      warning = '생성 요청 정보를 추가하지 못해 원본 그대로 저장했습니다.'
    }
  }
  const jobHash = createHash('sha256').update(job.id).digest('hex').slice(0, 12)
  const base = `${cleanTitle(job.title)}_${jobHash}_${mediaId}`
  const original = join(job.outputDir, `${base}.${ext}`)
  // Recovery can recognize an already completed file. Never overwrite another file.
  try {
    if ((await readFile(original)).equals(data)) return { path: original, warning }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  let filePath = original
  for (let attempt = 0; attempt < 4; attempt++) {
    let handle
    try {
      handle = await open(filePath, 'wx')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      filePath = join(job.outputDir, `${base}_${randomUUID().slice(0, 8)}.${ext}`)
      continue
    }
    try {
      await handle.writeFile(data)
      await handle.sync()
    } finally {
      await handle.close()
    }
    if (!(await readFile(filePath)).equals(data))
      throw new Error('저장한 이미지 검증에 실패했습니다.')
    return { path: filePath, warning }
  }
  throw new Error('저장 파일명 충돌로 중단했습니다.')
}
