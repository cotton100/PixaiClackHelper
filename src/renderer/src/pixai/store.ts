import { create, type StoreApi, type UseBoundStore } from 'zustand'
import {
  expandReservations,
  makeLibrary,
  normalizeSettingsOptions,
  strictLibrary,
  type Library,
  type SettingsOptions,
  type ExpandedRequest,
  type SettingsBackup
} from '@shared/pixai/library'
import {
  appendBatchReservations,
  expandBatchPlan,
  type BatchExpansion
} from '@shared/pixai/batch-reserve'
import type { BatchPlan } from '@shared/pixai/library'
import { resolveImageOptions } from '@shared/pixai/generation-options'
import { readComposeDraft, type ComposeDraft } from './composition'
import { expansionBudget, jsonBytes } from '@shared/pixai/expansion-budget'
import {
  prepareBackupImport,
  type TransferBackup,
  type BackupSelection,
  type ImportMode
} from '@shared/pixai/backup-transfer'

export const WORKSPACE_KEY = 'pixais.workspace.v1'
export interface QueuedJob {
  request: ExpandedRequest
  imageCount: number
  options: SettingsOptions
}
export interface Workspace {
  version: 1
  library: Library
  options: SettingsOptions
  jobs: QueuedJob[]
  widths: Record<string, number[]>
  composeDraft?: ComposeDraft
}
export interface WorkspaceStorage {
  read(): Promise<string | null>
  write(value: string): Promise<void>
}
export function emptyWorkspace(): Workspace {
  return {
    version: 1,
    library: makeLibrary(),
    options: { maxCredits: null, filePrefix: '', repeat: 1, imageCount: 4 },
    jobs: [],
    widths: {}
  }
}

/** Library is kept in its original JSON shape. One DB setting commits library,
 * options and registration together, so a failed write cannot consume reservations. */
export function readWorkspace(text: string | null): Workspace {
  if (text === null) return emptyWorkspace()
  const raw = JSON.parse(text) as Workspace
  if (!raw || raw.version !== 1 || !Array.isArray(raw.jobs) || raw.jobs.length > 1000)
    throw new Error('저장된 PixAIS 작업 공간 형식을 확인해 주세요.')
  const ids = new Set<string>()
  const jobs = raw.jobs.map((job): QueuedJob => {
    const request = job?.request
    if (
      !request?.id ||
      ids.has(request.id) ||
      ![0, 1, 4].includes(job.imageCount) ||
      !request.composition?.reservation?.snapshot
    )
      throw new Error('저장된 대기 작업 형식을 확인해 주세요.')
    ids.add(request.id)
    // Rebuild from the frozen material, never from today's library.
    const { repeat, ...reservation } = request.composition.reservation
    if (!Number.isInteger(repeat) || repeat < 1 || repeat > reservation.count)
      throw new Error('저장된 작업 회차를 확인해 주세요.')
    const library = strictLibrary({
      ...makeLibrary(),
      reservations: [{ ...reservation, count: 1 }]
    })
    const rebuilt = expandReservations(library, {
      idFactory: () => request.id,
      restoreSingleJob: true
    })[0]
    return {
      request: {
        ...rebuilt,
        title: String(request.title),
        composition: { ...rebuilt.composition, reservation: { ...reservation, repeat } }
      },
      imageCount: job.imageCount,
      options: normalizeSettingsOptions(job.options ?? raw.options)
    }
  })
  const widths: Record<string, number[]> = {}
  for (const name of ['compose', 'scenes', 'library']) {
    const sizes = raw.widths?.[name]
    if (
      Array.isArray(sizes) &&
      sizes.length === 3 &&
      sizes.every((n) => Number.isFinite(n) && n >= 15 && n <= 70)
    )
      widths[name] = sizes
  }
  return {
    version: 1,
    library: strictLibrary(raw.library),
    options: normalizeSettingsOptions(raw.options),
    jobs,
    widths: { ...widths, ...normalizeSettingsOptions(raw.options).ui?.paneRatios },
    ...(raw.composeDraft === undefined ? {} : { composeDraft: readComposeDraft(raw.composeDraft) })
  }
}

interface PixaiState {
  workspace: Workspace
  ready: boolean
  busy: boolean
  draftSaving: boolean
  error: string
  revision: number
  hydrate(): Promise<void>
  commit(update: (workspace: Workspace) => Workspace): Promise<void>
  saveDraft(draft: ComposeDraft): Promise<void>
  editLibrary(update: (library: Library) => Library): Promise<void>
  importBackup(backup: SettingsBackup, expectedRevision: number): Promise<void>
  importSelectedBackup(
    backup: TransferBackup,
    selection: BackupSelection,
    mode: ImportMode,
    expectedRevision: number
  ): Promise<void>
  reserve(plan: BatchPlan, registerNow?: boolean): Promise<BatchExpansion>
  register(): Promise<void>
  clearError(): void
}

