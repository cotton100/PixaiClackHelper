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
  expect(appIdentity('stable')).toMatchObject({
    name: 'PixAIS',
    appId: info.id,
    executable: 'PixAIS'
  })
  expect(desktop).toContain('app.setName(identity.name)')
  expect(desktop).toContain("join(app.getPath('appData'), identity.name)")
})

it('gives beta its own installer, executable, shortcuts and user-data identity', () => {
  const require = createRequire(import.meta.url)
  const builderRequire = createRequire(require.resolve('electron-builder'))
  const { AppInfo } = builderRequire('app-builder-lib/out/appInfo')
  const { getWindowsInstallationDirName } = builderRequire('app-builder-lib/out/targets/targetUtil')
  const stable = parse(readFileSync('electron-builder.yml', 'utf8'))
  const beta = parse(readFileSync('electron-builder.beta.yml', 'utf8'))
  const config = { ...stable, ...beta, win: { ...stable.win, ...beta.win } }
  const metadata = { ...JSON.parse(readFileSync('package.json', 'utf8')), ...beta.extraMetadata }
  const info = new AppInfo({ config, metadata }, undefined, config.win)
  expect(info.id).toBe(appIdentity('beta').appId)
  expect(info.productFilename).toBe('PixAIS-Beta')
  expect(getWindowsInstallationDirName(info, true)).toBe('PixAIS-Beta')
  expect(beta.nsis.shortcutName).toBe('PixaiClackHelper Beta')
  expect(beta.nsis.allowToChangeInstallationDirectory).toBe(false)
  expect(metadata.name).not.toBe('pixais')
  expect(appIdentity('beta').name).not.toBe(appIdentity('stable').name)
})
