/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { expect, it, vi } from 'vitest'
import { PixaisUpdates, parseReleases } from '../src/main/pixai/updates'
import { DATA_EPOCH, DATABASE_VERSION, parseManifest } from '../src/shared/pixai/updates'
import { channelForVersion, installerName, type UpdateChannel } from '../src/shared/pixai/channels'

const metadata = (version: string) => ({
  format: 1,
  version,
  channel: channelForVersion(version),
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
    openExternal: vi.fn(async () => {}),
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
    expect(io.openExternal).not.toHaveBeenCalled()
  }
)
it('opens a fixed separate installer URL without replacing the app, migrating or backing up this workspace', async () => {
  const { updates, io, engine } = fixture()
  await updates.check()
  updates.selectChannel('beta')
  await expect(updates.download('0.1.15-beta.2')).rejects.toThrow('별도 설치')
  await expect(updates.updateLatest()).rejects.toThrow('별도 설치')
  await updates.openSeparate('0.1.15-beta.2')
  expect(io.openExternal).toHaveBeenCalledExactlyOnceWith(
    'https://github.com/cotton100/PixaiClackHelper/releases/download/v0.1.15-beta.2/PixaiClackHelper-Beta-0.1.15-beta.2-setup.exe'
  )
  expect(engine.install).not.toHaveBeenCalled()
  expect(io.databaseVersion()).toBe(DATABASE_VERSION)
  expect(io.backup).not.toHaveBeenCalled()
  expect(io.engine).not.toHaveBeenCalled()
})
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
it('rejects channel changes during downloads and never opens an unverified or same-edition URL', async () => {
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
  await expect(updates.openSeparate('0.1.14')).rejects.toThrow()
  await expect(updates.openSeparate('../../evil')).rejects.toThrow()
  io.json.mockResolvedValueOnce({
    ...metadata('0.1.15-beta.2'),
    file: 'PixaiClackHelper-0.1.15-beta.2-setup.exe'
  })
  expect((await updates.openSeparate('0.1.15-beta.2')).phase).toBe('error')
  expect(io.openExternal).not.toHaveBeenCalled()
})
it('keeps legacy stable manifests readable but refuses legacy beta installers sharing stable identity', () => {
  const stable = metadata('0.1.12')
  expect(parseManifest({ ...stable, channel: undefined }, '0.1.12').version).toBe('0.1.12')
  const beta = metadata('0.1.13-beta.1')
  expect(() => parseManifest({ ...beta, channel: undefined }, beta.version)).toThrow()
  expect(() =>
    parseManifest({ ...beta, file: `PixaiClackHelper-${beta.version}-setup.exe` }, beta.version)
  ).toThrow()
  expect(() => parseManifest({ ...stable, channel: 'beta' }, stable.version)).toThrow()
  expect(
    parseReleases([
      {
        tag_name: `v${beta.version}`,
        assets: [
          'latest.yml',
          'pixais-update.json',
          `PixaiClackHelper-${beta.version}-setup.exe`
        ].map((name) => ({ name }))
      }
    ])[0].available
  ).toBe(false)
})
