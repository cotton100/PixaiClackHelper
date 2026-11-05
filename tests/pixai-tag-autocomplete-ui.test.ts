// @vitest-environment happy-dom
import { act, createElement as h, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TagTextarea } from '../src/renderer/src/pixai/tag-textarea'
import { PromptFields } from '../src/renderer/src/pixai/controls'

vi.mock('../src/renderer/src/lib/caret', () => ({
  caretCoords: () => ({ left: 20, top: 10, height: 24 })
}))

const items = [
  { tag: 'blue hair', count: 1200, type: 'general' },
  { tag: 'blue eyes', count: 900, type: 'general' },
  { tag: 'blue archive', count: 700, type: 'copyright' }
]
let root: Root
let container: HTMLDivElement
let mounted: boolean
let invoke: ReturnType<typeof vi.fn>
let replaceValue: (value: string) => void

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  invoke = vi.fn(async () => ({ items }))
  vi.stubGlobal('nais', { invoke })
  container = document.createElement('div')
  container.className = 'px-app'
  document.body.append(container)
  root = createRoot(container)
  mounted = true
})

afterEach(async () => {
  if (mounted) await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function render(initial = ''): Promise<HTMLTextAreaElement> {
  function Harness(): React.JSX.Element {
    const [value, setValue] = useState(initial)
    replaceValue = setValue
    return h(TagTextarea, { value, onValueChange: setValue, 'aria-label': 'prompt' })
  }
  await act(async () => root.render(h(Harness)))
  const input = container.querySelector('textarea')!
  await act(async () => input.focus())
  return input
}

async function type(
  input: HTMLTextAreaElement,
  value: string,
  caret = value.length
): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value)
    input.setSelectionRange(caret, caret)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function tick(): Promise<void> {
  await act(async () => vi.advanceTimersByTimeAsync(150))
}

async function key(
  input: HTMLTextAreaElement,
  name: string,
  options: KeyboardEventInit = {}
): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', {
    key: name,
    bubbles: true,
    cancelable: true,
    ...options
  })
  await act(async () => input.dispatchEvent(event))
  return event
}

const options = (): HTMLButtonElement[] => [...document.querySelectorAll('[role="option"]')]

