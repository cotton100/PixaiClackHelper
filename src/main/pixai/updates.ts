import {
  channelForVersion,
  channelLabel,
  installerName,
  type UpdateChannel
} from '../../shared/pixai/channels'
import {
  UPDATE_REPO,
  VERSION,
  compareVersions,
  releaseBase,
  parseManifest,
  assertCompatible,
  type AppRelease,
  type UpdateManifest,
  type UpdateStatus
} from '../../shared/pixai/updates'
import type { RunnerStatus } from '../../shared/pixai/execution'

export function canInstallUpdate(status: RunnerStatus): boolean {
  return (
    !status.running &&
    status.jobs.every((job) => ['done', 'cancelled', 'failed'].includes(job.state))
  )
}

export interface UpdateEngine {
  download(manifest: UpdateManifest): Promise<void>
  verify(): Promise<void>
  install(silent?: boolean): void
}
interface UpdateIO {
  version: string
  channel?: UpdateChannel
  saveChannel?(channel: UpdateChannel): void
  openExternal?(url: string): Promise<void>
  supported: boolean
  json(url: string): Promise<unknown>
  engine(tag: string, progress: (percent: number) => void, error: () => void): UpdateEngine
  canInstall(): boolean
  databaseVersion(): number
  backup(): string
}

export async function publicUpdateJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    credentials: 'omit',
    signal: AbortSignal.timeout(15000)
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(
      response.status === 404
        ? '공개 출시 목록을 찾지 못했습니다. 저장소 공개 여부와 릴리스 게시 상태를 확인해 주세요.'
        : `출시 정보를 읽지 못했습니다 (${response.status}). 잠시 후 다시 확인해 주세요.`
    )
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('출시 정보가 비어 있습니다.')
  const parts: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      length += next.value.length
      if (length > 4 * 1024 * 1024) throw new Error('출시 정보가 너무 큽니다.')
      parts.push(next.value)
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8'))
  } finally {
    await reader.cancel().catch(() => {})
  }
}

export function parseReleases(raw: unknown): AppRelease[] {
  if (!Array.isArray(raw)) throw new Error('출시 목록 형식을 확인해 주세요.')
  return raw
    .flatMap((item) => {
      if (
        !item ||
        item.draft ||
        typeof item.tag_name !== 'string' ||
        !item.tag_name.startsWith('v') ||
        !VERSION.test(item.tag_name.slice(1))
      )
        return []
      const version = item.tag_name.slice(1)
      if (item.prerelease === true && channelForVersion(version) === 'stable') return []
      const names = Array.isArray(item.assets)
        ? item.assets.map((asset: { name?: string }) => asset?.name)
        : []
      return [
        {
          version,
          tag: item.tag_name,
          date: typeof item.published_at === 'string' ? item.published_at : '',
          notes: typeof item.body === 'string' ? item.body.slice(0, 20000) : '',
          prerelease: item.prerelease === true || version.includes('-'),
          available: ['pixais-update.json', 'latest.yml', installerName(version)].every((name) =>
            names.includes(name)
          )
        }
      ]
    })
    .sort((a, b) => compareVersions(b.version, a.version))
}

