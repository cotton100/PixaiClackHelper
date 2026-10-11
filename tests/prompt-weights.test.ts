import { describe, expect, it } from 'vitest'
import { parseWeights } from '../src/renderer/src/lib/prompt-weights'

function segmentFor(text: string, sub: string): number {
  const idx = text.indexOf(sub)
  const segs = parseWeights(text)
  const seg = segs.find((s) => s.start <= idx && idx + sub.length <= s.end)
  if (!seg) throw new Error(`no segment covering ${sub}: ${JSON.stringify(segs)}`)
  return seg.weight
}

describe('NAI 가중치 파서', () => {
  it('가중치 없는 텍스트는 단일 세그먼트 1.0', () => {
    expect(parseWeights('1girl, solo')).toEqual([{ start: 0, end: 11, weight: 1 }])
  })

  it('중괄호는 중첩당 ×1.05', () => {
    expect(segmentFor('a {b} c', 'b')).toBeCloseTo(1.05, 10)
    expect(segmentFor('{{{best quality}}}', 'best quality')).toBeCloseTo(1.05 ** 3, 10)
  })

  it('대괄호는 중첩당 ÷1.05', () => {
    expect(segmentFor('a [b] c', 'b')).toBeCloseTo(1 / 1.05, 10)
    expect(segmentFor('[[x]]', 'x')).toBeCloseTo(1.05 ** -2, 10)
  })

  it('수치 가중치 N::...:: (실캡처 형식)', () => {
    expect(segmentFor('1.0::mature women::, black hair', 'mature women')).toBe(1.0)
    expect(segmentFor('-3:: artist collaboration ::, x', 'artist collaboration')).toBe(-3)
    expect(segmentFor('-1::flat color::', 'flat color')).toBe(-1)
  })

  it('수치 가중치 밖은 1.0으로 복귀', () => {
    expect(segmentFor('-1::flat color::, smile', 'smile')).toBe(1)
  })

  it('수치 가중치 안의 중괄호는 곱으로 누적', () => {
    expect(segmentFor('1.2::a {b} c::', 'b')).toBeCloseTo(1.2 * 1.05, 10)
  })

  it('세그먼트는 전체 텍스트를 빈틈없이 덮는다', () => {
    const text = '{{masterpiece}}, 1.5::glow::, [dark], plain'
    const segs = parseWeights(text)
    expect(segs[0].start).toBe(0)
    expect(segs[segs.length - 1].end).toBe(text.length)
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i].start).toBe(segs[i - 1].end)
    }
  })

  it('짝이 안 맞는 닫는 괄호는 무시 (음수 깊이 방지)', () => {
    expect(segmentFor('a } b', 'b')).toBe(1)
  })
})
