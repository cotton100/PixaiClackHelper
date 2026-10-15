/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { expect, it, vi } from 'vitest'
import { PixaisUpdates, parseReleases } from '../src/main/pixai/updates'
import { DATA_EPOCH, DATABASE_VERSION, parseManifest } from '../src/shared/pixai/updates'
import { channelForVersion, installerName, type UpdateChannel } from '../src/shared/pixai/channels'

const metadata = (version: string) => ({
  format: 1,
  version,
  channel: channelForVersion(version),
  installation: 'shared',
  dataEpoch: DATA_EPOCH,
  minReadableDataEpoch: 1,
  databaseVersion: DATABASE_VERSION,
  file: installerName(version),
  size: 100,
  sha512: 'A'.repeat(86) + '=='
})
function fixture(version = '0.1.12', channel?: UpdateChannel) {
  const versions = ['0.1.14', '0.1.15-beta.2', '0.1.15-beta.1']
  const releases = versions.map((v) => ({
    tag_name: `v${v}`,
    prerelease: v.includes('-'),
    assets: ['latest.yml', 'pixais-update.json', installerName(v)].map((name) => ({ name }))
  }))
  const engine = {
    download: vi.fn(async () => {}),
    verify: vi.fn(async () => {}),
    install: vi.fn()
  }
  const io = {
    version,
    channel,
    supported: true,
    saveChannel: vi.fn(),
    json: vi.fn(async (url: string): Promise<unknown> =>
      url.includes('api.github.com') ? releases : metadata(url.split('/').at(-2)!.slice(1))
    ),
    engine: vi.fn(() => engine),
    canInstall: () => true,
    databaseVersion: () => DATABASE_VERSION,
    backup: vi.fn(() => 'fixture.db')
  }
  return { io, engine, updates: new PixaisUpdates(io) }
}

