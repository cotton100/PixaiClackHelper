import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getAppPath: () => '/mock-app' }
}))

vi.mock('fs', () => ({
  readFileSync: vi.fn(() =>
    JSON.stringify([
      { value: 'very long hair', count: 1_000, type: 'general' },
      { value: 'long sleeves', count: 500, type: 'general' },
      { value: 'long hair', count: 400, type: 'general' },
      { value: 'blonde hair', count: 300, type: 'general' },
      { value: 'longshot', count: 200, type: 'artist' }
    ])
  )
}))

import { searchTags } from '../src/main/tags'

describe('태그 자동완성', () => {
  it('잘못된 IPC 검색어와 과도하게 긴 검색어를 거부한다', () => {
    for (const query of [undefined, null, 12, [], {}, 'a'.repeat(201)]) {
      expect(searchTags(query)).toEqual([])
    }
  })

  it('응답 개수는 정수 1~20개만 허용한다', () => {
    for (const limit of [null, '8', NaN, Infinity, -1, 0, 1.5, 21, 1_000_000]) {
      expect(searchTags('long', limit)).toEqual([])
    }
    expect(searchTags('long', 1)).toHaveLength(1)
    expect(searchTags('long', 20)).toHaveLength(4)
    expect(searchTags('long', undefined)).toHaveLength(4)
  })

  it('두 글자 미만의 검색어에는 결과를 반환하지 않는다', () => {
    expect(searchTags('l')).toEqual([])
    expect(searchTags(' _ ')).toEqual([])
  })

  it('대소문자와 밑줄을 정규화해 검색한다', () => {
    expect(searchTags(' LONG_HAIR ').map((tag) => tag.tag)).toEqual(['long hair', 'very long hair'])
  })

  it('더 인기 있는 부분 일치보다 접두어 일치를 먼저 반환한다', () => {
    expect(searchTags('long').map((tag) => tag.tag)).toEqual([
      'long sleeves',
      'long hair',
      'longshot',
      'very long hair'
    ])
  })

  it('요청한 결과 개수를 넘기지 않는다', () => {
    expect(searchTags('long', 2).map((tag) => tag.tag)).toEqual(['long sleeves', 'long hair'])
  })
})
