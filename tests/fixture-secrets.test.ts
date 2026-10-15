import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('captured cache references use only deterministic synthetic fixture values', () => {
  for (const [index, name] of ['charref', 'i2i', 'vibe'].entries()) {
    const data: unknown = JSON.parse(
      readFileSync(new URL(`./fixtures/nai-web-${name}.json`, import.meta.url), 'utf8')
    )
    const values: unknown[] = []
    const walk = (value: unknown): void => {
      if (!value || typeof value !== 'object') return
      for (const [key, item] of Object.entries(value)) {
        if (key === 'cache_secret_key' || key === 'image_cache_secret_key') values.push(item)
        else walk(item)
      }
    }
    walk(data)
    expect(values.length).toBeGreaterThan(0)
    // A boolean assertion avoids printing a future captured value on failure.
    expect(values.every((value) => value === String(index + 1).repeat(64))).toBe(true)
  }
})
