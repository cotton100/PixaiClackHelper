import Database from 'better-sqlite3'
import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { getDb } from '../db'
import { getSetting, setSetting } from '../db/settings'
import { VERSION } from '../../shared/pixai/updates'

export function backupBeforeUpdate(): string {
  const version = app.getVersion()
  if (!VERSION.test(version)) throw new Error('앱 버전을 확인할 수 없습니다.')
  const dir = join(app.getPath('userData'), 'version-backups')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `before-${version}-${randomUUID()}.db`)
  const current = getDb()
  current.prepare('VACUUM INTO ?').run(file)
  const copy = new Database(file, { readonly: true, fileMustExist: true })
  try {
    const settings = 'SELECT key, value FROM settings ORDER BY key'
    if (
      copy.pragma('quick_check', { simple: true }) !== 'ok' ||
      copy.pragma('user_version', { simple: true }) !==
        current.pragma('user_version', { simple: true }) ||
      JSON.stringify(copy.prepare(settings).all()) !==
        JSON.stringify(current.prepare(settings).all())
    )
      throw new Error('설정 백업 검증에 실패했습니다.')
  } finally {
    copy.close()
  }
  return file
}

/** Manual installers bypass the in-app updater. Back up before a new version
 * interprets the saved workspace too; never reset or restore settings silently. */
export function preserveSettingsOnVersionChange(): void {
  const version = app.getVersion()
  if (getSetting('pixais.lastOpenedVersion') === version) return
  const existing = getDb().prepare("SELECT 1 FROM settings WHERE key LIKE 'pixais.%' LIMIT 1").get()
  if (existing) backupBeforeUpdate()
  setSetting('pixais.lastOpenedVersion', version)
}
