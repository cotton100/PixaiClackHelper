import { parseModelLink, type ModelLinkInfo } from '../../shared/pixai/model-link'

const decode = (value: string): string =>
  value.replace(
    /&(?:amp|quot|apos|lt|gt|#39);/g,
    (entity) =>
      ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&#39;': "'" })[
        entity
      ] ?? entity
  )

export async function readModelLink(
  value: string,
  fetcher: typeof fetch = fetch
): Promise<ModelLinkInfo> {
  const info = parseModelLink(value)
  // Public page only. Never use the API key, browser cookies, or private web endpoints.
  try {
    const response = await fetcher(info.url, {
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: { Accept: 'text/html' }
    })
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('text/html')) {
      await response.body?.cancel()
      throw new Error('unavailable')
    }
    const reader = response.body?.getReader()
    if (!reader) throw new Error('empty')
    const parts: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        const next = await reader.read()
        if (next.done) break
        size += next.value.length
        if (size > 2 * 1024 * 1024) throw new Error('large')
        parts.push(next.value)
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
    const html = Buffer.concat(parts).toString('utf8')
    const tag = html.match(/<meta\b[^>]*\bproperty=["']og:title["'][^>]*>/i)?.[0]
    const title = tag?.match(/\bcontent=["']([^"']*)["']/i)?.[1]
    if (title)
      info.name = decode(title)
        .replace(/\s*[-|｜]\s*PixAI.*$/i, '')
        .trim()
        .slice(0, 200)
    else info.notice += ' 이름은 페이지에서 확인하지 못했습니다. 직접 입력해 주세요.'
  } catch {
    info.notice += ' 공개 페이지 제목을 읽지 못해 링크에 포함된 정보만 가져왔습니다.'
  }
  return info
}
