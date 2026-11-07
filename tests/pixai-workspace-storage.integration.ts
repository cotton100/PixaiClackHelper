import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, expect, it } from 'vitest'
import {
  assertWorkspaceRevision,
  readWorkspace,
  writeWorkspace
} from '../src/main/pixai/workspace-storage'
import { appendBatchReservations, expandBatchPlan } from '../src/shared/pixai/batch-reserve'
import { expandReservations } from '../src/shared/pixai/library'
import { buildPayload } from '../src/shared/pixai/execution'
import { emptyWorkspace, readWorkspace as restoreWorkspace } from '../src/renderer/src/pixai/store'
import { pixaiLibrary } from './fixtures/pixai-workspace'

const key = 'pixais.workspace.v1'
let directory: string
let reader: Database.Database
let external: Database.Database
const raw = (db = reader): unknown =>
  db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
const replace = (value: string, db = external): void => {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'pixais-workspace-cas-'))
  const path = join(directory, 'fixture.db')
  reader = new Database(path)
  reader.pragma('journal_mode = WAL')
  reader.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  external = new Database(path, { timeout: 0 })
})
afterEach(() => {
  external.close()
  reader.close()
  rmSync(directory, { recursive: true, force: true })
})

it('refuses stale A after another connection writes B and leaves every row unchanged', () => {
  replace('{"fixture":"A"}')
  const a = readWorkspace(reader)
  replace('{"fixture":"B"}')
  external.prepare('INSERT INTO settings VALUES (?, ?)').run('fixture.other', 'untouched')
  const before = external.prepare('SELECT * FROM settings ORDER BY key').all()
  expect(
    writeWorkspace(reader, { value: '{"fixture":"A-edited"}', expectedRevision: a.revision })
  ).toEqual({ saved: false })
  expect(external.prepare('SELECT * FROM settings ORDER BY key').all()).toEqual(before)
  expect(readWorkspace(reader).value).toBe('{"fixture":"B"}')
})

it('returns the committed revision so queued writes can advance without an extra read', () => {
  const initial = readWorkspace(reader)
  expect(initial.value).toBeNull()
  const first = writeWorkspace(reader, {
    value: '{"fixture":1}',
    expectedRevision: initial.revision
  })
  expect(first.saved).toBe(true)
  if (!first.saved) throw new Error('Expected save')
  expect(first.revision).not.toBe(initial.revision)
  expect(first.revision).toBe(readWorkspace(external).revision)
  expect(
    writeWorkspace(reader, { value: '{"fixture":2}', expectedRevision: first.revision }).saved
  ).toBe(true)
  expect(
    writeWorkspace(reader, { value: '{"fixture":3}', expectedRevision: first.revision })
  ).toEqual({ saved: false })
  expect(raw(external)).toEqual({ value: '{"fixture":2}' })
})

it('does not recreate a deleted workspace using the revision read before deletion', () => {
  replace('{"fixture":"before deletion"}')
  const before = readWorkspace(reader)
  external.prepare('DELETE FROM settings WHERE key = ?').run(key)
  expect(writeWorkspace(reader, { value: '{}', expectedRevision: before.revision })).toEqual({
    saved: false
  })
  expect(raw()).toBeUndefined()
  const missing = readWorkspace(reader)
  expect(writeWorkspace(reader, { value: '{}', expectedRevision: missing.revision }).saved).toBe(
    true
  )
})

it('rejects stale or missing revisions before generation is allowed to start', () => {
  replace('{"fixture":"current jobs"}')
  const snapshot = readWorkspace(reader)
  expect(() => assertWorkspaceRevision(reader, snapshot.revision)).not.toThrow()
  replace('{"fixture":"external jobs"}')
  for (const expected of [snapshot.revision, undefined, null, '', 123])
    expect(() => assertWorkspaceRevision(reader, expected)).toThrow(/^WORKSPACE_CONFLICT:/)
  expect(raw()).toEqual({ value: '{"fixture":"external jobs"}' })
})

it('distinguishes an absent row from an empty row and preserves the raw serialized value', () => {
  const absent = readWorkspace(reader)
  replace('')
  const empty = readWorkspace(reader)
  expect(empty.value).toBe('')
  expect(empty.revision).not.toBe(absent.revision)
  expect(writeWorkspace(reader, { value: '{}', expectedRevision: absent.revision })).toEqual({
    saved: false
  })
  replace('{ "fixture": 1 }')
  const spaced = readWorkspace(reader)
  replace('{"fixture":1}')
  expect(readWorkspace(reader).revision).not.toBe(spaced.revision)
})

