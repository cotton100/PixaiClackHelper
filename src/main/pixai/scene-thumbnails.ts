import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import type { SceneThumbnail, SceneThumbnailStatus } from '../../shared/pixai/execution'

// A bounded local preview cache, separate from the generation journal and library backups.
const MAX_IMAGES = 200
const MAX_URL = 64 * 1024
const MAX_CACHE = 4 * 1024 * 1024
interface CacheIO {
  read(): string | null
  write(text: string): void
}
export class SceneThumbnails {
  private images: SceneThumbnail[] = []
  private revision = randomUUID()
  constructor(private io: CacheIO) {
    try {
      const text = io.read()
      if (!text || text.length > MAX_CACHE) return
      const saved: unknown = JSON.parse(text)
      if (!Array.isArray(saved)) return
      this.images = saved
        .filter(
          (item): item is SceneThumbnail =>
            typeof item?.sceneId === 'string' &&
            item.sceneId.length > 0 &&
            item.sceneId.length <= 200 &&
            typeof item.dataUrl === 'string' &&
            item.dataUrl.length <= MAX_URL &&
            /^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/.test(item.dataUrl) &&
            Number.isFinite(item.savedAt)
        )
        .slice(0, MAX_IMAGES)
    } catch {
      // A corrupt preview must never prevent opening the workspace or resuming generation.
    }
  }
  status(revision?: string): SceneThumbnailStatus {
    return {
      revision: this.revision,
      ...(revision === this.revision ? {} : { images: structuredClone(this.images) })
    }
  }
  /** Only called with a verified original returned by saveMedia; never a renderer path. */
  async remember(sceneId: string | undefined, file: string): Promise<void> {
    if (!sceneId || sceneId.length > 200) return
    const savedAt = Date.now()
    try {
      const data = await sharp(file, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize(256, 192, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 65 })
        .toBuffer()
      const dataUrl = `data:image/webp;base64,${data.toString('base64')}`
      if (
        dataUrl.length > MAX_URL ||
        this.images.some((item) => item.sceneId === sceneId && item.savedAt > savedAt)
      )
        return
      const next = [
        { sceneId, dataUrl, savedAt },
        ...this.images.filter((item) => item.sceneId !== sceneId)
      ].slice(0, MAX_IMAGES)
      while (JSON.stringify(next).length > MAX_CACHE) next.pop()
      this.io.write(JSON.stringify(next))
      this.images = next
      this.revision = randomUUID()
    } catch {
      // The original is already saved. Preview failures must not fail or resubmit that job.
    }
  }
}
