export interface ModelLinkInfo {
  id: string
  versionId: string
  name: string
  url: string
  notice: string
}

/** Only the public model-page URL format documented by PixAI is accepted. */
export function parseModelLink(value: string): ModelLinkInfo {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('PixAI 모델·LoRA 링크를 입력해 주세요.')
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'pixai.art' ||
    url.port ||
    url.username ||
    url.password
  )
    throw new Error('https://pixai.art 모델 링크만 사용할 수 있습니다.')
  const match = url.pathname.match(
    /^\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?model\/(\d{1,40})(?:-([^/]+))?(?:\/(\d{1,40}))?\/?$/
  )
  if (!match) throw new Error('PixAI 모델 페이지에서 사용할 버전을 선택한 뒤 링크를 복사해 주세요.')
  let name = ''
  try {
    name = decodeURIComponent(match[2] ?? '')
      .replace(/[-_]+/g, ' ')
      .slice(0, 200)
  } catch {
    /* optional name */
  }
  return {
    id: match[1],
    versionId: match[3] ?? '',
    name,
    url: `https://pixai.art/model/${match[1]}${match[3] ? `/${match[3]}` : ''}`,
    notice: match[3]
      ? '링크의 모델 ID와 버전 ID를 읽었습니다.'
      : '모델 ID만 있는 링크입니다. 사이트에서 버전을 선택한 링크를 넣거나 버전 ID를 직접 입력해 주세요.'
  }
}
