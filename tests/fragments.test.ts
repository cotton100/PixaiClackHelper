import { describe, expect, it } from 'vitest'
import {
  processWildcards,
  resetSequentialCounters,
  type FragmentSource
} from '../src/main/fragments/processor'

const source: FragmentSource = {
  getLines: (path) => {
    const files: Record<string, string[]> = {
      hair: ['long hair', 'short hair', 'twin tails'],
      '의상/casual': ['t-shirt, jeans', 'hoodie'],
      nested: ['<hair>, smile'],
      loop: ['<loop>'] // 자기 참조
    }
    return files[path] ?? null
  }
}

/** 항상 첫 옵션을 고르는 결정적 rng */
const first = (): number => 0

describe('조각/와일드카드 치환 (NAIS2 이식)', () => {
  it('<이름> — 조각에서 줄 선택', () => {
    expect(processWildcards('1girl, <hair>', source, first)).toBe('1girl, long hair')
  })

  it('<폴더/이름> 경로 지원', () => {
    expect(processWildcards('<의상/casual>', source, first)).toBe('t-shirt, jeans')
  })

  it('없는 조각은 원본 유지 (NAIS2 동일)', () => {
    expect(processWildcards('<unknown>', source, first)).toBe('<unknown>')
  })

  it('<a|b|c> 인라인 와일드카드', () => {
    expect(processWildcards('<red|blue|green>', source, first)).toBe('red')
    expect(processWildcards('<red|blue|green>', source, () => 0.9)).toBe('green')
  })

  it('<*이름> 순차 선택 — 배치에서 한 줄씩 순환', () => {
    resetSequentialCounters()
    expect(processWildcards('<*hair>', source, first)).toBe('long hair')
    expect(processWildcards('<*hair>', source, first)).toBe('short hair')
    expect(processWildcards('<*hair>', source, first)).toBe('twin tails')
    expect(processWildcards('<*hair>', source, first)).toBe('long hair')
  })

  it('선택된 줄 안의 조각도 재귀 치환', () => {
    expect(processWildcards('<nested>', source, first)).toBe('long hair, smile')
  })

  it('자기 참조 조각은 깊이 가드로 정지 (NAIS2엔 없던 안전장치)', () => {
    const result = processWildcards('<loop>', source, first)
    expect(result).toBe('<loop>') // 가드에 걸려 원본 형태로 남음
  })

  it('(a, b/c, d) 괄호 와일드카드 — 쉼표 포함 옵션', () => {
    expect(processWildcards('(white hair, blue eyes/red hair, purple eyes)', source, first)).toBe(
      'white hair, blue eyes'
    )
  })

  it('단순 슬래시 와일드카드 — 공백 없는 태그만', () => {
    expect(processWildcards('1girl, red/blue/green, smile', source, first)).toBe(
      '1girl, red, smile'
    )
    // 공백 있으면 치환 안 함 (괄호 형식을 써야 함)
    expect(processWildcards('red hair/blue hair', source, first)).toBe('red hair/blue hair')
  })

  it('URL은 건드리지 않는다', () => {
    expect(processWildcards('https://example.com/a/b', source, first)).toBe(
      'https://example.com/a/b'
    )
  })
})
