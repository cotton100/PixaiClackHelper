/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { describe, expect, it, vi } from 'vitest'
import { PixaisUpdates, parseReleases, canInstallUpdate } from '../src/main/pixai/updates'
import type { ExecutionJob } from '../src/shared/pixai/execution'
import {
  DATA_EPOCH,
  DATABASE_VERSION,
  assertCompatible,
  compareVersions,
  parseManifest,
  releaseBase
} from '../src/shared/pixai/updates'
import { migrations } from '../src/main/db/migrations'

const manifest = (version = '0.1.3') => ({
  format: 1,
  version,
  dataEpoch: DATA_EPOCH,
  databaseVersion: 18,
  file: `PixaiClackHelper-${version}-setup.exe`,
  size: 100,
  sha512: 'A'.repeat(86) + '=='
})
const release = (version = '0.1.3') => ({
  tag_name: `v${version}`,
  published_at: '2026-10-11',
  body: 'notes',
  assets: ['latest.yml', 'pixais-update.json', `PixaiClackHelper-${version}-setup.exe`].map(
    (name) => ({
      name
    })
  )
})
function fixture() {
  const engine = {
    download: vi.fn(async () => {}),
    verify: vi.fn(async () => {}),
    install: vi.fn()
  }
  const io = {
    version: '0.1.2',
    supported: true,
    json: vi.fn(async (url: string): Promise<unknown> =>
      url.includes('api.github.com')
        ? [release(), release('0.1.1')]
        : manifest(url.includes('0.1.1') ? '0.1.1' : '0.1.3')
    ),
    engine: vi.fn(() => engine),
    canInstall: vi.fn(() => true),
    databaseVersion: () => 18,
    backup: vi.fn(() => 'test-backup.db')
  }
  return { io, engine, updates: new PixaisUpdates(io) }
}
describe('PixAIS release and compatibility contract', () => {
  it('tracks the actual database migration version and explicit data epoch', () => {
    expect(DATABASE_VERSION).toBe(migrations.length)
    expect(DATA_EPOCH).toBe(4)
  })
  it('sorts versions numerically and prereleases before the matching stable version', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBe(1)
    expect(compareVersions('0.2.0-rc.2', '0.2.0')).toBe(-1)
    expect(compareVersions('0.2.0-alpha.2', '0.2.0-beta.1')).toBe(-1)
    expect(compareVersions('0.1.2', '0.1.2')).toBe(0)
  })
  it('omits drafts/bad tags and marks incomplete older releases unavailable', () => {
    const items = parseReleases([
      release('0.1.3-beta.1'),
      release('0.1.2'),
      { ...release(), draft: true },
      { ...release('0.1.1'), assets: [] },
      { tag_name: '../../evil' }
    ])
    expect(items.map((r) => r.version)).toEqual(['0.1.3-beta.1', '0.1.2', '0.1.1'])
    expect(items[0].prerelease).toBe(true)
    expect(items[2].available).toBe(false)
    expect(() => releaseBase('v../evil')).toThrow()
  })
  it.each([
    { file: '../bad.exe' },
    { sha512: 'wrong' },
    { size: 0 },
    { version: '0.1.4' },
    { databaseVersion: 0 }
  ])('rejects invalid manifest %o', (change) => {
    expect(() => parseManifest({ ...manifest(), ...change }, '0.1.3')).toThrow()
  })
  it('rejects older database readers and incompatible workspace formats', () => {
    const valid = parseManifest(manifest(), '0.1.3')
    expect(() => assertCompatible(valid, 18)).not.toThrow()
    expect(() => assertCompatible(valid, 19)).toThrow()
    expect(() => assertCompatible({ ...valid, dataEpoch: 1 }, 18)).toThrow()
    expect(() =>
      assertCompatible({ ...valid, dataEpoch: 2, minReadableDataEpoch: 1 }, 18)
    ).toThrow()
    expect(() =>
      assertCompatible({ ...valid, dataEpoch: DATA_EPOCH + 1, minReadableDataEpoch: 1 }, 18)
    ).not.toThrow()
    expect(() =>
      assertCompatible(
        { ...valid, dataEpoch: DATA_EPOCH + 1, minReadableDataEpoch: DATA_EPOCH + 1 },
        18
      )
    ).toThrow()
    expect(() => parseManifest({ ...manifest(), minReadableDataEpoch: 9 }, '0.1.3')).toThrow()
  })
})
describe('PixAIS explicit update flow', () => {
  it('updates to the latest stable release in one action, verifies and backs up before silent installation', async () => {
    const { updates, io, engine } = fixture()
    io.json.mockImplementation(async (url) =>
      url.includes('api.github.com')
        ? [release('0.1.4-beta.1'), release('0.1.3'), release('0.1.1')]
        : manifest('0.1.3')
    )
    expect((await updates.updateLatest()).phase).toBe('installing')
    expect(engine.download).toHaveBeenCalledWith(expect.objectContaining({ version: '0.1.3' }))
    expect(engine.install).toHaveBeenCalledWith(true)
    expect(io.backup.mock.invocationCallOrder[0]).toBeLessThan(
      engine.install.mock.invocationCallOrder[0]
    )
  })
  it('does not reinstall the current version, auto-downgrade, or fetch anything during generation', async () => {
    const { updates, io, engine } = fixture()
    io.canInstall.mockReturnValue(false)
    await expect(updates.updateLatest()).rejects.toThrow()
    expect(io.json).not.toHaveBeenCalled()
    io.canInstall.mockReturnValue(true)
    io.json.mockResolvedValue([release('0.1.2'), release('0.1.1')])
    expect((await updates.updateLatest()).phase).toBe('idle')
    expect(engine.download).not.toHaveBeenCalled()
    expect(engine.install).not.toHaveBeenCalled()
  })
  it('does not install when one-click download fails or generation begins during download', async () => {
    const { updates, io, engine } = fixture()
    engine.download.mockRejectedValueOnce(new Error('offline'))
    expect((await updates.updateLatest()).phase).toBe('error')
    expect(engine.install).not.toHaveBeenCalled()
    engine.download.mockImplementation(async () => {
      io.canInstall.mockReturnValue(false)
    })
    await expect(updates.updateLatest()).rejects.toThrow()
    expect(io.backup).not.toHaveBeenCalled()
    expect(engine.install).not.toHaveBeenCalled()
  })
  it('allows confirmed server failures with task IDs, but blocks unresolved and unsaved tasks', () => {
    const status = (state: ExecutionJob['state'], running = false) => ({
      running,
      stopping: false,
      error: '',
      jobs: [{ state, taskId: '123' } as ExecutionJob]
    })
    expect(canInstallUpdate(status('failed'))).toBe(true)
    expect(canInstallUpdate(status('done'))).toBe(true)
    expect(canInstallUpdate(status('done', true))).toBe(false)
    for (const state of [
      'queued',
      'submitting',
      'submission_unknown',
      'waiting',
      'saving',
      'save_failed',
      'check_required'
    ] as const)
      expect(canInstallUpdate(status(state))).toBe(false)
  })
  it('checks, downloads, verifies, backs up and installs only after confirmation', async () => {
    const { updates, io, engine } = fixture()
    await updates.check()
    expect(io.json.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/cotton100/PixaiClackHelper/releases?per_page=100'
    )
    expect(engine.download).not.toHaveBeenCalled()
    await updates.download('0.1.3')
    expect(updates.status().phase).toBe('ready')
    expect(engine.install).not.toHaveBeenCalled()
    await expect(updates.install(false)).rejects.toThrow()
    await updates.install(true)
    expect(engine.verify).toHaveBeenCalledOnce()
    expect(io.backup).toHaveBeenCalledOnce()
    expect(engine.install).toHaveBeenCalledOnce()
    expect(io.backup.mock.invocationCallOrder[0]).toBeLessThan(
      engine.install.mock.invocationCallOrder[0]
    )
    await expect(updates.install(true)).rejects.toThrow()
  })
  it('supports compatible explicit downgrade and refuses unknown selections', async () => {
    const { updates, engine } = fixture()
    await updates.check()
    await expect(updates.download('9.9.9')).rejects.toThrow()
    await updates.download('0.1.1')
    expect(engine.download).toHaveBeenCalledWith(expect.objectContaining({ version: '0.1.1' }))
    expect(updates.status().selectedVersion).toBe('0.1.1')
  })
  it('never starts a download when compatibility validation fails', async () => {
    const { updates, io, engine } = fixture()
    await updates.check()
    io.json.mockResolvedValue({ ...manifest(), dataEpoch: DATA_EPOCH + 1 })
    expect((await updates.download('0.1.3')).phase).toBe('error')
    expect(engine.download).not.toHaveBeenCalled()
    await expect(updates.install(true)).rejects.toThrow()
  })
  it('does not install during generation or after backup failure', async () => {
    const { updates, io, engine } = fixture()
    await updates.check()
    await updates.download('0.1.3')
    io.canInstall.mockReturnValue(false)
    await expect(updates.install(true)).rejects.toThrow()
    expect(io.backup).not.toHaveBeenCalled()
    io.canInstall.mockReturnValue(true)
    io.backup.mockImplementation(() => {
      throw new Error('disk full')
    })
    expect((await updates.install(true)).phase).toBe('error')
    expect(engine.install).not.toHaveBeenCalled()
  })
  it('rechecks generation after async file verification and locks duplicate operations', async () => {
    const { updates, io, engine } = fixture()
    await updates.check()
    await updates.download('0.1.3')
    let finish!: () => void
    engine.verify.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const pending = updates.install(true)
    expect(updates.status().phase).toBe('installing')
    await expect(updates.download('0.1.1')).rejects.toThrow()
    await expect(updates.check()).rejects.toThrow()
    io.canInstall.mockReturnValue(false)
    finish()
    await pending
    expect(io.backup).not.toHaveBeenCalled()
    expect(engine.install).not.toHaveBeenCalled()
  })
  it('leaves old versions uninstalled after interrupted downloads', async () => {
    const { updates, engine } = fixture()
    await updates.check()
    await updates.download('0.1.3')
    engine.download.mockRejectedValue(new Error('offline'))
    await updates.download('0.1.1')
    await expect(updates.install(true)).rejects.toThrow()
    expect(engine.install).not.toHaveBeenCalled()
  })
  it('reports failed release checks instead of claiming latest version', async () => {
    const { updates, io } = fixture()
    io.json.mockRejectedValue(new Error('404'))
    expect((await updates.check()).phase).toBe('error')
  })
})
