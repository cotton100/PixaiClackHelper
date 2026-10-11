import Database from 'better-sqlite3'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { closeDb, getDb, initDb } from '../src/main/db'
import { getSetting, setSetting } from '../src/main/db/settings'
import {
  backupBeforeUpdate,
  preserveSettingsOnVersionChange
} from '../src/main/pixai/settings-backup'
const environment = vi.hoisted(() => ({ directory: '', version: '0.1.4' }))
vi.mock('electron', () => ({
  app: { getPath: () => environment.directory, getVersion: () => environment.version },
  safeStorage: { isEncryptionAvailable: () => false }
}))
beforeEach(() => {
  environment.directory = mkdtempSync(join(tmpdir(), 'pixais-preservation-'))
  environment.version = '0.1.4'
  initDb()
})
afterEach(() => {
  closeDb()
  rmSync(environment.directory, { recursive: true, force: true })
})
const rows = (db = getDb()): unknown[] =>
  db.prepare('SELECT key, value FROM settings ORDER BY key').all()
it('keeps every stored setting and committed WAL value through backup and a version restart', () => {
  const fixtures = {
    'pixais.workspace.v1': JSON.stringify({
      fixture: 'presets, chunks, scenes and selected composition',
      triggerPosition: 'end',
      ratio: '5:3'
    }),
    'pixais.outputDir': "C:/fixture/user's images",
    'pixais.maxInFlight': '4',
    'pixais.key.v1': 'opaque-encrypted-fixture-not-a-key',
    'pixais.runner.v1': JSON.stringify({ fixture: 'completed jobs and download IDs' }),
    'pixais.lastOpenedVersion': '0.1.4'
  }
  for (const [key, value] of Object.entries(fixtures)) setSetting(key, value)
  getDb().pragma('wal_autocheckpoint = 0')
  const before = rows()
  const file = backupBeforeUpdate()
  const backup = new Database(file, { readonly: true })
  try {
    expect(rows(backup)).toEqual(before)
  } finally {
    backup.close()
  }
  expect(rows()).toEqual(before)
  closeDb()
  environment.version = '0.1.5'
  initDb()
  preserveSettingsOnVersionChange()
  for (const [key, value] of Object.entries(fixtures))
    if (key !== 'pixais.lastOpenedVersion') expect(getSetting(key)).toBe(value)
  expect(getSetting('pixais.lastOpenedVersion')).toBe('0.1.5')
  const count = readdirSync(join(environment.directory, 'version-backups')).length
  preserveSettingsOnVersionChange()
  expect(readdirSync(join(environment.directory, 'version-backups'))).toHaveLength(count)
})
it('backs up a manual upgrade from a version without a marker before recording the new version', () => {
  setSetting('pixais.outputDir', 'C:/fixture/output')
  const before = rows()
  preserveSettingsOnVersionChange()
  const [name] = readdirSync(join(environment.directory, 'version-backups'))
  const backup = new Database(join(environment.directory, 'version-backups', name), {
    readonly: true
  })
  try {
    expect(rows(backup)).toEqual(before)
  } finally {
    backup.close()
  }
  expect(getSetting('pixais.outputDir')).toBe('C:/fixture/output')
})
it('leaves old settings and version marker untouched if the manual-upgrade backup cannot be made', () => {
  setSetting('pixais.lastOpenedVersion', '0.1.3')
  setSetting('pixais.workspace.v1', 'original fixture')
  const before = rows()
  writeFileSync(join(environment.directory, 'version-backups'), 'blocked path fixture')
  expect(() => preserveSettingsOnVersionChange()).toThrow()
  expect(rows()).toEqual(before)
})
