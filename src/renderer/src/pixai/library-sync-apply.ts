import {
  applySyncLibrary,
  canonicalSync,
  projectSyncLibrary,
  type SyncLibrary
} from '@shared/pixai/library-sync'
import { t } from '../lib/i18n'
import type { PixaiStore } from './store'

/** The saved projection is checked inside the same locked commit that applies it. */
export async function applyLibrarySync(
  store: PixaiStore,
  expected: SyncLibrary,
  next: SyncLibrary,
  hasDirty: () => boolean,
  expiresAt = Infinity
): Promise<void> {
  if (Date.now() >= expiresAt) throw new Error(t('pixai.sync.expiredRequest'))
  const state = store.getState()
  if (!state.ready || state.busy || state.draftSaving || state.conflict)
    throw new Error(t('pixai.sync.busy'))
  if (hasDirty()) throw new Error(t('pixai.sync.dirty'))
  await state.commit((current) => {
    // commit waits for pending draft writes; recheck editors immediately before mutation.
    if (Date.now() >= expiresAt) throw new Error(t('pixai.sync.expiredRequest'))
    if (hasDirty()) throw new Error(t('pixai.sync.dirty'))
    if (canonicalSync(projectSyncLibrary(current.library)) !== canonicalSync(expected))
      throw new Error(t('pixai.sync.stale'))
    return { ...current, library: applySyncLibrary(current.library, next) }
  })
}
