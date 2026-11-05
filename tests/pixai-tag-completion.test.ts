import { describe, expect, it } from 'vitest'
import { completeTag, tagPopupPosition, tagToken } from '../src/renderer/src/pixai/tag-completion'

describe('PixAI tag completion boundaries', () => {
  it('matches two or more characters and accepts spaces / underscores', () => {
    expect(tagToken('l', 1)).toBeNull()
    expect(tagToken('  long_h', 8)).toEqual({ start: 2, end: 8, query: 'long_h' })
    expect(tagToken('quality, long h', 15)?.query).toBe('long h')
    expect(tagToken('x'.repeat(201), 201)).toBeNull()
  })

  it('replaces the entire tag at a mid-word caret without changing neighbouring tags', () => {
    const text = 'quality, long haor, night'
    const token = tagToken(text, 13)!
    expect(token.query).toBe('long')
    expect(completeTag(text, token, 'long hair')).toEqual({
      value: 'quality, long hair, night',
      cursor: 18
    })
  })

  it.each([
    ['(long haor:1.2), night', 5, '(long hair:1.2), night'],
    ['((long haor:1.2):1.1), night', 6, '((long hair:1.2):1.1), night'],
    ['{long haor}, night', 5, '{long hair}, night'],
    ['[long haor], night', 5, '[long hair], night'],
    ['quality\r\n  long haor \r\nnight', 15, 'quality\r\n  long hair \r\nnight']
  ])('preserves weights, wrappers and line breaks: %s', (text, cursor, expected) => {
    expect(completeTag(text, tagToken(text, cursor)!, 'long hair').value).toBe(expected)
  })

  it('keeps parentheses in character tags and adds a comma only at the end', () => {
    const text = 'hatsune miku (vocaloid)'
    expect(completeTag(text, tagToken(text, 8)!, text).value).toBe(text + ', ')
    expect(completeTag('long, ', tagToken('long, ', 4)!, 'long hair').value).toBe('long hair, ')
  })

  it.each([
    ['(blue hair, red ey:1.2), city', '(blue hair, red eyes:1.2), city'],
    ['((blue hair, red ey:1.2):1.1), city', '((blue hair, red eyes:1.2):1.1), city'],
    ['(blue hair, (red ey:1.1):1.2), city', '(blue hair, (red eyes:1.1):1.2), city'],
    ['(blue hair, (red ey:1.1) :1.2), city', '(blue hair, (red eyes:1.1) :1.2), city'],
    ['((red ey:1.1) :1.2), city', '((red eyes:1.1) :1.2), city'],
    ['{blue hair, red ey}, city', '{blue hair, red eyes}, city'],
    ['[blue hair, red ey], city', '[blue hair, red eyes], city']
  ])('preserves wrappers and weights spanning several tags: %s', (text, expected) => {
    const cursor = text.indexOf('red ey') + 'red ey'.length
    expect(completeTag(text, tagToken(text, cursor)!, 'red eyes').value).toBe(expected)
  })

  it('does not complete selected text, weights or special syntax', () => {
    expect(tagToken('long hair', 4, 9)).toBeNull()
    expect(tagToken('(long hair:1.2)', 13)).toBeNull()
    expect(tagToken('<fragment', 9)).toBeNull()
    expect(tagToken('# note', 6)).toBeNull()
    expect(tagToken('smile', 6)).toBeNull()
  })
})

describe('completion menu placement', () => {
  it('fits a narrow viewport and flips above a caret near the bottom', () => {
    const result = tagPopupPosition(
      { left: 300, top: 600, height: 24 },
      { width: 320, height: 640 },
      8
    )
    expect(result.left).toBe(8)
    expect(result.width).toBe(304)
    expect(result.top).toBeGreaterThanOrEqual(8)
    expect(result.top + result.maxHeight).toBeLessThan(600)
  })
  it('constrains height when neither side has enough space', () => {
    const result = tagPopupPosition(
      { left: 20, top: 100, height: 24 },
      { width: 400, height: 210 },
      8
    )
    expect(result.top).toBeGreaterThanOrEqual(8)
    expect(result.top + result.maxHeight).toBeLessThanOrEqual(202)
  })
})
