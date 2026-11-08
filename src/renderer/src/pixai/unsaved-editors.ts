import { createContext, useContext, useMemo } from 'react'

export interface UnsavedEditor {
  dirty: boolean
  save: () => Promise<boolean>
  discard?: () => void
}

export const UnsavedEditorsContext = createContext<Set<UnsavedEditor> | null>(null)

export function useUnsavedEditors(): { hasDirty: () => boolean } {
  const editors = useContext(UnsavedEditorsContext)
  return useMemo(
    () => ({ hasDirty: () => !!editors && [...editors].some((entry) => entry.dirty) }),
    [editors]
  )
}
