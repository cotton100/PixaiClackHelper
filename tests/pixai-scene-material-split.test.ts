// @vitest-environment happy-dom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SceneMaterialSplit } from '../src/renderer/src/pixai/scene-material-split'

const storageKey = 'pixais.scene-material-split.v1'
let root: Root, container: HTMLDivElement
let notifyResize: (height: number) => void

async function render(): Promise<void> {
  await act(async () =>
    root.render(
      h(SceneMaterialSplit, {
        children: [
          h('section', { key: 'character' }, '캐릭터'),
          h('section', { key: 'extra' }, '추가 청크')
        ]
      })
    )
  )
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        notifyResize = (height) =>
          callback(
            [{ contentRect: { height } } as ResizeObserverEntry],
            this as unknown as ResizeObserver
          )
      }
      observe = vi.fn()
      disconnect = vi.fn()
    }
  )
  localStorage.clear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

function divider(): HTMLDivElement {
  return container.querySelector<HTMLDivElement>('[role="separator"]')!
}

function ratio(): number {
  return Number(divider().getAttribute('aria-valuenow'))
}

async function key(value: string): Promise<void> {
  await act(async () =>
    divider().dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }))
  )
}

async function pointer(type: string, y: number, pointerId = 1): Promise<void> {
  await act(async () =>
    divider().dispatchEvent(
      new PointerEvent(type, { clientY: y, pointerId, button: 0, bubbles: true })
    )
  )
}

function measure(height = 1008): void {
  const frame = container.querySelector<HTMLDivElement>('.px-scene-material-split')!
  vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue({ height } as DOMRect)
  divider().setPointerCapture = vi.fn()
}

describe('scene character / extra chunk height split', () => {
  it('defaults to half, saves keyboard changes, restores on remount and resets with Home', async () => {
    await render()
    expect(ratio()).toBe(50)
    await key('ArrowDown')
    expect(ratio()).toBe(52)
    expect(localStorage.getItem(storageKey)).toBe('52')
    await act(async () => root.unmount())
    root = createRoot(container)
    await render()
    expect(ratio()).toBe(52)
    await key('ArrowUp')
    expect(ratio()).toBe(50)
    await key('ArrowUp')
    await key('Home')
    expect(ratio()).toBe(50)
    expect(localStorage.getItem(storageKey)).toBe('50')
  })

  it('drags proportionally, clamps at 25 / 75 and saves only on release, including a quick final move', async () => {
    await render()
    measure()
    await pointer('pointerdown', 200)
    expect(divider().setPointerCapture).toHaveBeenCalledWith(1)
    await pointer('pointermove', 300)
    expect(ratio()).toBe(60)
    expect(localStorage.getItem(storageKey)).toBeNull()
    await pointer('pointermove', 800)
    expect(ratio()).toBe(75)
    await pointer('pointerup', 800)
    expect(localStorage.getItem(storageKey)).toBe('75')
    await pointer('pointerdown', 300)
    await pointer('pointerup', -200)
    expect(ratio()).toBe(25)
    expect(localStorage.getItem(storageKey)).toBe('25')
    await key('ArrowUp')
    expect(ratio()).toBe(25)
  })

  it('ignores other pointers and rolls back cancelled drags without changing the saved height', async () => {
    localStorage.setItem(storageKey, '60')
    await render()
    measure()
    await pointer('pointerdown', 200)
    await pointer('pointermove', 400, 2)
    expect(ratio()).toBe(60)
    await pointer('pointermove', 300)
    expect(ratio()).toBe(70)
    await pointer('pointercancel', 300)
    expect(ratio()).toBe(60)
    expect(localStorage.getItem(storageKey)).toBe('60')
    await pointer('pointerdown', 200)
    await pointer('pointermove', 300)
    await pointer('lostpointercapture', 300)
    expect(ratio()).toBe(60)
    await pointer('pointerdown', 200)
    await pointer('pointermove', 300)
    await pointer('pointerup', 200)
    expect(ratio()).toBe(60)
    expect(localStorage.getItem(storageKey)).toBe('60')
  })

  it('keeps 220px per pane in a short window and starts dragging from the displayed ratio', async () => {
    localStorage.setItem(storageKey, '25')
    await render()
    measure(608)
    await act(async () => notifyResize(608))
    expect(ratio()).toBe(37)
    expect(divider().getAttribute('aria-valuemin')).toBe('37')
    await key('ArrowUp')
    expect(localStorage.getItem(storageKey)).toBe('25')
    await pointer('pointerdown', 200)
    await pointer('pointerup', 260)
    expect(ratio()).toBe(47)
    expect(Number(localStorage.getItem(storageKey))).toBeCloseTo((220 / 600) * 100 + 10)
    await pointer('pointerdown', 200)
    await pointer('pointerup', -800)
    expect(ratio()).toBe(37)
  })

  it('clamps only the display on resize and restores the saved preference when space returns', async () => {
    localStorage.setItem(storageKey, '75')
    await render()
    await act(async () => notifyResize(608))
    expect(ratio()).toBe(63)
    expect(localStorage.getItem(storageKey)).toBe('75')
    await act(async () => notifyResize(408))
    expect(ratio()).toBe(50)
    expect(localStorage.getItem(storageKey)).toBe('75')
    await act(async () => notifyResize(1008))
    expect(ratio()).toBe(75)
    expect(localStorage.getItem(storageKey)).toBe('75')
  })

  it.each(['', 'undefined', 'NaN', 'Infinity', '0', '24', '76'])(
    'ignores invalid stored height %s',
    async (value) => {
      localStorage.setItem(storageKey, value)
      await render()
      expect(ratio()).toBe(50)
    }
  )

  it('keeps the current layout usable when preference storage fails', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('Unavailable')
      },
      setItem: () => {
        throw new Error('Unavailable')
      }
    })
    await render()
    expect(ratio()).toBe(50)
    await key('ArrowDown')
    expect(ratio()).toBe(52)
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      '현재 배치는 유지됩니다'
    )
  })
})
