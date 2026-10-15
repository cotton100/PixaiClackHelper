export type UpdateChannel = 'stable' | 'beta'

export function channelForVersion(version: string): UpdateChannel {
  return version.includes('-') ? 'beta' : 'stable'
}

export function appIdentity(): {
  appId: string
  name: string
  productName: string
  executable: string
} {
  return {
    appId: 'com.cotton100.pixais',
    name: 'PixAIS',
    productName: 'PixaiClackHelper',
    executable: 'PixAIS'
  }
}

export function installerName(version: string): string {
  // The old separate Beta updater only accepts a "Beta-" filename. Do not reuse
  // that name for shared installations: it would overwrite the wrong app/profile.
  return `PixaiClackHelper-${version}-setup.exe`
}

export function channelLabel(channel: UpdateChannel): string {
  return channel === 'beta' ? '개발판' : '정식판'
}
