import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { expect, it } from 'vitest'
import { parse } from 'yaml'
import { UPDATE_REPO } from '../src/shared/pixai/updates'
import { appIdentity } from '../src/shared/pixai/channels'

it('renames the product without changing NSIS installation or workspace identity', () => {
  const require = createRequire(import.meta.url)
  const builderRequire = createRequire(require.resolve('electron-builder'))
  const { AppInfo } = builderRequire('app-builder-lib/out/appInfo')
  const { getWindowsInstallationDirName } = builderRequire('app-builder-lib/out/targets/targetUtil')
  const config = parse(readFileSync('electron-builder.yml', 'utf8'))
  const metadata = JSON.parse(readFileSync('package.json', 'utf8'))
  const info = new AppInfo({ config, metadata }, undefined, config.win)
  expect(info.productName).toBe('PixaiClackHelper')
  expect(info.id).toBe('com.cotton100.pixais')
  expect(info.productFilename).toBe('PixAIS')
  expect(getWindowsInstallationDirName(info, true)).toBe('PixAIS')
  expect(metadata.name).toBe('pixais')
  expect(`${config.publish.owner}/${config.publish.repo}`).toBe(UPDATE_REPO)
  const desktop = readFileSync('src/main/pixai/desktop.ts', 'utf8')
  expect(appIdentity()).toMatchObject({
    name: 'PixAIS',
    appId: info.id,
    executable: 'PixAIS'
  })
  expect(desktop).toContain('app.setName(identity.name)')
  expect(desktop).toContain("join(app.getPath('appData'), identity.name)")
})

it('keeps beta on the same installation, shortcut, executable and workspace as stable', () => {
  const require = createRequire(import.meta.url)
  const builderRequire = createRequire(require.resolve('electron-builder'))
  const { AppInfo } = builderRequire('app-builder-lib/out/appInfo')
  const { getWindowsInstallationDirName } = builderRequire('app-builder-lib/out/targets/targetUtil')
  const stable = parse(readFileSync('electron-builder.yml', 'utf8'))
  const beta = parse(readFileSync('electron-builder.beta.yml', 'utf8'))
  const config = { ...stable, ...beta, win: { ...stable.win, ...beta.win } }
  const metadata = { ...JSON.parse(readFileSync('package.json', 'utf8')), ...beta.extraMetadata }
  const info = new AppInfo({ config, metadata }, undefined, config.win)
  expect(info.id).toBe(appIdentity().appId)
  expect(info.productFilename).toBe('PixAIS')
  expect(getWindowsInstallationDirName(info, true)).toBe('PixAIS')
  expect(config.nsis.shortcutName).toBe('PixaiClackHelper')
  expect(metadata.name).toBe('pixais')
  expect(appIdentity().name).toBe('PixAIS')
  expect(config.nsis.artifactName).toBe('PixaiClackHelper-${version}-setup.${ext}')
  expect(config.publish).toEqual(stable.publish)
})
