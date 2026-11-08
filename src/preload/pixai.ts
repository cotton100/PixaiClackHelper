import { contextBridge, ipcRenderer } from 'electron'
const channels = new Set([
  'pixai:library-sync-status',
  'pixai:library-sync-enable',
  'pixai:library-sync-pair',
  'pixai:library-sync-request',
  'pixai:library-sync-approve',
  'pixai:library-sync-cancel',
  'pixai:library-sync-disconnect',
  'pixai:library-sync-applied',
  'tags:search',
  'pixai:workspace-read',
  'pixai:workspace-write',
  'pixai:image-info',
  'pixai:metadata-setting',
  'settings:get',
  'settings:set',
  'window:control',
  'pixai:status',
  'pixai:scene-thumbnails',
  'pixai:update-status',
  'pixai:update-channel',
  'pixai:update-check',
  'pixai:update-latest',
  'pixai:update-download',
  'pixai:update-install',
  'pixai:model-link',
  'pixai:connection',
  'pixai:connect',
  'pixai:forget',
  'pixai:folder',
  'pixai:concurrency',
  'pixai:start',
  'pixai:dismiss-unknown',
  'pixai:pause',
  'pixai:remove',
  'pixai:open-folder'
])
contextBridge.exposeInMainWorld('nais', {
  invoke: (channel: string, req: unknown) => {
    if (!channels.has(channel))
      return Promise.reject(new Error('이 앱에서 지원하지 않는 호출입니다.'))
    return ipcRenderer.invoke(channel, req)
  },
  on: (channel: string, listener: (payload: unknown) => void) => {
    if (channel !== 'pixai:library-sync-apply') return () => {}
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  }
})
