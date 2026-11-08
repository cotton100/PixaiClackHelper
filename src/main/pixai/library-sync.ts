import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import {
  canonicalSync,
  mergeSyncLibraries,
  parseSyncLibrary,
  SYNC_COLLECTIONS,
  SYNC_FOLDER_COLLECTIONS,
  type SyncLibrary
} from '../../shared/pixai/library-sync'
import { MAX_WORKSPACE_BYTES } from '../../shared/pixai/expansion-budget'
import type { LibrarySyncStatus, SyncExchange, SyncProposal } from '../../shared/pixai/execution'

export const LIBRARY_SYNC_PORT = 50321
const PREFIX = '/v1/library-sync/'
const CODE_LIFETIME = 5 * 60_000
const BODY_TIMEOUT = 10_000
type Choices = Record<string, 'app' | 'script'>
interface Pending {
  id: string
  phase: 'prepared' | 'outgoing'
  app: SyncLibrary
  script: SyncLibrary
  library: SyncLibrary
  proposal: SyncProposal
}
interface StoredState {
  version: 1
  enabled: boolean
  tokenHash?: string
  baseline?: SyncLibrary
  pending?: Pending
  acknowledged?: { id: string; hash: string }
  lastSyncedAt?: number
}
export interface LibrarySyncDependencies {
  read(): SyncLibrary
  apply(expected: SyncLibrary, next: SyncLibrary): Promise<void>
  readState(): string | null
  writeState(value: string): void
  now?(): number
}
class SyncError extends Error {
  constructor(
    message: string,
    readonly statusCode = 409
  ) {
    super(message)
  }
}
export function syncHash(value: SyncLibrary): string {
  return createHash('sha256').update(canonicalSync(value)).digest('hex')
}
const same = (a: SyncLibrary, b: SyncLibrary): boolean => canonicalSync(a) === canonicalSync(b)
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const count = (value: SyncLibrary): number =>
  SYNC_COLLECTIONS.reduce((total, key) => total + (value[key]?.length ?? 0), 0)
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new SyncError('요청 형식을 확인해 주세요.', 400)
  const raw = value as Record<string, unknown>
  if (Object.keys(raw).some((key) => !keys.includes(key)))
    throw new SyncError('지원하지 않는 요청 항목입니다.', 400)
  return raw
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(value))
    throw new SyncError('동기화 확인 번호가 올바르지 않습니다.', 400)
  return value
}
function equalSecret(value: string, hash: string): boolean {
  const actual = createHash('sha256').update(value).digest()
  const expected = Buffer.from(hash, 'hex')
  return expected.length === actual.length && timingSafeEqual(actual, expected)
}

/** A single serialized controller owns pairing, previews and the durable ack journal.
 * The renderer remains the only writer of the actual workspace. */
