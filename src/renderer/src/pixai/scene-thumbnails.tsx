import { useState } from 'react'
import { ImageIcon } from 'lucide-react'
import type { SceneThumbnail } from '@shared/pixai/execution'

export function SceneThumbnailView({
  name,
  image,
  error
}: {
  name: string
  image?: SceneThumbnail
  error: boolean
}): React.JSX.Element {
  const [failedUrl, setFailedUrl] = useState('')
  const available = image && image.dataUrl !== failedUrl
  return (
    <figure className="px-scene-thumbnail" aria-label={`${name} 생성 결과`}>
      {available ? (
        <img
          src={image.dataUrl}
          alt={`${name} 최근 생성 이미지`}
          loading="lazy"
          onError={() => setFailedUrl(image.dataUrl)}
        />
      ) : (
        <ImageIcon size={23} aria-hidden="true" />
      )}
      <figcaption>
        {available ? '최근 생성' : error || image ? '미리보기 없음' : '생성 후 표시'}
      </figcaption>
    </figure>
  )
}
