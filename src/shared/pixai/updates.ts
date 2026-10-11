export const UPDATE_REPO = 'cotton100/PixaiClackHelper'
// Increment when a workspace/runner format can no longer be read by older PixAIS releases.
export const DATA_EPOCH = 6
// Releases declare the oldest workspace format they can migrate/read.
export const MIN_READABLE_DATA_EPOCH = 1
export const DATABASE_VERSION = 19
export const VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:alpha|beta|rc)\.(0|[1-9]\d*))?$/
export interface AppRelease {
  version: string
  tag: string
  date: string
  notes: string
  prerelease: boolean
  available: boolean
}
export interface UpdateManifest {
  format: 1
  version: string
  dataEpoch: number
  minReadableDataEpoch?: number
  databaseVersion: number
  file: string
  size: number
  sha512: string
}
export interface UpdateStatus {
  currentVersion: string
  supported: boolean
  phase: 'idle' | 'checking' | 'downloading' | 'ready' | 'installing' | 'error'
  releases: AppRelease[]
  selectedVersion: string
  percent: number
  message: string
  backupPath: string
}
export function compareVersions(a: string, b: string): number {
  if (!VERSION.test(a) || !VERSION.test(b)) throw new Error('버전 형식을 확인해 주세요.')
  const parse = (v: string): (number | string)[] => {
    const [core, pre] = v.split('-')
    return [
      ...core.split('.').map(Number),
      pre ? ['alpha', 'beta', 'rc'].indexOf(pre.split('.')[0]) : 3,
      pre ? Number(pre.split('.')[1]) : 0
    ]
  }
  const left = parse(a),
    right = parse(b)
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1
  return 0
}
export function releaseBase(tag: string): string {
  if (!tag.startsWith('v') || !VERSION.test(tag.slice(1)))
    throw new Error('출시 버전을 확인해 주세요.')
  return `https://github.com/${UPDATE_REPO}/releases/download/${tag}/`
}
export function parseManifest(value: unknown, version: string): UpdateManifest {
  const m = value as UpdateManifest
  if (
    !m ||
    m.format !== 1 ||
    m.version !== version ||
    !VERSION.test(version) ||
    !Number.isInteger(m.dataEpoch) ||
    m.dataEpoch < 1 ||
    (m.minReadableDataEpoch !== undefined &&
      (!Number.isInteger(m.minReadableDataEpoch) ||
        m.minReadableDataEpoch < 1 ||
        m.minReadableDataEpoch > m.dataEpoch)) ||
    !Number.isInteger(m.databaseVersion) ||
    m.databaseVersion < 1 ||
    m.file !== `PixaiClackHelper-${version}-setup.exe` ||
    !Number.isSafeInteger(m.size) ||
    m.size < 1 ||
    m.size > 1024 ** 3 ||
    typeof m.sha512 !== 'string' ||
    !/^[A-Za-z0-9+/]{86}==$/.test(m.sha512)
  )
    throw new Error('출시 파일의 정보가 올바르지 않습니다. 설치하지 않았습니다.')
  return m
}
export function assertCompatible(m: UpdateManifest, databaseVersion: number): void {
  if (
    DATA_EPOCH < (m.minReadableDataEpoch ?? m.dataEpoch) ||
    DATA_EPOCH > m.dataEpoch ||
    m.databaseVersion < databaseVersion
  )
    throw new Error(
      '현재 자료 형식과 호환되지 않는 버전입니다. 자료를 보호하기 위해 설치를 막았습니다.'
    )
}