const databaseStorage: WorkspaceStorage = {
  read: async () => (await window.nais.invoke('settings:get', { key: WORKSPACE_KEY })).value,
  write: async (value) => {
    await window.nais.invoke('settings:set', { key: WORKSPACE_KEY, value })
  }
}

export function createPixaiStore(
  storage: WorkspaceStorage = databaseStorage
): UseBoundStore<StoreApi<PixaiState>> {
  let loading: Promise<void> | undefined
  let draftWrites: Promise<void> = Promise.resolve()
  let draftSequence = 0
  let savedDraft: ComposeDraft | undefined
  return create<PixaiState>((set, get) => ({
    workspace: emptyWorkspace(),
    ready: false,
    busy: false,
    draftSaving: false,
    error: '',
    revision: 0,
    clearError: () => set({ error: '' }),
    hydrate: () => {
      if (get().ready) return Promise.resolve()
      if (loading) return loading
      loading = (async () => {
        try {
          set({ workspace: readWorkspace(await storage.read()), ready: true, error: '' })
        } catch {
          set({
            error:
              '작업 공간을 읽지 못했습니다. 기존 데이터는 보존돼 있습니다. 다시 불러오기를 눌러 주세요.'
          })
        } finally {
          loading = undefined
        }
      })()
      return loading
    },
    commit: async (update) => {
      if (!get().ready) throw new Error('작업 공간을 먼저 불러와 주세요.')
      if (get().busy) throw new Error('저장 중입니다. 잠시 후 다시 시도해 주세요.')
      set({ busy: true, error: '' })
      try {
        // A normal edit must use the last persisted draft, never race its writes.
        await draftWrites
        const next = update(structuredClone(get().workspace))
        next.library = strictLibrary(next.library)
        next.options = normalizeSettingsOptions(next.options)
        if (next.composeDraft !== undefined) next.composeDraft = readComposeDraft(next.composeDraft)
        jsonBytes(next)
        const text = JSON.stringify(next)
        try {
          await storage.write(text)
        } catch {
          throw new Error(
            '저장하지 못했습니다. 변경 사항은 적용되지 않았습니다. 다시 시도해 주세요.'
          )
        }
        set({ workspace: next, revision: get().revision + 1 })
      } catch (error) {
        set({ error: error instanceof Error ? error.message : '변경을 적용하지 못했습니다.' })
        throw error
      } finally {
        set({ busy: false })
      }
    },
    saveDraft: (value) => {
      if (!get().ready || get().busy)
        return Promise.reject(new Error('저장이 끝난 뒤 다시 변경해 주세요.'))
      const draft = readComposeDraft(value)
      if (!get().draftSaving) savedDraft = get().workspace.composeDraft
      const sequence = ++draftSequence
      set({ workspace: { ...get().workspace, composeDraft: draft }, draftSaving: true, error: '' })
      // Serialize full-workspace writes. Rapid input keeps the field enabled;
      // the last selection wins and later library edits wait for it.
      const write = draftWrites
        .catch(() => {})
        .then(async () => {
          const next = structuredClone(get().workspace)
          await storage.write(JSON.stringify(next))
          savedDraft = next.composeDraft
        })
      draftWrites = write
      return write.then(
        () => {
          if (sequence === draftSequence) set({ draftSaving: false, revision: get().revision + 1 })
        },
        () => {
          if (sequence === draftSequence)
            set({
              workspace: { ...get().workspace, composeDraft: savedDraft },
              draftSaving: false,
              error:
                '조합 선택을 저장하지 못했습니다. 마지막 저장 상태를 유지합니다. 다시 시도해 주세요.'
            })
          // Keep the failure visible but allow a later explicit edit to retry.
          if (sequence === draftSequence) draftWrites = Promise.resolve()
        }
      )
    },
    editLibrary: (update) =>
      get().commit((workspace) => ({ ...workspace, library: update(workspace.library) })),
    importBackup: (backup, expectedRevision) =>
      get().commit((workspace) => {
        if (get().revision !== expectedRevision)
          throw new Error('미리보기 후 자료가 바뀌었습니다. 파일을 다시 골라 확인해 주세요.')
        return {
          ...workspace,
          library: backup.library,
          options: backup.options,
          widths: { ...backup.options.ui?.paneRatios },
          composeDraft: undefined
        }
      }),
    importSelectedBackup: (backup, selection, mode, expectedRevision) =>
      get().commit((workspace) => {
        if (get().revision !== expectedRevision)
          throw new Error('미리보기 후 자료가 바뀌었습니다. 파일을 다시 골라 확인해 주세요.')
        const imported = prepareBackupImport(workspace.library, backup, selection, mode)
        if (
          workspace.jobs.length + imported.library.reservations.reduce((n, r) => n + r.count, 0) >
          1000
        )
          throw new Error('대기열과 예약을 합쳐 1,000작업까지 담을 수 있습니다.')
        return {
          ...workspace,
          library: imported.library,
          ...(imported.options
            ? { options: imported.options, widths: { ...imported.options.ui?.paneRatios } }
            : {}),
          // Retain a draft on append; a replacement may invalidate its IDs.
          ...(mode === 'replace' ? { composeDraft: undefined } : {})
        }
      }),
    reserve: async (plan, registerNow = false) => {
      let expansion: BatchExpansion | undefined
      await get().commit((workspace) => {
        expansion = expandBatchPlan(workspace.library, plan, {
          batchSize: workspace.options.imageCount,
          batchId: crypto.randomUUID()
        })
        expansion.reservations = expansion.reservations.map((reservation) => ({
          ...reservation,
          imageOptions: resolveImageOptions(
            reservation.imageOptions,
            workspace.options,
            plan.imageOptions
          )
        }))
        expansion.totals.images = expansion.reservations.reduce(
          (sum, reservation) => sum + reservation.count * reservation.imageOptions!.batchSize!,
          0
        )
        if (
          workspace.jobs.length +
            workspace.library.reservations.reduce((sum, item) => sum + item.count, 0) +
            expansion.totals.jobs >
          1000
        )
          throw new Error(
            '대기열과 예약을 합쳐 1,000작업까지 담을 수 있습니다. 기존 작업을 정리해 주세요.'
          )
        const next = {
          ...workspace,
          library: appendBatchReservations(workspace.library, expansion)
        }
        return registerNow
          ? registerWorkspace(
              next,
              expansion.reservations.map((item) => item.id)
            )
          : next
      })
      return expansion!
    },
    register: () => get().commit((workspace) => registerWorkspace(workspace))
  }))
}
export const usePixaiStore = createPixaiStore()
export type PixaiStore = ReturnType<typeof createPixaiStore>