export class PixaisUpdates {
  private state: UpdateStatus
  private engine: UpdateEngine | null = null
  private manifest: UpdateManifest | null = null
  constructor(private io: UpdateIO) {
    this.state = {
      currentVersion: io.version,
      installedChannel: channelForVersion(io.version),
      channel: io.channel ?? channelForVersion(io.version),
      supported: io.supported,
      phase: 'idle',
      releases: [],
      selectedVersion: '',
      percent: 0,
      message: '',
      backupPath: ''
    }
  }
  selectChannel(channel: unknown): UpdateStatus {
    this.idle()
    if (channel !== 'stable' && channel !== 'beta')
      throw new Error('업데이트 종류를 확인해 주세요.')
    this.io.saveChannel?.(channel)
    this.engine = null
    this.manifest = null
    this.state = {
      ...this.state,
      channel,
      phase: 'idle',
      selectedVersion: '',
      percent: 0,
      message: '',
      backupPath: ''
    }
    return this.status()
  }
  async openSeparate(version: string): Promise<UpdateStatus> {
    this.idle()
    if (!this.io.supported || !this.io.openExternal)
      throw new Error('Windows 설치 앱에서 사용할 수 있습니다.')
    if (typeof version !== 'string' || !VERSION.test(version))
      throw new Error('설치할 버전을 확인해 주세요.')
    const release = this.state.releases.find((item) => item.version === version)
    if (
      !release?.available ||
      channelForVersion(version) !== this.state.channel ||
      this.state.channel === this.state.installedChannel
    )
      throw new Error('별도로 설치할 다른 종류의 앱을 선택해 주세요.')
    this.state.phase = 'checking'
    try {
      const manifest = parseManifest(
        await this.io.json(releaseBase(release.tag) + 'pixais-update.json'),
        version
      )
      await this.io.openExternal(releaseBase(release.tag) + manifest.file)
      this.state.phase = 'idle'
      this.state.message =
        '브라우저에서 별도 설치 파일을 열었습니다. 다운로드한 파일을 실행해 설치하세요. 현재 앱과 자료는 그대로 유지됩니다.'
    } catch {
      this.fail(new Error('별도 설치 파일 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'))
    }
    return this.status()
  }
  status(): UpdateStatus {
    return structuredClone(this.state)
  }
  private idle(): void {
    if (['checking', 'downloading', 'installing'].includes(this.state.phase))
      throw new Error('현재 업데이트 작업이 끝난 뒤 다시 시도해 주세요.')
  }
  private fail(error: unknown): void {
    this.state.phase = 'error'
    this.state.message = error instanceof Error ? error.message : '업데이트를 완료하지 못했습니다.'
  }
  async check(): Promise<UpdateStatus> {
    this.idle()
    if (this.state.phase === 'ready')
      throw new Error('받아 둔 버전을 설치하거나 다른 버전을 선택해 주세요.')
    this.state.phase = 'checking'
    this.state.message = ''
    try {
      this.state.releases = parseReleases(
        await this.io.json(`https://api.github.com/repos/${UPDATE_REPO}/releases?per_page=100`)
      )
      this.state.phase = 'idle'
      this.state.message = this.state.releases.length
        ? '최근 출시 버전을 확인했습니다.'
        : '아직 게시된 출시 버전이 없습니다.'
    } catch (error) {
      this.fail(error)
    }
    return this.status()
  }
  async download(version: string): Promise<UpdateStatus> {
    this.idle()
    if (!this.io.supported) throw new Error('Windows 설치본에서 사용할 수 있습니다.')
    if (typeof version !== 'string' || !VERSION.test(version))
      throw new Error('설치할 버전을 확인해 주세요.')
    const release = this.state.releases.find((item) => item.version === version)
    if (
      channelForVersion(version) !== this.state.installedChannel ||
      this.state.channel !== this.state.installedChannel
    )
      throw new Error('다른 종류의 앱은 별도 설치를 이용해 주세요.')
    if (!release?.available || version === this.io.version)
      throw new Error('설치할 수 있는 다른 출시 버전을 선택해 주세요.')
    this.engine = null
    this.manifest = null
    this.state = {
      ...this.state,
      phase: 'downloading',
      selectedVersion: version,
      percent: 0,
      message: '',
      backupPath: ''
    }
    try {
      const manifest = parseManifest(
        await this.io.json(`${releaseBase(release.tag)}pixais-update.json`),
        version
      )
      assertCompatible(manifest, this.io.databaseVersion())
      const engine = this.io.engine(
        release.tag,
        (percent) => {
          this.state.percent = Math.max(0, Math.min(100, percent))
        },
        () => {
          this.fail(
            new Error(
              '설치 프로그램을 실행하지 못했습니다. 앱을 다시 열고 업데이트를 다시 받아 주세요.'
            )
          )
        }
      )
      await engine.download(manifest)
      this.engine = engine
      this.manifest = manifest
      this.state.phase = 'ready'
      this.state.percent = 100
      this.state.message = '다운로드 완료. 설치 버튼을 누를 때까지 현재 버전을 유지합니다.'
    } catch {
      this.fail(
        new Error('다운로드 또는 자료 호환 확인에 실패했습니다. 현재 버전은 변경하지 않았습니다.')
      )
    }
    return this.status()
  }
  async updateLatest(): Promise<UpdateStatus> {
    this.idle()
    if (!this.io.supported) throw new Error('Windows 설치본에서 사용할 수 있습니다.')
    if (this.state.channel !== this.state.installedChannel)
      throw new Error('다른 종류의 앱은 별도 설치를 이용해 주세요.')
    if (!this.io.canInstall())
      throw new Error('진행 중이거나 저장하지 못한 생성 작업을 마친 뒤 업데이트해 주세요.')
    // A click on this action authorizes checking, downloading and restarting.
    if (this.state.phase === 'ready') {
      this.state.phase = 'idle'
      this.engine = null
      this.manifest = null
    }
    const checked = await this.check()
    if (checked.phase === 'error' || !checked.releases.length) return checked
    const latest = checked.releases.find(
      (release) =>
        (release.prerelease ? 'beta' : 'stable') === this.state.channel &&
        release.available &&
        compareVersions(release.version, this.io.version) > 0
    )
    if (!latest) {
      this.state.message = `현재 설치할 수 있는 최신 ${channelLabel(this.state.channel ?? 'stable')} 버전입니다.`
      return this.status()
    }
    const downloaded = await this.download(latest.version)
    if (downloaded.phase !== 'ready') return downloaded
    return this.install(true, true)
  }
  async install(confirmed: boolean, silent = false): Promise<UpdateStatus> {
    if (!confirmed || this.state.phase !== 'ready' || !this.engine || !this.manifest)
      throw new Error('받아 둔 버전과 설치 안내를 확인해 주세요.')
    if (!this.io.canInstall())
      throw new Error('진행 중이거나 저장하지 못한 생성 작업을 마친 뒤 설치해 주세요.')
    const engine = this.engine
    this.state.phase = 'installing'
    try {
      await engine.verify()
      if (!this.io.canInstall()) throw new Error('실행 중인 작업이 있어 설치할 수 없습니다.')
      assertCompatible(this.manifest, this.io.databaseVersion())
      this.state.backupPath = this.io.backup()
      engine.install(silent)
    } catch {
      this.fail(
        new Error(
          '검증·백업·설치 준비 중 오류가 발생했습니다. 현재 자료는 유지됩니다. 업데이트를 다시 받아 주세요.'
        )
      )
    }
    return this.status()
  }
}
