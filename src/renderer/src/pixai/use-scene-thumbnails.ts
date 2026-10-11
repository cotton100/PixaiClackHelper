import { useEffect, useState } from 'react'
import type { SceneThumbnail } from '@shared/pixai/execution'

export function useSceneThumbnails(): { images: SceneThumbnail[]; error: boolean } {
  const [images, setImages] = useState<SceneThumbnail[]>([])
  const [error, setError] = useState(false)
  useEffect(() => {
    if (!window.nais || window.nais.runtime === 'browser') return
    let live = true,
      revision: string | undefined,
      timer: ReturnType<typeof setTimeout>
    const load = async (): Promise<void> => {
      try {
        const result = await window.nais.invoke('pixai:scene-thumbnails', { revision })
        if (live) {
          if (result.images) setImages(result.images)
          revision = result.revision
          setError(false)
        }
      } catch {
        if (live) setError(true)
      } finally {
        if (live) timer = setTimeout(() => void load(), 5000)
      }
    }
    void load()
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [])
  return { images, error }
}
