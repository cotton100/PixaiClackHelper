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
    const rebuilt = expandReservations(library, { idFactory: () => request.id })[0]
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
    widths
  }
}

interface PixaiState {
  workspace: Workspace
  ready: boolean
  busy: boolean
  error: string
  revision: number
  hydrate(): Promise<void>
  commit(update: (workspace: Workspace) => Workspace): Promise<void>
  editLibrary(update: (library: Library) => Library): Promise<void>
  importBackup(backup: SettingsBackup, expectedRevision: number): Promise<void>
  reserve(plan: BatchPlan): Promise<BatchExpansion>
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
  return create<PixaiState>((set, get) => ({
    workspace: emptyWorkspace(),
    ready: false,
    busy: false,
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
        const next = update(structuredClone(get().workspace))
        next.library = strictLibrary(next.library)
        next.options = normalizeSettingsOptions(next.options)
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
    editLibrary: (update) =>
      get().commit((workspace) => ({ ...workspace, library: update(workspace.library) })),
    importBackup: (backup, expectedRevision) =>
      get().commit((workspace) => {
        if (get().revision !== expectedRevision)
          throw new Error('미리보기 후 자료가 바뀌었습니다. 파일을 다시 골라 확인해 주세요.')
        return { ...workspace, library: backup.library, options: backup.options }
      }),
    reserve: async (plan) => {
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
        return { ...workspace, library: appendBatchReservations(workspace.library, expansion) }
      })
      return expansion!
    },
    register: () =>
      get().commit((workspace) => {
        if (!workspace.library.reservations.length) throw new Error('등록할 예약이 없습니다.')
        const jobs = expandReservations(workspace.library, {
          titlePrefix: workspace.options.filePrefix
        })
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
          library: { ...workspace.library, reservations: [] },
          jobs: [
            ...workspace.jobs,
            ...jobs.map((request) => ({
              request,
              imageCount: request.imageOptions?.batchSize ?? workspace.options.imageCount ?? 0,
              options: structuredClone(workspace.options)
            }))
          ]
        }
      })
  }))
}
export const usePixaiStore = createPixaiStore()
export type PixaiStore = ReturnType<typeof createPixaiStore>
