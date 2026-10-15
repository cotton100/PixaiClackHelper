/** Bound duplicated data before allocating jobs, snapshots or a Cartesian product. */
export const MAX_EXPANSION_BYTES = 8 * 1024 * 1024
export const MAX_WORKSPACE_BYTES = 20 * 1024 * 1024

export function jsonBytes(value: unknown, limit = MAX_WORKSPACE_BYTES): number {
  let bytes = 0
  const add = (n: number): void => {
    bytes += n
    if (bytes > limit) throw new Error('자료 용량이 너무 큽니다. 문구나 예약 수를 줄여 주세요.')
  }
  const visit = (item: unknown): void => {
    if (typeof item === 'string') {
      // Check before JSON escaping / UTF-8 allocation as well.
      if (item.length > limit) add(item.length)
      add(new TextEncoder().encode(JSON.stringify(item)).byteLength)
    } else if (Array.isArray(item)) {
      add(2 + item.length)
      for (const child of item) visit(child)
    } else if (item && typeof item === 'object') {
      add(2)
      for (const [key, child] of Object.entries(item)) {
        if (child === undefined) continue
        visit(key)
        add(2)
        visit(child)
      }
    } else add(24) // Conservative numeric / boolean / null overhead.
  }
  visit(value)
  return bytes
}

export function expansionBudget(): (material: unknown, count: number) => void {
  let used = 0
  return (material, count) => {
    // Each generated job contains the frozen reservation, composition, joined
    // prompts and configuration. Four copies plus overhead bounds those fields.
    used += (jsonBytes(material, MAX_EXPANSION_BYTES) * 4 + 1024) * count
    if (used > MAX_EXPANSION_BYTES)
      throw new Error('예약을 펼친 자료가 너무 큽니다. 문구 길이나 반복 수를 줄여 주세요.')
  }
}
