import { expect, it } from 'vitest'
import {
  defaultQueueFilters,
  matchesQueueFilters,
  queueDateError,
  queueItems,
  type QueueItem
} from '../src/renderer/src/pixai/queue-filters'
import { createPixaiStore, emptyWorkspace, readWorkspace } from '../src/renderer/src/pixai/store'
import { pixaiLibrary } from './fixtures/pixai-workspace'
import { buildPayload, type ExecutionJob } from '../src/shared/pixai/execution'

const now = new Date(2026, 9, 16, 12)
function item(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: 'job',
    title: 'test',
    prompt: 'test',
    ratio: '5:3',
    images: 4,
    character: { key: 'id:c1', name: 'Alice' },
    scene: { key: 'id:sc1', name: '웃음' },
    preset: { key: 'id:p1', name: '모델' },
    state: 'done',
    at: now.getTime(),
    dateKind: 'registered',
    ...overrides
  }
}
it('defaults to seven local calendar days inclusive, with every unfinished state outside the date range', () => {
  const filters = defaultQueueFilters()
  expect(matchesQueueFilters(item({ at: new Date(2026, 9, 10).getTime() }), filters, now)).toBe(
    true
  )
  expect(
    matchesQueueFilters(item({ at: new Date(2026, 9, 9, 23, 59, 59).getTime() }), filters, now)
  ).toBe(false)
  expect(matchesQueueFilters(item({ at: new Date(2026, 9, 17).getTime() }), filters, now)).toBe(
    false
  )
  for (const state of [
    'queued',
    'submitting',
    'submission_unknown',
    'waiting',
    'saving',
    'check_required',
    'save_failed',
    'failed'
  ] as const)
    expect(matchesQueueFilters(item({ state, at: 1 }), filters, now), state).toBe(true)
  expect(matchesQueueFilters(item({ state: 'cancelled', at: 1 }), filters, now)).toBe(false)
  expect(matchesQueueFilters(item({ at: undefined, dateKind: 'unknown' }), filters, now)).toBe(true)
})
it('combines all entity/ratio filters and exempts unfinished jobs only from the date condition', () => {
  const filters = {
    ...defaultQueueFilters(),
    character: 'id:c1',
    scene: 'id:sc1',
    preset: 'id:p1',
    ratio: '5:3'
  }
  expect(matchesQueueFilters(item(), filters, now)).toBe(true)
  for (const key of ['character', 'scene', 'preset', 'ratio'] as const)
    expect(
      matchesQueueFilters(
        item({ state: 'waiting', at: 1 }),
        { ...filters, [key]: 'different' },
        now
      )
    ).toBe(false)
})
it('custom dates include the entire end day, reject invalid or reversed ranges, and allow explicit all dates', () => {
  const filters = {
    ...defaultQueueFilters(),
    date: 'custom' as const,
    from: '2026-10-01',
    to: '2026-10-02'
  }
  expect(
    matchesQueueFilters(item({ at: new Date(2026, 9, 2, 23, 59, 59).getTime() }), filters, now)
  ).toBe(true)
  expect(matchesQueueFilters(item({ at: new Date(2026, 9, 3).getTime() }), filters, now)).toBe(
    false
  )
  expect(queueDateError({ ...filters, to: '2026-09-30' })).not.toBe('')
  expect(queueDateError({ ...filters, from: '2026-02-30' })).not.toBe('')
  expect(matchesQueueFilters(item({ at: 1 }), { ...filters, date: 'all' }, now)).toBe(true)
})
it('persists registration time and filters frozen material after current library changes or deletion', async () => {
  let saved = JSON.stringify({ ...emptyWorkspace(), library: pixaiLibrary() })
  const store = createPixaiStore({
    read: async () => saved,
    write: async (value) => {
      saved = value
    }
  })
  await store.getState().hydrate()
  await store.getState().reserve(
    {
      id: 'plan',
      name: 'batch',
      rows: [{ kind: 'character', id: 'c1' }],
      columns: ['sc1'],
      count: 1,
      exceptions: {},
      order: 'byRow'
    },
    true
  )
  const original = store.getState().workspace.jobs[0]
  expect(original.registeredAt).toBeGreaterThan(0)
  const restored = readWorkspace(saved)
  expect(restored.jobs[0].registeredAt).toBe(original.registeredAt)
  restored.library.characters = []
  restored.library.presets = []
  restored.library.sceneCards = []
  const entry = queueItems(restored, [])[0]
  expect(entry).toMatchObject({
    at: original.registeredAt,
    dateKind: 'registered',
    character: { key: 'id:c1', name: 'Alice' },
    preset: { key: 'id:p1', name: '기본 모델' },
    scene: { key: 'id:sc1', name: '웃음' }
  })
  delete restored.jobs[0].registeredAt
  expect(readWorkspace(JSON.stringify(restored)).jobs[0].registeredAt).toBeUndefined()
  expect(queueItems(restored, [])[0].dateKind).toBe('unknown')
})
it('uses legacy update dates only as a fallback and keeps orphaned resumable records reachable', async () => {
  const store = createPixaiStore({ read: async () => null, write: async () => {} })
  await store.getState().hydrate()
  await store.getState().commit((workspace) => ({ ...workspace, library: pixaiLibrary() }))
  await store.getState().reserve(
    {
      id: 'plan',
      name: 'batch',
      rows: [{ kind: 'character', id: 'c1' }],
      columns: ['sc1'],
      count: 1,
      exceptions: {},
      order: 'byRow'
    },
    true
  )
  const workspace = readWorkspace(JSON.stringify(store.getState().workspace))
  const job = workspace.jobs[0]
  delete job.registeredAt
  const record: ExecutionJob = {
    id: job.request.id,
    title: job.request.title,
    payload: buildPayload(job, 42),
    state: 'done',
    outputDir: '/synthetic',
    files: [],
    error: '',
    updatedAt: now.getTime()
  }
  const legacy = queueItems(workspace, [record])[0]
  expect(legacy).toMatchObject({ at: now.getTime(), dateKind: 'updated' })
  expect(matchesQueueFilters(legacy, defaultQueueFilters(), now)).toBe(true)
  record.registeredAt = 1
  const registered = queueItems(workspace, [record])[0]
  expect(registered).toMatchObject({ at: 1, dateKind: 'registered' })
  expect(matchesQueueFilters(registered, defaultQueueFilters(), now)).toBe(false)
  const orphan = queueItems(emptyWorkspace(), [{ ...record, state: 'save_failed' }])[0]
  expect(orphan).toMatchObject({
    id: job.request.id,
    state: 'save_failed',
    character: { key: 'none' },
    preset: { key: 'none' }
  })
  expect(matchesQueueFilters(orphan, defaultQueueFilters(), now)).toBe(true)
  expect(matchesQueueFilters(orphan, { ...defaultQueueFilters(), character: 'id:c1' }, now)).toBe(
    false
  )
})
