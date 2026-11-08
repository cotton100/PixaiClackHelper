import { randomUUID } from 'node:crypto'
import type { LibrarySyncApplyRequest } from '../../shared/pixai/execution'
import type { SyncLibrary } from '../../shared/pixai/library-sync'

interface ApplyBridgeDependencies {
  send(request: LibrarySyncApplyRequest): void
  now?(): number
}

/** Expiry fences an apply that has not started; it cannot cancel a storage write.
 * Keep ownership until the renderer replies or definitively ceases to exist. */
export class LibrarySyncApplyBridge {
  private readonly pending = new Map<string, { resolve(): void; reject(error: Error): void }>()

  constructor(private readonly deps: ApplyBridgeDependencies) {}

  get pendingCount(): number {
    return this.pending.size
  }

  apply(expected: SyncLibrary, next: SyncLibrary): Promise<void> {
    const request: LibrarySyncApplyRequest = {
      id: randomUUID(),
      expiresAt: (this.deps.now?.() ?? Date.now()) + 10_000,
      expected,
      next
    }
    return new Promise<void>((resolve, reject) => {
      this.pending.set(request.id, { resolve, reject })
      try {
        this.deps.send(request)
      } catch {
        this.pending.delete(request.id)
        reject(
          new Error('앱에 저장 요청을 보내지 못했습니다. 화면을 확인한 뒤 다시 동기화해 주세요.')
        )
      }
    })
  }

  /** Call only after desktop.ts has validated the sender and its main frame. */
  reply(value: unknown): { accepted: boolean } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { accepted: false }
    const reply = value as { id?: unknown; ok?: unknown; error?: unknown }
    const pending = typeof reply.id === 'string' ? this.pending.get(reply.id) : undefined
    if (!pending || typeof reply.ok !== 'boolean') return { accepted: false }
    this.pending.delete(reply.id as string)
    if (reply.ok) pending.resolve()
    else
      pending.reject(
        new Error(
          typeof reply.error === 'string'
            ? reply.error.slice(0, 500)
            : '앱 저장을 완료하지 못했습니다.'
        )
      )
    return { accepted: true }
  }

  rendererGone(): void {
    for (const pending of this.pending.values()) {
      pending.reject(
        new Error('앱 화면이 종료되어 저장 확인을 중단했습니다. 다시 연 뒤 동기화해 주세요.')
      )
    }
    this.pending.clear()
  }
}
