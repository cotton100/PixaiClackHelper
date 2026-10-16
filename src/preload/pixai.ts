import { contextBridge, ipcRenderer } from 'electron'
const channels = new Set([
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
  on: () => () => {}
})
