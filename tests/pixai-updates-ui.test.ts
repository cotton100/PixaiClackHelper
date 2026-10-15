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
  invoke = vi.fn(
    async (channel: string, req: { version?: string; channel?: 'stable' | 'beta' }) => {
      if (channel === 'pixai:update-channel')
        status = { ...status, channel: req.channel, phase: 'idle', selectedVersion: '' }
      if (channel === 'pixai:update-download')
        status = { ...status, phase: 'ready', selectedVersion: req.version!, percent: 100 }
      if (channel === 'pixai:update-install') status = { ...status, phase: 'installing' }
      return structuredClone(status)
    }
  )
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
  await act(async () => button('개발판 (Beta)').click())
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

it('disables updating on the latest version but allows checking again and enabling a new release', async () => {
  status.currentVersion = '0.1.3'
  await act(async () => button('업데이트 확인').click())
  expect(button('최신 버전으로 업데이트').disabled).toBe(true)
  expect(button('업데이트 확인').disabled).toBe(false)
  expect(button('업데이트 확인').closest('details')).toBeNull()
  expect(container.textContent).toContain('현재 버전보다 새로운 정식 버전이 없습니다')
  invoke.mockClear()
  await act(async () => button('최신 버전으로 업데이트').click())
  expect(invoke).not.toHaveBeenCalled()
  status.releases.unshift({ ...status.releases[1], version: '0.1.4', tag: 'v0.1.4' })
  await act(async () => button('업데이트 확인').click())
  expect(button('최신 버전으로 업데이트').disabled).toBe(false)
  expect(invoke).toHaveBeenCalledWith('pixai:update-check', {})
  expect(invoke.mock.calls.some(([channel]) => channel === 'pixai:update-latest')).toBe(false)
  await act(async () => button('최신 버전으로 업데이트').click())
  expect(invoke).toHaveBeenCalledWith('pixai:update-latest', {})
})

it('keeps installation disabled before checking, after a failed check and with an empty list', async () => {
  const releases = status.releases
  status = { ...status, releases: [] }
  await act(async () => {
    root.unmount()
    root = createRoot(container)
    root.render(createElement(AppUpdates))
  })
  expect(button('최신 버전으로 업데이트').disabled).toBe(true)
  expect(button('업데이트 확인').disabled).toBe(false)
  expect(container.textContent).not.toContain('새로운 정식 버전이 없습니다')
  await act(async () => button('업데이트 확인').click())
  expect(button('최신 버전으로 업데이트').disabled).toBe(true)
  status = { ...status, releases, phase: 'error', message: '조회 실패' }
  await act(async () => button('업데이트 확인').click())
  expect(button('최신 버전으로 업데이트').disabled).toBe(true)
  expect(button('업데이트 확인').disabled).toBe(false)
  status = { ...status, phase: 'idle', message: '' }
  await act(async () => button('업데이트 확인').click())
  expect(button('최신 버전으로 업데이트').disabled).toBe(false)
})

it('does not offer prereleases or releases without installers through the latest update button', async () => {
  status = {
    ...status,
    currentVersion: '0.1.3',
    releases: [{ ...status.releases[0], version: '0.1.4-beta.1', tag: 'v0.1.4-beta.1' }]
  }
  await act(async () => button('업데이트 확인').click())
  expect(button('최신 버전으로 업데이트').disabled).toBe(true)
  status.releases.push({
    ...status.releases[0],
    version: '0.1.4',
    tag: 'v0.1.4',
    prerelease: false,
    available: false
  })
  await act(async () => button('업데이트 확인').click())
  expect(button('최신 버전으로 업데이트').disabled).toBe(true)
  expect(container.textContent).toContain('앱 내 설치 파일이 아직 제공되지 않았습니다')
  expect(container.textContent).not.toContain('새로운 정식 버전이 없습니다')
})

it('allows checking after the initial status request fails', async () => {
  invoke.mockRejectedValueOnce(new Error('status unavailable'))
  await act(async () => {
    root.unmount()
    root = createRoot(container)
    root.render(createElement(AppUpdates))
  })
  expect(container.textContent).toContain('업데이트 상태를 읽지 못했습니다')
  expect(button('최신 버전으로 업데이트').disabled).toBe(true)
  expect(button('업데이트 확인').disabled).toBe(false)
  await act(async () => button('업데이트 확인').click())
  expect(invoke).toHaveBeenCalledWith('pixai:update-check', {})
  expect(button('최신 버전으로 업데이트').disabled).toBe(false)
  expect(container.textContent).not.toContain('업데이트 상태를 읽지 못했습니다')
})

