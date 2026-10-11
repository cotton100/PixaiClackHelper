import { describe, expect, it, vi } from 'vitest'
import { parseModelLink } from '../src/shared/pixai/model-link'
import { readModelLink } from '../src/main/pixai/model-link'

describe('PixAI public model links', () => {
  it('keeps large model and version IDs distinct and strips tracking parameters', () => {
    expect(
      parseModelLink(
        'https://pixai.art/ko/model/1861558737426484240-Haruka-v2/1861558740588989558?ref=test#x'
      )
    ).toEqual({
      id: '1861558737426484240',
      versionId: '1861558740588989558',
      name: 'Haruka v2',
      url: 'https://pixai.art/model/1861558737426484240/1861558740588989558',
      notice: '링크의 모델 ID와 버전 ID를 읽었습니다.'
    })
  })
  it('does not guess a version from the model ID', () => {
    const info = parseModelLink('https://pixai.art/model/123')
    expect(info.id).toBe('123')
    expect(info.versionId).toBe('')
    expect(info.notice).toContain('버전 ID를 직접 입력')
  })
  it.each([
    'http://pixai.art/model/123/456',
    'https://pixai.art.evil.test/model/123/456',
    'https://user:password@pixai.art/model/123',
    'https://pixai.art:444/model/123',
    'https://pixai.art/api/model/123',
    'https://pixai.art/model/abc',
    'file:///model/123',
    'https://pixai.art/model/123/456/789'
  ])('rejects unrelated URLs: %s', (url) => expect(() => parseModelLink(url)).toThrow())
  it('reads only the public title without credentials or redirects', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response('<meta content="Haruka &amp; friends - PixAI" property="og:title">', {
          headers: { 'content-type': 'text/html; charset=utf-8' }
        })
    )
    const info = await readModelLink('https://pixai.art/model/123/456', fetcher)
    expect(info.name).toBe('Haruka & friends')
    expect(fetcher).toHaveBeenCalledWith(
      'https://pixai.art/model/123/456',
      expect.objectContaining({
        credentials: 'omit',
        redirect: 'error',
        headers: { Accept: 'text/html' }
      })
    )
  })
  it('still returns explicit IDs if public-page access fails', async () => {
    const info = await readModelLink(
      'https://pixai.art/model/123-test/456',
      vi.fn(async () => new Response('', { status: 403 }))
    )
    expect(info).toMatchObject({ id: '123', versionId: '456', name: 'test' })
    expect(info.notice).toContain('링크에 포함된 정보만')
  })
  it('bounds public-page reads and never requests an invalid host', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response('x'.repeat(2 * 1024 * 1024 + 1), { headers: { 'content-type': 'text/html' } })
    )
    expect((await readModelLink('https://pixai.art/model/123', fetcher)).notice).toContain(
      '링크에 포함된 정보만'
    )
    fetcher.mockClear()
    await expect(readModelLink('https://example.com/model/123', fetcher)).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
})
