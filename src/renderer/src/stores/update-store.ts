import { create } from 'zustand'
import type { IpcEventMap } from '@shared/types'

type UpdateStatus = IpcEventMap['update:status']

interface UpdateState {
  status: UpdateStatus['state'] | 'idle'
  version?: string
  percent: number
  start: () => void
}

export const useUpdateStore = create<UpdateState>((set) => ({
  status: 'idle',
  percent: 0,
  start: () => {
    set({ status: 'downloading', percent: 0 })
    void window.nais.invoke('update:start', undefined)
  }
}))

/** update:status 이벤트 구독 — App 마운트 시 1회 */
export function bindUpdateEvents(): () => void {
  return window.nais.on('update:status', (s) => {
    useUpdateStore.setState({
      status: s.state,
      version: s.version ?? useUpdateStore.getState().version,
      percent: s.percent ?? useUpdateStore.getState().percent
    })
  })
}