it('only saves the receiving channel until the explicit transition button is clicked', async () => {
  await act(async () => button('개발판 (Beta)').click())
  expect(invoke).toHaveBeenCalledWith('pixai:update-channel', { channel: 'beta' })
  expect(container.textContent).toContain('수신 채널을 골라도 설치는 시작되지 않습니다')
  expect(container.textContent).toContain('프리셋·청크·설정을 이어서 사용합니다')
  expect(
    invoke.mock.calls.some(([name]) =>
      ['pixai:update-latest', 'pixai:update-download', 'pixai:update-install'].includes(name)
    )
  ).toBe(false)
  expect(button('개발판 0.1.3-beta.1로 전환').disabled).toBe(false)
  invoke.mockClear()
  await act(async () => button('개발판 0.1.3-beta.1로 전환').click())
  expect(invoke).toHaveBeenCalledWith('pixai:update-latest', {})
  expect(invoke.mock.calls.some(([name]) => name === 'pixai:update-open-separate')).toBe(false)
})
it('updates the installed beta channel and retains a different receiving channel after remounting', async () => {
  status = { ...status, currentVersion: '0.1.3-beta.0', installedChannel: 'beta', channel: 'beta' }
  await act(async () => button('업데이트 확인').click())
  expect(container.textContent).toContain('현재 개발판 0.1.3-beta.0')
  expect(button('최신 버전으로 업데이트').disabled).toBe(false)
  await act(async () => button('최신 버전으로 업데이트').click())
  expect(invoke).toHaveBeenCalledWith('pixai:update-latest', {})
  await act(async () => button('정식판').click())
  expect(button('정식판 0.1.3로 전환').disabled).toBe(false)
  await act(async () => {
    root.unmount()
    root = createRoot(container)
    root.render(createElement(AppUpdates))
  })
  expect(button('정식판').getAttribute('aria-pressed')).toBe('true')
  expect(button('개발판 (Beta)').getAttribute('aria-pressed')).toBe('false')
  expect(container.textContent).toContain('현재 개발판 0.1.3-beta.0')
  expect(button('정식판 0.1.3로 전환').disabled).toBe(false)
})

it('offers an older release when switching channels and identifies the target and data safeguard', async () => {
  status = { ...status, currentVersion: '0.1.4-beta.1', installedChannel: 'beta', channel: 'beta' }
  await act(async () => button('업데이트 확인').click())
  expect(button('최신 버전으로 업데이트').disabled).toBe(true)
  invoke.mockClear()
  await act(async () => button('정식판').click())
  expect(button('정식판 0.1.3로 전환').disabled).toBe(false)
  expect(container.textContent).toContain('현재보다 낮은 정식판 0.1.3로 돌아갑니다')
  expect(container.textContent).toContain('현재 자료를 읽을 수 있는 버전만 설치할 수 있으며')
  expect(container.textContent).toContain('설치 전에 현재 작업 공간을 백업합니다')
  expect(invoke.mock.calls.some(([name]) => name === 'pixai:update-latest')).toBe(false)
  await act(async () => button('정식판 0.1.3로 전환').click())
  expect(invoke).toHaveBeenCalledWith('pixai:update-latest', {})
})

it('downloads a manually selected version from another channel through the same updater', async () => {
  status = { ...status, currentVersion: '0.1.4-beta.1', installedChannel: 'beta', channel: 'beta' }
  await act(async () => button('정식판').click())
  await act(async () => button('0.1.1').click())
  expect(container.textContent).toContain('이전 버전으로 돌아갑니다')
  await act(async () => button('정식판 0.1.1 받기').click())
  expect(invoke).toHaveBeenCalledWith('pixai:update-download', { version: '0.1.1' })
  expect(button('백업 후 설치·재시작').disabled).toBe(true)
  expect(invoke.mock.calls.some(([name]) => name === 'pixai:update-install')).toBe(false)
})

it('shows legacy separate releases for reference but prevents downloading or transitioning to them', async () => {
  status.releases = [{ ...status.releases[0], legacySeparate: true, available: false }]
  await act(async () => button('개발판 (Beta)').click())
  expect(container.textContent).toContain('이전 별도 앱 · 전환 불가')
  expect(container.textContent).toContain(
    '아직 같은 앱에서 전환할 수 있는 개발판이 게시되지 않았습니다'
  )
  expect(button('개발판으로 전환').disabled).toBe(true)
  await act(async () => button('0.1.3-beta.1').click())
  expect(button('개발판 0.1.3-beta.1 받기').disabled).toBe(true)
  invoke.mockClear()
  await act(async () => {
    button('개발판으로 전환').click()
    button('개발판 0.1.3-beta.1 받기').click()
  })
  expect(invoke).not.toHaveBeenCalled()
})

it('selects the newest available transition target and skips legacy separate releases', async () => {
  status.releases.push(
    { ...status.releases[0], version: '0.1.5-beta.1', tag: 'v0.1.5-beta.1', available: false },
    {
      ...status.releases[0],
      version: '0.1.6-beta.1',
      tag: 'v0.1.6-beta.1',
      legacySeparate: true,
      available: false
    },
    { ...status.releases[0], version: '0.1.4-beta.1', tag: 'v0.1.4-beta.1' }
  )
  await act(async () => button('개발판 (Beta)').click())
  expect(button('개발판 0.1.4-beta.1로 전환').disabled).toBe(false)
})
