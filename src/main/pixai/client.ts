import { numericId, type ApiPayload } from '../../shared/pixai/execution'

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly notSubmitted = false
  ) {
    super(message)
  }
}
export interface Task {
  id: string
  status: string
  outputs?: { mediaIds?: string[]; mediaUrls?: string[] }
}
export interface Media {
  id: string
  width?: number
  height?: number
  urls?: { variant: string; url: string }[]
  fileUrl?: string
}
export function imageUrl(href: string): URL {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    throw new Error('원본 이미지 주소 형식을 확인하지 못했습니다.')
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !(
      url.hostname === 'pixai.art' ||
      url.hostname.endsWith('.pixai.art') ||
      url.hostname === 'd2doj8oszwtcqy.cloudfront.net'
    )
  )
    throw new Error('허용된 PixAI 원본 이미지 주소가 아닙니다.')
  return url
}
async function bytes(response: Response, limit: number): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length')) > limit)
    throw new Error('응답 크기가 제한을 넘었습니다.')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('응답 내용이 없습니다.')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.length
      if (size > limit) throw new Error('응답 크기가 제한을 넘었습니다.')
      chunks.push(next.value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return Buffer.concat(chunks)
}
export class PixaiClient {
  constructor(
    private key: () => string,
    private fetcher: typeof fetch = fetch
  ) {}
  private async json<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    if (!(
      (method === 'POST' && path === '/v2/image/create') ||
      (method === 'GET' && /^\/v1\/(task|media)\/\d+$/.test(path))
    ))
      throw new Error('허용되지 않은 API 경로입니다.')
    const key = this.key()
    if (!key) throw new ApiError('설정에서 공식 API 키를 연결해 주세요.', true)
    let response: Response
    try {
      response = await this.fetcher(`https://api.pixai.art${path}`, {
        method,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: 'error',
        credentials: 'omit',
        signal: AbortSignal.timeout(60000)
      })
    } catch {
      throw new ApiError(
        '공식 API 통신이 끊겼습니다. 제출 여부가 불명확하면 다시 생성하지 않습니다.'
      )
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      throw new ApiError(
        `공식 API 오류 (${response.status}). 키·모델 버전·생성 옵션을 확인해 주세요.`,
        method === 'POST' && [400, 401, 403, 404, 422].includes(response.status)
      )
    }
    try {
      return JSON.parse(new TextDecoder().decode(await bytes(response, 2 * 1024 * 1024))) as T
    } catch {
      throw new ApiError('공식 API 응답을 확인하지 못했습니다. 자동 재제출하지 않습니다.')
    }
  }
  async create(payload: ApiPayload): Promise<string> {
    const task = await this.json<Task>('POST', '/v2/image/create', payload)
    try {
      return numericId(task.id)
    } catch {
      throw new ApiError('작업 ID를 받지 못했습니다. 자동 재제출하지 않습니다.')
    }
  }
  async task(id: string): Promise<Task> {
    const task = await this.json<Task>('GET', `/v1/task/${numericId(id)}`)
    if (task.id !== id) throw new Error('작업 ID가 일치하지 않습니다.')
    return task
  }
  async media(id: string): Promise<Media> {
    const media = await this.json<Media>('GET', `/v1/media/${numericId(id)}`)
    if (media.id !== id) throw new Error('미디어 ID가 일치하지 않습니다.')
    return media
  }
  async image(href: string): Promise<Uint8Array> {
    const url = imageUrl(href)
    let response: Response
    try {
      response = await this.fetcher(url.href, {
        redirect: 'error',
        credentials: 'omit',
        signal: AbortSignal.timeout(90000)
      })
    } catch {
      throw new Error('원본 이미지 다운로드 실패. 생성하지 않고 저장만 다시 시도할 수 있습니다.')
    }
    if (
      !response.ok ||
      !/^image\/(png|jpeg|webp)(?:;|$)/i.test(response.headers.get('content-type') ?? '')
    )
      throw new Error('원본 이미지 응답을 확인하지 못했습니다.')
    return bytes(response, 64 * 1024 * 1024)
  }
}
