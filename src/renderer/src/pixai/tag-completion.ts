/** A completion replaces only the tag at the caret, not the rest of the prompt. */
export interface TagToken {
  start: number
  end: number
  query: string
}

export function tagToken(text: string, cursor: number, selectionEnd = cursor): TagToken | null {
  if (cursor !== selectionEnd || cursor < 0 || cursor > text.length) return null
  let start = cursor
  while (start > 0 && !/[,\n\r]/.test(text[start - 1])) start--
  let end = cursor
  while (end < text.length && !/[,\n\r]/.test(text[end])) end++
  while (start < end && /\s/.test(text[start])) start++
  while (end > start && /\s/.test(text[end - 1])) end--

  // Preserve existing emphasis wrappers and SD-style numeric weights verbatim.
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
  while (pairs[text[start]]) {
    start++
    while (start < end && /\s/.test(text[start])) start++
  }
  // A weight can wrap a comma-separated group. Match its opening bracket even
  // when it belongs to an earlier tag, but keep parentheses inside tag names.
  const stack: { index: number; closer: string }[] = []
  const openingAt = new Map<number, number>()
  for (let i = 0; i < end; i++) {
    if (text[i] === '\\') {
      i++
      continue
    }
    if (pairs[text[i]]) stack.push({ index: i, closer: pairs[text[i]] })
    else if (stack.at(-1)?.closer === text[i]) openingAt.set(i, stack.pop()!.index)
  }
  while (openingAt.has(end - 1) && openingAt.get(end - 1)! < start) {
    end--
    while (end > start && /\s/.test(text[end - 1])) end--
    const weight = /:\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*$/.exec(text.slice(start, end))
    if (weight) end = start + weight.index
    while (end > start && /\s/.test(text[end - 1])) end--
  }
  while (end > start && /\s/.test(text[end - 1])) end--
  if (cursor < start || cursor > end) return null
  const query = text.slice(start, cursor).trim()
  if (query.length < 2 || query.length > 200 || /[<>|:#{}[\]]/.test(query)) return null
  return { start, end, query }
}

export function completeTag(
  text: string,
  token: TagToken,
  tag: string
): { value: string; cursor: number } {
  const insert = tag + (token.end === text.length ? ', ' : '')
  return {
    value: text.slice(0, token.start) + insert + text.slice(token.end),
    cursor: token.start + insert.length
  }
}

export function tagPopupPosition(
  caret: { left: number; top: number; height: number },
  viewport: { width: number; height: number },
  count: number
): { left: number; top: number; width: number; maxHeight: number } {
  const width = Math.max(0, Math.min(360, viewport.width - 16))
  const height = Math.min(count, 8) * 38 + 38
  const below = Math.max(0, viewport.height - caret.top - caret.height - 12)
  const above = Math.max(0, caret.top - 12)
  const upward = below < height && above > below
  const maxHeight = Math.min(height, upward ? above : below)
  return {
    left: Math.max(8, Math.min(caret.left, viewport.width - width - 8)),
    top: upward ? Math.max(8, caret.top - maxHeight - 4) : caret.top + caret.height + 4,
    width,
    maxHeight
  }
}
