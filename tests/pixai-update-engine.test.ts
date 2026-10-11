/* eslint-disable @typescript-eslint/no-explicit-any -- mutable mock of electron-updater's boundary */
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ updater: {} as Record<string, any> }))
vi.mock('electron-updater', () => ({
  default: {
    NsisUpdater: class {
      constructor() {
        return fake.updater
      }
    }
  }
}))
vi.mock('electron', () => ({ app: { getPath: () => 'C:/Program Files/PixAIS/PixAIS.exe' } }))
vi.mock('../src/main/db', () => ({ getDb: vi.fn() }))
import { makeUpdateEngine } from '../src/main/pixai/update-engine'
let dir: string
let manifest: {
  format: 1
  version: string
  dataEpoch: number
  databaseVersion: number
  file: string
  size: number
  sha512: string
}
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pixais-update-test-'))
  const bytes = Buffer.from('fake installer bytes')
  manifest = {
    format: 1,
    version: '0.1.3',
    dataEpoch: 1,
    databaseVersion: 18,
    file: 'PixaiClackHelper-0.1.3-setup.exe',
    size: bytes.length,
    sha512: createHash('sha512').update(bytes).digest('base64')
  }
  await writeFile(join(dir, manifest.file), bytes)
  fake.updater = {
    on: vi.fn(),
    checkForUpdates: vi.fn(async () => ({
      updateInfo: {
        version: manifest.version,
        path: manifest.file,
        files: [{ url: manifest.file, size: manifest.size, sha512: manifest.sha512 }]
      }
    })),
    downloadUpdate: vi.fn(async () => [join(dir, manifest.file)]),
    quitAndInstall: vi.fn()
  }
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})
it('keeps automatic download/quit install off, verifies bytes, then explicitly installs', async () => {
  const engine = makeUpdateEngine('v0.1.3', vi.fn(), vi.fn())
  expect(fake.updater.autoDownload).toBe(false)
  expect(fake.updater.autoInstallOnAppQuit).toBe(false)
  expect(fake.updater.disableWebInstaller).toBe(true)
  await engine.download(manifest)
  expect(fake.updater.quitAndInstall).not.toHaveBeenCalled()
  await engine.verify()
  engine.install()
  expect(fake.updater.quitAndInstall).toHaveBeenCalledWith(false, true)
  engine.install(true)
  expect(fake.updater.quitAndInstall).toHaveBeenLastCalledWith(true, true)
})
it.each(['version', 'url', 'sha512', 'packages'])(
  'rejects mismatched updater metadata: %s',
  async (field) => {
    const info = {
      version: manifest.version,
      files: [{ url: manifest.file, size: manifest.size, sha512: manifest.sha512 }]
    } as any
    if (field === 'version') info.version = '9.9.9'
    else if (field === 'packages') info.packages = { x64: { path: 'https://evil.test' } }
    else info.files[0][field] = 'https://evil.test/other.exe'
    fake.updater.checkForUpdates.mockResolvedValue({ updateInfo: info })
    await expect(makeUpdateEngine('v0.1.3', vi.fn(), vi.fn()).download(manifest)).rejects.toThrow()
    expect(fake.updater.downloadUpdate).not.toHaveBeenCalled()
  }
)
it('detects changes to a cached installer before installation', async () => {
  const engine = makeUpdateEngine('v0.1.3', vi.fn(), vi.fn())
  await engine.download(manifest)
  await writeFile(join(dir, manifest.file), 'changed')
  await expect(engine.verify()).rejects.toThrow()
  expect(fake.updater.quitAndInstall).not.toHaveBeenCalled()
})
