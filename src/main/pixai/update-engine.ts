import electronUpdater from 'electron-updater'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { getDb } from '../db'
import { releaseBase, type UpdateManifest } from '../../shared/pixai/updates'
import type { UpdateEngine } from './updates'

export function makeUpdateEngine(
  tag: string,
  progress: (percent: number) => void,
  error: () => void
): UpdateEngine {
  const updater = new electronUpdater.NsisUpdater({ provider: 'generic', url: releaseBase(tag) })
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.allowDowngrade = true
  updater.allowPrerelease = true
  updater.channel = 'latest'
  updater.disableDifferentialDownload = true
  updater.disableWebInstaller = true
  updater.logger = null
  updater.installDirectory = dirname(app.getPath('exe'))
  updater.on('download-progress', (info) => progress(info.percent))
  updater.on('error', error)
  let manifest: UpdateManifest | null = null
  let file = ''
  async function verify(): Promise<void> {
    if (!manifest || !file) throw new Error('다운로드 파일이 없습니다.')
    const hash = createHash('sha512')
    let size = 0
    for await (const chunk of createReadStream(file)) {
      hash.update(chunk)
      size += chunk.length
    }
    if (size !== manifest.size || hash.digest('base64') !== manifest.sha512)
      throw new Error('다운로드 파일 검증 실패')
  }
  return {
    async download(expected) {
      const result = await updater.checkForUpdates()
      const info = result?.updateInfo
      if (
        !info ||
        info.version !== expected.version ||
        info.files.length !== 1 ||
        info.files[0].url !== expected.file ||
        info.files[0].sha512 !== expected.sha512 ||
        info.files[0].size !== expected.size ||
        ('packages' in info && info.packages) ||
        (info.path && info.path !== expected.file)
      )
        throw new Error('선택한 출시 파일과 일치하지 않습니다.')
      const paths = await updater.downloadUpdate()
      if (paths.length !== 1) throw new Error('설치 파일 수가 일치하지 않습니다.')
      file = paths[0]
      manifest = expected
      await verify()
    },
    verify,
    install(silent = false) {
      updater.quitAndInstall(silent, true)
    }
  }
}

export function backupBeforeUpdate(): string {
  // Separate from rotating migration backups: never prune a version-change backup here.
  const dir = join(app.getPath('userData'), 'version-backups')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `before-${app.getVersion()}-${randomUUID()}.db`)
  getDb().prepare('VACUUM INTO ?').run(file)
  return file
}
