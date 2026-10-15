import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { PixaiInvokeMap } from '../../shared/pixai/execution'

const WORKSPACE_KEY = 'pixais.workspace.v1'
type WorkspaceRead = PixaiInvokeMap['pixai:workspace-read']['res']
type WorkspaceWrite = PixaiInvokeMap['pixai:workspace-write']['res']

function revision(value: string | null): string {
  // Hash the nullable string, not parsed JSON: null and an empty row differ,
  // and changes made by older apps/tools need no additional revision column.
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function readWorkspace(db: Database.Database): WorkspaceRead {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(WORKSPACE_KEY) as
    { value: string } | undefined
  const value = row?.value ?? null
  return { value, revision: revision(value) }
}

export function assertWorkspaceRevision(db: Database.Database, expectedRevision: unknown): void {
  if (
    typeof expectedRevision !== 'string' ||
    !/^[a-f0-9]{64}$/.test(expectedRevision) ||
    readWorkspace(db).revision !== expectedRevision
  )
    throw new Error('WORKSPACE_CONFLICT: 저장된 자료가 바뀌었습니다. 최신 자료를 다시 읽어 주세요.')
}

export function writeWorkspace(db: Database.Database, request: unknown): WorkspaceWrite {
  const req = request as Partial<PixaiInvokeMap['pixai:workspace-write']['req']> | null
  if (typeof req?.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(req.expectedRevision))
    throw new Error('작업 공간 변경 확인 정보가 없습니다. 앱을 다시 열어 주세요.')
  if (typeof req.value !== 'string' || Buffer.byteLength(req.value) > 20 * 1024 * 1024)
    throw new Error('설정 용량을 확인해 주세요.')
  try {
    JSON.parse(req.value)
  } catch {
    throw new Error('작업 공간 저장 형식을 확인해 주세요.')
  }
  const { value, expectedRevision } = req as PixaiInvokeMap['pixai:workspace-write']['req']
  return db
    .transaction((): WorkspaceWrite => {
      // BEGIN IMMEDIATE keeps another connection from writing between this read
      // and the update. A separate SELECT followed by an UPDATE would still race.
      if (readWorkspace(db).revision !== expectedRevision) return { saved: false }
      db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).run(WORKSPACE_KEY, value)
      return { saved: true, revision: revision(value) }
    })
    .immediate()
}
