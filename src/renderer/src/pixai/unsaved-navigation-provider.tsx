import { useState, type ReactNode } from 'react'
import { UnsavedEditorsContext, type UnsavedEditor } from './unsaved-editors'

/** Share dirty state without sharing or changing the editors' navigation dialogs. */
export function UnsavedNavigationProvider({
  children
}: {
  children: ReactNode
}): React.JSX.Element {
  const [editors] = useState(() => new Set<UnsavedEditor>())
  return <UnsavedEditorsContext.Provider value={editors}>{children}</UnsavedEditorsContext.Provider>
}
