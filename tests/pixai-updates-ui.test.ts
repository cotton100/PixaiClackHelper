// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AppUpdates } from '../src/renderer/src/pixai/updates'
import type { UpdateStatus } from '../src/shared/pixai/updates'
let root: Root, container: HTMLDivElement, status: UpdateStatus, invoke: ReturnType<typeof vi.fn>
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  status = {
    currentVersion: '0.1.2',
    supported: true,
    phase: 'idle',
    selectedVersion: '',
    percent: 0,
    message: '',
    backupPath: '',
    releases: ['0.1.3-beta.1', '0.1.3', '0.1.1'].map((version) => ({
      version,
      tag: `v${version}`,
      date: '2026-10-11',
      notes: 'fixture notes',
      available: true,
      prerelease: version.includes('-')
    }))
  }
  invoke = vi.fn(async (channel: string, req: { version?: string }) => {
    if (channel === 'pixai:update-download')
      status = { ...status, phase: 'ready', selectedVersion: req.version!, percent: 100 }
    if (channel === 'pixai:update-install') status = { ...status, phase: 'installing' }
    return structuredClone(status)
  })
  vi.stubGlobal('nais', { runtime: 'electron', invoke })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(createElement(AppUpdates)))
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
const button = (text: string): HTMLButtonElement =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.startsWith(text))!
it('hides prereleases by default and shows explicit downgrade information', async () => {
  expect(container.textContent).not.toContain('0.1.3-beta.1')
  await act(async () => button('0.1.1').click())
  expect(container.textContent).toContain('이전 버전으로 돌아갑니다')
  await act(async () => container.querySelector<HTMLInputElement>('input[type=checkbox]')!.click())
  expect(container.textContent).toContain('0.1.3-beta.1')
})
it('offers one-click update without a separate selection or checkbox', async () => {
  await act(async () => button('최신 버전으로 업데이트').click())
  expect(invoke).toHaveBeenCalledWith('pixai:update-latest', {})
  expect(invoke.mock.calls.some(([channel]) => channel === 'pixai:update-install')).toBe(false)
})
it('requires download then separate confirmation before requesting installation', async () => {
  await act(async () => button('0.1.3').click())
  await act(async () => button('선택한 버전 받기').click())
  expect(button('백업 후 설치·재시작').disabled).toBe(true)
  expect(invoke.mock.calls.some(([channel]) => channel === 'pixai:update-install')).toBe(false)
  await act(async () =>
    container.querySelector<HTMLInputElement>('[aria-label="버전 변경 설치 확인"]')!.click()
  )
  await act(async () => button('백업 후 설치·재시작').click())
  expect(invoke).toHaveBeenCalledWith('pixai:update-install', { confirmed: true })
})
it('disables installation after choosing a different version from the downloaded one', async () => {
  await act(async () => button('0.1.3').click())
  await act(async () => button('선택한 버전 받기').click())
  await act(async () =>
    container.querySelector<HTMLInputElement>('[aria-label="버전 변경 설치 확인"]')!.click()
  )
  await act(async () => button('0.1.1').click())
  expect(button('백업 후 설치·재시작').disabled).toBe(true)
})
