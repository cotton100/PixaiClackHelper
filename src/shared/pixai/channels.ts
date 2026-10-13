export type UpdateChannel = 'stable' | 'beta'

export function channelForVersion(version: string): UpdateChannel {
  return version.includes('-') ? 'beta' : 'stable'
}

export function appIdentity(channel: UpdateChannel): {
  appId: string
  name: string
  productName: string
  executable: string
} {
  return channel === 'beta'
    ? {
        appId: 'com.cotton100.pixais.beta',
        name: 'PixAIS-Beta',
        productName: 'PixaiClackHelper Beta',
        executable: 'PixAIS-Beta'
      }
    : {
        appId: 'com.cotton100.pixais',
        name: 'PixAIS',
        productName: 'PixaiClackHelper',
        executable: 'PixAIS'
      }
}

export function installerName(version: string): string {
  return `PixaiClackHelper-${channelForVersion(version) === 'beta' ? 'Beta-' : ''}${version}-setup.exe`
}

export function channelLabel(channel: UpdateChannel): string {
  return channel === 'beta' ? '개발판' : '정식판'
}
