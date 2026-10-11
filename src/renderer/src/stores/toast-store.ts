import { create } from 'zustand'

export type ToastType = 'error' | 'info' | 'success'

export interface Toast {
  id: number
  message: string
  type: ToastType
}

interface ToastState {
  toasts: Toast[]
  push: (message: string, type?: ToastType) => void
  dismiss: (id: number) => void
}

let seq = 0

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (message, type = 'info') => {
    const id = ++seq
    set({ toasts: [...get().toasts, { id, message, type }] })
    // 자동 사라짐 (에러는 조금 더 오래)
    setTimeout(() => get().dismiss(id), type === 'error' ? 5000 : 3000)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) })
}))

/** 어디서든 호출 가능한 단축 헬퍼 */
export function toast(message: string, type?: ToastType): void {
  useToastStore.getState().push(message, type)
}