export class LibrarySyncServer {
  private stored: StoredState
  private server: Server | undefined
  private sequence: Promise<unknown> = Promise.resolve()
  private code?: { value: string; hash: string; expiresAt: number }
  private pairAttempts: number[] = []
  private snapshot?: SyncLibrary
  private preview?: { proposal: SyncProposal; app: SyncLibrary; script: SyncLibrary }
  private exchangeState: SyncExchange = { state: 'idle' }
  private requested = false
  private lastSeen?: number
  private message?: string
  private corrupt = false
  private materialFolderSupport = false
  constructor(private readonly deps: LibrarySyncDependencies) {
    this.stored = { version: 1, enabled: false }
    try {
      const text = deps.readState()
      if (text) {
        const raw = record(JSON.parse(text), [
          'version',
          'enabled',
          'tokenHash',
          'baseline',
          'pending',
          'acknowledged',
          'lastSyncedAt'
        ]) as unknown as StoredState
        if (
          raw.version !== 1 ||
          typeof raw.enabled !== 'boolean' ||
          (raw.tokenHash !== undefined &&
            (typeof raw.tokenHash !== 'string' || !/^[a-f0-9]{64}$/.test(raw.tokenHash))) ||
          (raw.lastSyncedAt !== undefined &&
            (!Number.isSafeInteger(raw.lastSyncedAt) || raw.lastSyncedAt < 0))
        )
          throw new Error()
        if (raw.baseline) raw.baseline = parseSyncLibrary(raw.baseline)
        if (raw.acknowledged) {
          record(raw.acknowledged, ['id', 'hash'])
          identifier(raw.acknowledged.id)
          if (
            typeof raw.acknowledged.hash !== 'string' ||
            !/^[a-f0-9]{64}$/.test(raw.acknowledged.hash)
          )
            throw new Error()
        }
        if (raw.pending) {
          record(raw.pending, ['id', 'phase', 'app', 'script', 'library', 'proposal'])
          identifier(raw.pending.id)
          if (!raw.tokenHash || !['prepared', 'outgoing'].includes(raw.pending.phase))
            throw new Error()
          raw.pending.app = parseSyncLibrary(raw.pending.app)
          raw.pending.script = parseSyncLibrary(raw.pending.script)
          raw.pending.library = parseSyncLibrary(raw.pending.library)
          // Never expose arbitrary persisted objects through renderer status.
          raw.pending.proposal = {
            id: raw.pending.id,
            library: raw.pending.library,
            conflicts: [],
            initial: !raw.baseline,
            appCount: count(raw.pending.app),
            scriptCount: count(raw.pending.script),
            mergedCount: count(raw.pending.library)
          }
        }
        this.stored = raw
      }
    } catch {
      this.corrupt = true
      this.message =
        '동기화 기록을 열지 못했습니다. 자료는 유지됩니다. 연결 해제 후 새로 연결해 주세요.'
    }
  }
  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }
  private serial<T>(run: () => Promise<T> | T): Promise<T> {
    const task = this.sequence.then(run)
    this.sequence = task.catch(() => {})
    return task
  }
  private persist(next: StoredState): void {
    this.deps.writeState(JSON.stringify(next))
    this.stored = next
  }
  private ready(): void {
    if (this.corrupt) throw new SyncError(this.message!)
    if (!this.stored.enabled || !this.server?.listening)
      throw new SyncError('앱에서 같은 PC 동기화를 먼저 켜 주세요.', 503)
  }
  status(): LibrarySyncStatus {
    const code = this.code && this.code.expiresAt > this.now() ? this.code : undefined
    return clone({
      enabled: this.stored.enabled,
      listening: this.server?.listening ?? false,
      paired: !!this.stored.tokenHash,
      ...(code ? { code: code.value, expiresAt: code.expiresAt } : {}),
      lastSeen: this.lastSeen,
      lastSyncedAt: this.stored.lastSyncedAt,
      exchange: this.exchangeState,
      message: this.message
    })
  }
  async start(): Promise<void> {
    if (this.stored.enabled) await this.listen()
  }
  private async listen(): Promise<void> {
    if (this.server?.listening) return
    const server = createServer((req, res) => {
      void this.receive(req, res)
    })
    server.requestTimeout = BODY_TIMEOUT
    server.headersTimeout = BODY_TIMEOUT
    server.timeout = BODY_TIMEOUT
    server.keepAliveTimeout = 1000
    server.maxHeadersCount = 30
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(LIBRARY_SYNC_PORT, '127.0.0.1', () => {
          server.removeListener('error', reject)
          resolve()
        })
      })
      this.server = server
      this.message = undefined
    } catch {
      server.close()
      this.message =
        '동기화 포트 50321을 열지 못했습니다. 다른 앱의 사용 여부를 확인한 뒤 다시 켜 주세요.'
    }
  }
  async close(): Promise<void> {
    const server = this.server
    this.server = undefined
    if (server)
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
  }
  enable(enabled: boolean): Promise<LibrarySyncStatus> {
    return this.serial(async () => {
      if (typeof enabled !== 'boolean' || this.corrupt)
        throw new SyncError(this.message ?? '설정을 확인해 주세요.')
      this.persist({ ...this.stored, enabled })
      if (enabled) await this.listen()
      else await this.close()
      return this.status()
    })
  }
  newPair(): Promise<LibrarySyncStatus> {
    return this.serial(() => {
      this.ready()
      this.persist({ version: 1, enabled: true })
      this.resetSession()
      const value = randomBytes(24).toString('base64url')
      this.code = {
        value,
        hash: createHash('sha256').update(value).digest('hex'),
        expiresAt: this.now() + CODE_LIFETIME
      }
      return this.status()
    })
  }
  disconnect(): Promise<LibrarySyncStatus> {
    return this.serial(() => {
      this.persist({ version: 1, enabled: this.stored.enabled })
      this.corrupt = false
      this.message = undefined
      this.resetSession()
      return this.status()
    })
  }
  private resetSession(): void {
    this.code = undefined
    this.snapshot = undefined
    this.preview = undefined
    this.requested = false
    this.lastSeen = undefined
    this.exchangeState = { state: 'idle' }
  }
  request(): Promise<LibrarySyncStatus> {
    return this.serial(() => {
      this.ready()
      if (!this.stored.tokenHash) throw new SyncError('스크립트와 먼저 연결해 주세요.')
      // Always wait for a fresh remote snapshot, never approve an old poll snapshot.
      this.requested = true
      this.exchangeState = {
        state: 'blocked',
        message: '스크립트의 최신 자료를 기다리고 있습니다.'
      }
      return this.status()
    })
  }
  approve(id: string, choices: Choices): Promise<LibrarySyncStatus> {
    return this.serial(async () => {
      this.ready()
      await this.approveInner(identifier(id), choices)
      return this.status()
    })
  }
  cancel(id: string): Promise<LibrarySyncStatus> {
    return this.serial(() => {
      this.cancelInner(identifier(id))
      return this.status()
    })
  }
  private cancelInner(id: string): void {
    if (this.stored.pending?.id === id)
      throw new SyncError(
        '저장 확인을 시작한 자료는 취소할 수 없습니다. 새 동기화로 확인해 주세요.'
      )
    if (this.preview?.proposal.id !== id) throw new SyncError('현재 미리보기가 아닙니다.')
    this.preview = undefined
    this.requested = false
    this.exchangeState = { state: 'idle' }
  }
  private makePreview(script: SyncLibrary): SyncProposal {
    const app = parseSyncLibrary(this.deps.read())
    const merged = mergeSyncLibraries(this.stored.baseline ?? null, app, script)
    const proposal: SyncProposal = {
      id: randomUUID(),
      library: merged.library,
      conflicts: merged.conflicts,
      initial: !this.stored.baseline,
      appCount: count(app),
      scriptCount: count(script),
      mergedCount: count(merged.library)
    }
    this.preview = { proposal, app, script }
    this.exchangeState = { state: 'preview', proposal }
    return proposal
  }
  private blocked(message: string): SyncExchange {
    this.exchangeState = { state: 'blocked', message }
    return this.exchangeState
  }
  private requiresMaterialFolderSupport(): boolean {
    return [
      this.deps.read(),
      this.stored.baseline,
      this.stored.pending?.library,
      this.stored.pending?.app,
      this.stored.pending?.script,
      this.preview?.proposal.library
    ].some((library) => library && SYNC_FOLDER_COLLECTIONS.some((key) => library[key]?.length))
  }
  private folderSupportBlock(): SyncExchange | undefined {
    if (!this.materialFolderSupport && this.requiresMaterialFolderSupport())
      return this.blocked(
        '프리셋·공통문 폴더를 보존하려면 스크립트를 0.10.22 이상으로 업데이트한 뒤 다시 동기화해 주세요. 기존 자료는 변경하지 않았습니다.'
      )
    return undefined
  }
  private outgoing(pending: Pending): SyncExchange {
    this.exchangeState = {
      state: 'apply',
      transactionId: pending.id,
      library: pending.library,
      expectedScriptHash: syncHash(pending.script)
    }
    return this.exchangeState
  }
  private async approveInner(id: string, choices: Choices): Promise<SyncExchange> {
    const unsupported = this.folderSupportBlock()
    if (unsupported) return unsupported
    const selected = record(choices, Object.keys(choices ?? {})) as Choices
    if (Object.values(selected).some((value) => !['app', 'script'].includes(value)))
      throw new SyncError('충돌 선택을 확인해 주세요.', 400)
    if (this.stored.acknowledged?.id === id) return { state: 'idle' }
    let pending = this.stored.pending
    if (pending && pending.id !== id)
      throw new SyncError('이전 동기화 확인이 아직 끝나지 않았습니다.')
    if (!pending) {
      const preview = this.preview
      if (!preview || preview.proposal.id !== id)
        throw new SyncError('미리보기가 만료되었습니다. 다시 동기화해 주세요.')
      if (
        !same(this.deps.read(), preview.app) ||
        !this.snapshot ||
        !same(this.snapshot, preview.script)
      ) {
        this.preview = undefined
        return this.blocked('미리보기 이후 자료가 바뀌었습니다. 다시 동기화해 주세요.')
      }
      const merged = mergeSyncLibraries(
        this.stored.baseline ?? null,
        preview.app,
        preview.script,
        selected
      )
      if (merged.conflicts.some((conflict) => !Object.hasOwn(selected, conflict.key)))
        throw new SyncError('모든 충돌 항목을 선택해 주세요.')
      pending = {
        id,
        phase: 'prepared',
        app: preview.app,
        script: preview.script,
        library: merged.library,
        proposal: {
          ...preview.proposal,
          library: merged.library,
          conflicts: [],
          mergedCount: count(merged.library)
        }
      }
      // Write-ahead record closes the crash window between renderer commit and outgoing journal.
      this.persist({ ...this.stored, pending })
    }
    if (pending.phase === 'prepared') {
      const current = this.deps.read()
      if (!same(current, pending.library)) {
        if (!same(current, pending.app))
          return this.blocked('앱 자료가 바뀌었습니다. 다시 동기화해 주세요.')
        try {
          await this.deps.apply(clone(pending.app), clone(pending.library))
        } catch (error) {
          // A lost renderer reply may follow a successful save; inspect persisted projection.
          if (!same(this.deps.read(), pending.library)) {
            this.exchangeState = {
              state: 'blocked',
              proposal: pending.proposal,
              message: error instanceof Error ? error.message : '앱 자료를 반영하지 못했습니다.'
            }
            return this.exchangeState
          }
        }
      }
      if (!same(this.deps.read(), pending.library))
        return this.blocked('앱 저장 결과가 달라 동기화를 멈췄습니다. 다시 동기화해 주세요.')
      pending = { ...pending, phase: 'outgoing' }
      this.persist({ ...this.stored, pending })
      this.preview = undefined
    }
    return this.outgoing(pending)
  }
  private async exchange(
    library: unknown,
    automatic: unknown,
    requestSync: unknown
  ): Promise<SyncExchange> {
    if (
      typeof automatic !== 'boolean' ||
      (requestSync !== undefined && typeof requestSync !== 'boolean')
    )
      throw new SyncError('동기화 요청을 확인해 주세요.', 400)
    const script = parseSyncLibrary(library)
    this.snapshot = script
    this.lastSeen = this.now()
    const requested = requestSync === true || this.requested
    this.requested = false
    let pending = this.stored.pending
    if (pending) {
      // Resume a renderer save whose success reply or following state write was lost.
      if (pending.phase === 'prepared' && same(this.deps.read(), pending.library)) {
        pending = { ...pending, phase: 'outgoing' }
        this.persist({ ...this.stored, pending })
      }
      if (
        pending.phase === 'outgoing' &&
        (same(script, pending.script) || same(script, pending.library))
      )
        return this.outgoing(pending)
      if (!requested)
        return this.blocked(
          '전송 중 자료가 변경됐거나 앱 반영이 보류됐습니다. 다시 동기화해 확인해 주세요.'
        )
      // Explicit resync abandons only the unacknowledged transfer; baseline stays unchanged.
      this.persist({ ...this.stored, pending: undefined })
      this.preview = undefined
      this.makePreview(script)
      return this.exchangeState
    }
    if (
      this.preview &&
      (!same(this.preview.script, script) || !same(this.preview.app, this.deps.read()))
    ) {
      this.preview = undefined
      if (!requested)
        return this.blocked('미리보기 이후 자료가 바뀌었습니다. 다시 동기화해 주세요.')
    }
    if (this.preview && !requested) return this.exchangeState
    if (!requested && (!automatic || !this.stored.baseline)) return this.exchangeState
    const app = this.deps.read()
    if (
      this.stored.baseline &&
      same(app, this.stored.baseline) &&
      same(script, this.stored.baseline)
    ) {
      this.preview = undefined
      this.exchangeState = { state: 'idle' }
      return this.exchangeState
    }
    const proposal = this.makePreview(script)
    if (!requested && automatic && this.stored.baseline && !proposal.conflicts.length)
      return this.approveInner(proposal.id, {})
    return this.exchangeState
  }
  private acknowledge(id: string, library: unknown): SyncExchange {
    const saved = parseSyncLibrary(library)
    if (this.stored.acknowledged?.id === id && this.stored.acknowledged.hash === syncHash(saved))
      return { state: 'idle' }
    const pending = this.stored.pending
    if (
      !pending ||
      pending.id !== id ||
      pending.phase !== 'outgoing' ||
      !same(saved, pending.library)
    )
      throw new SyncError('동기화 저장 확인이 일치하지 않습니다.')
    this.persist({
      ...this.stored,
      baseline: pending.library,
      pending: undefined,
      acknowledged: { id, hash: syncHash(saved) },
      lastSyncedAt: this.now()
    })
    this.exchangeState = { state: 'idle' }
    return this.exchangeState
  }
  private auth(req: IncomingMessage): void {
    const auth = req.headers.authorization
    if (
      !this.stored.tokenHash ||
      typeof auth !== 'string' ||
      !/^Bearer [a-zA-Z0-9_-]{43}$/.test(auth) ||
      !equalSecret(auth.slice(7), this.stored.tokenHash)
    )
      throw new SyncError('연결 인증이 만료되었습니다.', 401)
  }
  private pair(value: unknown): { token: string } {
    this.pairAttempts = this.pairAttempts.filter((time) => time > this.now() - 60_000)
    if (this.pairAttempts.length >= 5)
      throw new SyncError('잠시 후 연결 코드를 다시 입력해 주세요.', 429)
    this.pairAttempts.push(this.now())
    if (
      typeof value !== 'string' ||
      value.length > 128 ||
      !this.code ||
      this.code.expiresAt <= this.now() ||
      !equalSecret(value, this.code.hash)
    )
      throw new SyncError('연결 코드가 만료되었거나 일치하지 않습니다.', 401)
    const token = randomBytes(32).toString('base64url')
    this.persist({ ...this.stored, tokenHash: createHash('sha256').update(token).digest('hex') })
    this.code = undefined
    return { token }
  }
  private async body(req: IncomingMessage): Promise<unknown> {
    const length = req.headers['content-length']
    if (length && (!/^\d+$/.test(length) || Number(length) > MAX_WORKSPACE_BYTES))
      throw new SyncError('동기화 자료가 허용 용량을 넘었습니다.', 413)
    return new Promise((resolve, reject) => {
      let bytes = 0
      const chunks: Buffer[] = []
      const timer = setTimeout(() => {
        reject(new SyncError('동기화 요청 시간이 초과되었습니다.', 408))
        req.destroy()
      }, BODY_TIMEOUT)
      const fail = (error: Error): void => {
        clearTimeout(timer)
        reject(error)
      }
      req.on('error', fail)
      req.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > MAX_WORKSPACE_BYTES) {
          fail(new SyncError('동기화 자료가 허용 용량을 넘었습니다.', 413))
          req.pause()
        } else chunks.push(chunk)
      })
      req.on('end', () => {
        clearTimeout(timer)
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch {
          reject(new SyncError('JSON 요청 형식을 확인해 주세요.', 400))
        }
      })
    })
  }
  private async receive(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.once('finish', () => {
      if (!req.complete) req.destroy()
    })
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Connection', 'close')
    try {
      if (
        req.socket.remoteAddress !== '127.0.0.1' ||
        req.headers.host !== `127.0.0.1:${LIBRARY_SYNC_PORT}`
      )
        throw new SyncError('허용되지 않은 주소입니다.', 403)
      if (req.method !== 'POST') throw new SyncError('POST 요청만 지원합니다.', 405)
      const action = req.url?.startsWith(PREFIX) ? req.url.slice(PREFIX.length) : ''
      if (!['pair', 'exchange', 'approve', 'ack', 'cancel'].includes(action))
        throw new SyncError('지원하지 않는 경로입니다.', 404)
      const origin = req.headers.origin
      if (origin !== undefined && (origin !== 'https://pixai.art' || action === 'pair'))
        throw new SyncError('웹사이트의 연결 요청은 허용하지 않습니다.', 403)
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? ''))
        throw new SyncError('JSON 요청만 지원합니다.', 415)
      this.ready()
      if (action !== 'pair') this.auth(req)
      const input = await this.body(req)
      const result = await this.serial(async () => {
        this.ready()
        if (action !== 'pair') this.auth(req) // disconnect/re-pair may have happened while reading
        const raw = record(
          input,
          action === 'pair'
            ? ['code']
            : action === 'exchange'
              ? ['library', 'automatic', 'requestSync']
              : action === 'approve'
                ? ['id', 'choices']
                : action === 'ack'
                  ? ['id', 'library']
                  : ['id']
        )
        if (action === 'pair') return this.pair(raw.code)
        if (['exchange', 'approve', 'ack'].includes(action)) {
          this.materialFolderSupport =
            req.headers['x-pixai-library-features'] === 'material-folders-v1'
          const unsupported = this.folderSupportBlock()
          if (unsupported) return unsupported
        }
        if (action === 'exchange') return this.exchange(raw.library, raw.automatic, raw.requestSync)
        if (action === 'approve')
          return this.approveInner(identifier(raw.id), raw.choices as Choices)
        if (action === 'ack') return this.acknowledge(identifier(raw.id), raw.library)
        this.cancelInner(identifier(raw.id))
        return this.exchangeState
      })
      res.end(JSON.stringify(result))
    } catch (error) {
      res.statusCode = error instanceof SyncError ? error.statusCode : 400
      res.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : '동기화 요청을 처리하지 못했습니다.'
        })
      )
    }
  }
}