it('rejects missing or malformed revisions, invalid JSON and oversized UTF-8 without disclosures or writes', () => {
  replace('{"fixture":"original"}')
  const before = readWorkspace(reader)
  for (const request of [
    undefined,
    null,
    {},
    { value: '{}' },
    { value: '{}', expectedRevision: 'bad' },
    { value: '{}', expectedRevision: 1 },
    { value: '{}', expectedRevision: 'A'.repeat(64) },
    { value: 'private-fixture-invalid-json', expectedRevision: before.revision },
    { value: '"' + '가'.repeat(7 * 1024 * 1024) + '"', expectedRevision: before.revision }
  ]) {
    expect(() => writeWorkspace(reader, request)).toThrow()
    try {
      writeWorkspace(reader, request)
    } catch (error) {
      expect(String(error)).not.toContain('private-fixture')
    }
    expect(readWorkspace(reader)).toEqual(before)
  }
})

it('holds the SQLite writer lock until the matching workspace update has committed', () => {
  replace('{"fixture":"A"}')
  const before = readWorkspace(reader)
  let attempted = false
  reader.function('competing_fixture_write', () => {
    attempted = true
    expect(() => replace('{"fixture":"competing"}')).toThrow(/locked/)
    return 0
  })
  reader.exec(`CREATE TRIGGER compete BEFORE UPDATE ON settings
    BEGIN SELECT competing_fixture_write(); END`)
  expect(
    writeWorkspace(reader, { value: '{"fixture":"saved"}', expectedRevision: before.revision })
      .saved
  ).toBe(true)
  expect(attempted).toBe(true)
  expect(raw(external)).toEqual({ value: '{"fixture":"saved"}' })
  replace('{"fixture":"after commit"}')
  expect(raw()).toEqual({ value: '{"fixture":"after commit"}' })
})

it('preserves character LoRAs and frozen batch jobs through a real database reopen and API assembly', () => {
  const source = pixaiLibrary()
  source.characters[0].loras = [
    { id: '31', name: 'Character fixture', versionId: '310', weight: 0.7, triggerWords: 'hero' }
  ]
  let sequence = 0
  const idFactory = (): string => `fixture-${++sequence}`
  const expansion = expandBatchPlan(
    source,
    {
      id: 'plan',
      name: 'Fixture batch',
      rows: [{ kind: 'character', id: 'c1' }],
      columns: ['sc1'],
      count: 1,
      exceptions: {},
      order: 'byRow'
    },
    { idFactory }
  )
  expect(expansion.problems).toEqual([])
  const library = appendBatchReservations(source, expansion)
  const [request] = expandReservations(library, { idFactory })
  const options = { maxCredits: null, filePrefix: '', repeat: 1, imageCount: 4 }
  const job = { request, imageCount: 4, options }
  const expectedPayload = buildPayload(job, 7)

  // The editable character changes after reservation; only future work should see this edit.
  library.characters[0].loras![0].weight = 0.9
  library.characters[0].loras![0].triggerWords = 'new-hero'
  const workspace = { ...emptyWorkspace(), library, options, jobs: [job] }
  const before = readWorkspace(reader)
  const saved = writeWorkspace(reader, {
    value: JSON.stringify(workspace),
    expectedRevision: before.revision
  })
  expect(saved.saved).toBe(true)
  reader.close()
  reader = new Database(join(directory, 'fixture.db'))
  const persisted = readWorkspace(reader)
  if (!saved.saved) throw new Error('Expected save')
  expect(persisted.revision).toBe(saved.revision)
  const restored = restoreWorkspace(persisted.value)

  expect(restored.library.characters[0].loras).toEqual(library.characters[0].loras)
  expect(restored.library.reservations[0].snapshot!.preset.loras).toEqual([
    source.presets[0].loras[0],
    { id: '31', name: 'Character fixture', versionId: '310', weight: 0.7, triggerWords: 'hero' }
  ])
  expect(restored.library.reservations[0].snapshot!.character).not.toHaveProperty('loras')
  expect(restored.jobs[0].request.composition.character).not.toHaveProperty('loras')
  expect(buildPayload(restored.jobs[0], 7)).toEqual(expectedPayload)
  expect(expectedPayload).toMatchObject({
    prompt: 'quality, trigger, hero, alice, smile',
    loras: [
      { modelId: '200', weight: 0.5, triggerWords: '' },
      { modelId: '310', weight: 0.7, triggerWords: '' }
    ]
  })
})