it('defaults stable and beta installations to their own update stream and restores a saved choice', () => {
  expect(fixture().updates.status()).toMatchObject({
    channel: 'stable',
    installedChannel: 'stable'
  })
  expect(fixture('0.1.13-beta.1').updates.status()).toMatchObject({
    channel: 'beta',
    installedChannel: 'beta'
  })
  expect(fixture('0.1.12', 'beta').updates.status()).toMatchObject({
    channel: 'beta',
    installedChannel: 'stable'
  })
})
it.each(['0.1.12', '0.1.13-beta.1'])(
  'updates %s only within the installed edition',
  async (version) => {
    const { updates, engine, io } = fixture(version)
    await updates.updateLatest()
    expect(engine.download).toHaveBeenCalledWith(
      metadata(version.includes('-') ? '0.1.15-beta.2' : '0.1.14')
    )
    expect(engine.install).toHaveBeenCalledWith(true)
    expect(io.backup).toHaveBeenCalledOnce()
  }
)
it('selects beta without installation, then updates the same app with backup only on the explicit update action', async () => {
  const { updates, io, engine } = fixture()
  await updates.check()
  updates.selectChannel('beta')
  expect(io.saveChannel).toHaveBeenCalledExactlyOnceWith('beta')
  expect(io.engine).not.toHaveBeenCalled()
  expect(engine.install).not.toHaveBeenCalled()
  expect(io.backup).not.toHaveBeenCalled()
  expect((await updates.updateLatest()).phase).toBe('installing')
  expect(engine.download).toHaveBeenCalledWith(metadata('0.1.15-beta.2'))
  expect(io.backup).toHaveBeenCalledOnce()
  expect(io.backup.mock.invocationCallOrder[0]).toBeLessThan(
    engine.install.mock.invocationCallOrder[0]
  )
  expect(engine.install).toHaveBeenCalledWith(true)
})
it('returns from beta to an older compatible stable only after an explicit update action', async () => {
  const { updates, io, engine } = fixture('0.1.15-beta.2')
  updates.selectChannel('stable')
  expect(engine.install).not.toHaveBeenCalled()
  expect(io.backup).not.toHaveBeenCalled()
  expect((await updates.updateLatest()).phase).toBe('installing')
  expect(engine.download).toHaveBeenCalledWith(metadata('0.1.14'))
  expect(io.backup).toHaveBeenCalledOnce()
})
it.each([{ dataEpoch: DATA_EPOCH - 1 }, { databaseVersion: DATABASE_VERSION - 1 }])(
  'blocks incompatible cross-channel rollback before download: %o',
  async (change) => {
    const { updates, io, engine } = fixture('0.1.15-beta.2')
    updates.selectChannel('stable')
    const originalJson = io.json.getMockImplementation()!
    io.json.mockImplementation(async (url) =>
      url.includes('api.github.com') ? originalJson(url) : { ...metadata('0.1.14'), ...change }
    )
    expect((await updates.updateLatest()).phase).toBe('error')
    expect(engine.download).not.toHaveBeenCalled()
    expect(io.backup).not.toHaveBeenCalled()
    expect(engine.install).not.toHaveBeenCalled()
  }
)
it('invalidates a downloaded installer when changing channels and persists before changing state', async () => {
  const { updates, io, engine } = fixture()
  await updates.check()
  await updates.download('0.1.14')
  expect(updates.status().phase).toBe('ready')
  io.saveChannel.mockImplementationOnce(() => {
    throw Error('disk full')
  })
  expect(() => updates.selectChannel('beta')).toThrow('disk full')
  expect(updates.status()).toMatchObject({ phase: 'ready', channel: 'stable' })
  updates.selectChannel('beta')
  expect(updates.status()).toMatchObject({ phase: 'idle', selectedVersion: '', channel: 'beta' })
  await expect(updates.install(true)).rejects.toThrow()
  expect(engine.install).not.toHaveBeenCalled()
})
it('rejects channel changes during downloads, mismatched channels and invalid installer metadata', async () => {
  const { updates, io, engine } = fixture()
  await updates.check()
  let finish!: () => void
  engine.download.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  const pending = updates.download('0.1.14')
  await vi.waitFor(() => expect(engine.download).toHaveBeenCalled())
  expect(() => updates.selectChannel('beta')).toThrow('끝난 뒤')
  finish()
  await pending
  updates.selectChannel('beta')
  await expect(updates.download('0.1.14')).rejects.toThrow('선택한 업데이트 채널')
  await expect(updates.download('../../evil')).rejects.toThrow()
  io.engine.mockClear()
  io.json.mockResolvedValueOnce({
    ...metadata('0.1.15-beta.2'),
    file: 'PixaiClackHelper-Beta-0.1.15-beta.2-setup.exe'
  })
  expect((await updates.download('0.1.15-beta.2')).phase).toBe('error')
  expect(io.engine).not.toHaveBeenCalled()
})
it('keeps legacy stable manifests readable but refuses separate beta installers and unmarked beta manifests', () => {
  const stable = metadata('0.1.12')
  expect(
    parseManifest({ ...stable, channel: undefined, installation: undefined }, '0.1.12').version
  ).toBe('0.1.12')
  const beta = metadata('0.1.13-beta.1')
  expect(() => parseManifest({ ...beta, channel: undefined }, beta.version)).toThrow()
  expect(() => parseManifest({ ...beta, installation: undefined }, beta.version)).toThrow()
  expect(() =>
    parseManifest(
      { ...beta, file: `PixaiClackHelper-Beta-${beta.version}-setup.exe` },
      beta.version
    )
  ).toThrow()
  expect(() => parseManifest({ ...stable, channel: 'beta' }, stable.version)).toThrow()
  expect(
    parseReleases([
      {
        tag_name: `v${beta.version}`,
        assets: [
          'latest.yml',
          'pixais-update.json',
          `PixaiClackHelper-Beta-${beta.version}-setup.exe`
        ].map((name) => ({ name }))
      }
    ])[0]
  ).toMatchObject({ available: false, legacySeparate: true })
})