export function savePaneUI(
  store: PixaiStore,
  name: 'compose' | 'scenes' | 'library',
  widths?: number[],
  collapsed?: number
): Promise<void> {
  return store.getState().commit((current) => ({
    ...current,
    widths: widths ? { ...current.widths, [name]: widths } : current.widths,
    options: {
      ...current.options,
      ui: {
        ...current.options.ui,
        ...(widths ? { paneRatios: { ...current.options.ui?.paneRatios, [name]: widths } } : {}),
        ...(collapsed !== undefined
          ? { collapsedPane: { ...current.options.ui?.collapsedPane, [name]: collapsed } }
          : {})
      }
    }
  }))
}

function registerWorkspace(workspace: Workspace, ids?: string[]): Workspace {
  if (!workspace.library.reservations.length) throw new Error('등록할 예약이 없습니다.')
  const reservations = ids
    ? workspace.library.reservations.filter((item) => ids.includes(item.id))
    : workspace.library.reservations
  if (workspace.jobs.length + reservations.reduce((sum, item) => sum + item.count, 0) > 1000)
    throw new Error('대기열은 1,000작업까지 담을 수 있습니다.')
  // Options are also cloned per job, including those from older backups.
  expansionBudget()(
    workspace.options,
    reservations.reduce((sum, item) => sum + item.count, 0)
  )
  const jobs = expandReservations(
    { ...workspace.library, reservations },
    {
      titlePrefix: workspace.options.filePrefix
    }
  )
  if (workspace.jobs.length + jobs.length > 1000)
    throw new Error('대기열은 1,000작업까지 담을 수 있습니다.')
  // Freeze old unsnapshotted reservations too; importing a new library must
  // never change the material of a job already registered.
  for (const job of jobs) {
    const material = job.composition
    material.reservation.snapshot ??= {
      common: material.common,
      preset: material.preset,
      character: material.character,
      chunks: material.chunks
    }
  }
  return {
    ...workspace,
    library: {
      ...workspace.library,
      reservations: workspace.library.reservations.filter((item) => !reservations.includes(item))
    },
    jobs: [
      ...workspace.jobs,
      ...jobs.map((request) => ({
        request,
        imageCount: request.imageOptions?.batchSize ?? workspace.options.imageCount ?? 0,
        options: structuredClone(workspace.options)
      }))
    ]
  }
}