function deferred(): {
  promise: Promise<{ items: typeof items }>
  resolve: (result: { items: typeof items }) => void
} {
  let resolve!: (result: { items: typeof items }) => void
  const promise = new Promise<{ items: typeof items }>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('PixAI prompt tag autocomplete', () => {
  it('searches the local tag channel after two characters and only after the debounce', async () => {
    const input = await render()
    await type(input, 'b')
    await tick()
    expect(invoke).not.toHaveBeenCalled()
    await type(input, 'bl')
    expect(invoke).not.toHaveBeenCalled()
    await type(input, 'blu')
    await tick()
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('tags:search', { query: 'blu', limit: 8 })
    expect(options()).toHaveLength(3)
    expect(input.getAttribute('aria-controls')).toBe(document.querySelector('[role="listbox"]')?.id)
  })

  it('moves through candidates with arrows and inserts the selected tag on Enter', async () => {
    const input = await render()
    await type(input, 'blu')
    await tick()
    expect((await key(input, 'ArrowDown')).defaultPrevented).toBe(true)
    const selectedId = input.getAttribute('aria-activedescendant')!
    expect(document.getElementById(selectedId)?.textContent).toContain('blue eyes')
    expect((await key(input, 'Enter')).defaultPrevented).toBe(true)
    await tick()
    expect(input.value).toBe('blue eyes, ')
    expect(options()).toHaveLength(0)
    expect(input.selectionStart).toBe(input.value.length)
  })

  it('uses Tab for completion but leaves Shift+Tab and Shift+Enter available', async () => {
    const input = await render()
    await type(input, 'blu')
    await tick()
    expect((await key(input, 'Tab')).defaultPrevented).toBe(true)
    expect(input.value).toBe('blue hair, ')
    await type(input, 'blu')
    await tick()
    expect((await key(input, 'Tab', { shiftKey: true })).defaultPrevented).toBe(false)
    expect(input.value).toBe('blu')
    await type(input, 'blue')
    await tick()
    expect((await key(input, 'Enter', { shiftKey: true })).defaultPrevented).toBe(false)
    expect(input.value).toBe('blue')
  })

  it('accepts a clicked candidate while keeping the textarea focused', async () => {
    const input = await render()
    await type(input, 'blu')
    await tick()
    const candidate = options()[1]
    await act(async () => {
      candidate.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      candidate.click()
    })
    await tick()
    expect(input.value).toBe('blue eyes, ')
    expect(document.activeElement).toBe(input)
    expect(options()).toHaveLength(0)
  })

  it('replaces the whole tag when the caret is in its middle, keeping adjacent tags intact', async () => {
    const input = await render()
    await type(input, 'portrait, blu eyes, city', 'portrait, blu'.length)
    await tick()
    await key(input, 'Enter')
    expect(input.value).toBe('portrait, blue hair, city')
  })

  it('preserves the existing weight and parentheses around a completed tag', async () => {
    const input = await render()
    await type(input, 'portrait, (blu:1.2), city', 'portrait, (blu'.length)
    await tick()
    await key(input, 'Enter')
    expect(input.value).toBe('portrait, (blue hair:1.2), city')
  })

  it('does not reopen after Escape when a pending search completes', async () => {
    const search = deferred()
    invoke.mockReturnValue(search.promise)
    const input = await render()
    await type(input, 'blu')
    await tick()
    await key(input, 'Escape')
    await act(async () => search.resolve({ items }))
    expect(options()).toHaveLength(0)
    expect((await key(input, 'Enter')).defaultPrevented).toBe(false)
    expect(input.value).toBe('blu')
  })

  it('does not reopen after the input loses focus', async () => {
    const search = deferred()
    invoke.mockReturnValue(search.promise)
    const input = await render()
    await type(input, 'blu')
    await tick()
    await act(async () => input.blur())
    await act(async () => search.resolve({ items }))
    expect(options()).toHaveLength(0)
  })

  it('ignores older search results after the input changes', async () => {
    const oldSearch = deferred()
    const newSearch = deferred()
    invoke.mockReturnValueOnce(oldSearch.promise).mockReturnValueOnce(newSearch.promise)
    const input = await render()
    await type(input, 'blu')
    await tick()
    await type(input, 'red')
    await tick()
    await act(async () => newSearch.resolve({ items: [{ ...items[0], tag: 'red hair' }] }))
    expect(options()[0].textContent).toContain('red hair')
    await act(async () => oldSearch.resolve({ items }))
    expect(options()).toHaveLength(1)
    expect(options()[0].textContent).toContain('red hair')
    await key(input, 'Enter')
    expect(input.value).toBe('red hair, ')
  })

  it('invalidates suggestions when another editor item replaces the controlled value', async () => {
    const search = deferred()
    invoke.mockReturnValue(search.promise)
    const input = await render()
    await type(input, 'blu')
    await tick()
    await act(async () => replaceValue('saved character'))
    await act(async () => search.resolve({ items }))
    expect(input.value).toBe('saved character')
    expect(options()).toHaveLength(0)
    expect((await key(input, 'Enter')).defaultPrevented).toBe(false)
  })

  it('keeps ordinary editing working when tag lookup fails', async () => {
    invoke.mockRejectedValue(new Error('local tag file unavailable'))
    const input = await render()
    await type(input, 'blu')
    await tick()
    expect(options()).toHaveLength(0)
    expect((await key(input, 'Enter')).defaultPrevented).toBe(false)
    await type(input, 'free text')
    expect(input.value).toBe('free text')
  })

  it('does not render a portal after the editor unmounts with a search in flight', async () => {
    const search = deferred()
    invoke.mockReturnValue(search.promise)
    const input = await render()
    await type(input, 'blu')
    await tick()
    await act(async () => root.unmount())
    mounted = false
    await act(async () => search.resolve({ items }))
    expect(document.querySelector('[role="listbox"]')).toBeNull()
  })

  it('does not search or consume Enter while an IME composition is active', async () => {
    const input = await render()
    await act(async () =>
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    )
    await type(input, 'blue')
    await tick()
    expect(invoke).not.toHaveBeenCalled()
    expect((await key(input, 'Enter')).defaultPrevented).toBe(false)
    expect(input.value).toBe('blue')
    await act(async () =>
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    )
    await tick()
    expect(invoke).toHaveBeenCalledWith('tags:search', { query: 'blue', limit: 8 })
  })

  it('does not accept a candidate for a native composing Enter event', async () => {
    const input = await render()
    await type(input, 'blu')
    await tick()
    expect((await key(input, 'Enter', { isComposing: true })).defaultPrevented).toBe(false)
    expect(input.value).toBe('blu')
  })

  it('connects both positive and negative PromptFields without changing the other value', async () => {
    function Harness(): React.JSX.Element {
      const [value, setValue] = useState({ prompt: 'quality', negativePrompt: '' })
      return h(PromptFields, {
        ...value,
        labels: { prompt: 'positive', negativePrompt: 'negative' },
        onChange: setValue
      })
    }
    await act(async () => root.render(h(Harness)))
    const positive = container.querySelector<HTMLTextAreaElement>('[aria-label="positive"]')!
    const negative = container.querySelector<HTMLTextAreaElement>('[aria-label="negative"]')!
    await act(async () => negative.focus())
    await type(negative, 'blu')
    await tick()
    await key(negative, 'Tab')
    expect(negative.value).toBe('blue hair, ')
    expect(positive.value).toBe('quality')
    await act(async () => positive.focus())
    await type(positive, 'quality, blu')
    await tick()
    await key(positive, 'Enter')
    expect(positive.value).toBe('quality, blue hair, ')
    expect(negative.value).toBe('blue hair, ')
  })
})
