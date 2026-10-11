import { describe, expect, it } from 'vitest'
import {
  composePrompts,
  expandReservations,
  makeSettingsBackup,
  normalizeBatchPlan,
  normalizeLibrary,
  parseSettingsBackup,
  batchCellKey,
  batchRowKey,
  exportForScript
} from '../src/shared/pixai/library'
import {
  appendBatchReservations,
  expandBatchPlan,
  makeSceneCard,
  refreshSceneCard
} from '../src/shared/pixai/batch-reserve'

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const chunk = (
  id: string,
  prompt: string
): { id: string; name: string; prompt: string; negativePrompt: string } => ({
  id,
  name: id.toUpperCase(),
  prompt,
  negativePrompt: `bad ${id}`
})
// A1·A2·A3(캐릭터 Alice의 복장 버전) × B1·B2(Bob) 식으로 행을 만들 수 있게 출연을 둔다.
const seed = (): Record<string, unknown> => ({
  version: 1,
  common: { prompt: 'quality', negativePrompt: 'lowres' },
  presets: [
    {
      id: 'p1',
      name: 'Base',
      model: { id: '1', versionId: '101', name: 'M' },
      loras: [{ id: '22', versionId: '222', name: 'L', weight: 0.5, triggerWords: 'trig' }]
    },
    { id: 'p2', name: 'Alt', model: { id: '1', versionId: '102', name: 'M2' }, loras: [] }
  ],
  characters: [
    { id: 'c1', name: 'Alice', prompt: 'alice', negativePrompt: '', defaultPresetId: 'p1' },
    { id: 'c2', name: 'Bob', prompt: 'bob', negativePrompt: '' },
    { id: 'c3', name: 'Cara', prompt: 'cara', negativePrompt: '', defaultPresetId: 'p1' }
  ],
  scenes: [chunk('s1', 'smile'), chunk('s2', 'wave'), chunk('s3', 'angry'), chunk('s4', 'cry')],
  reservations: [],
  sceneFolders: [{ id: 'f1', name: '표정' }],
  sceneCards: [
    {
      id: 'sc1',
      name: '웃음·손',
      sceneIds: ['s1', 's2'],
      chunks: [chunk('s1', 'smile'), chunk('s2', 'wave')],
      folderId: 'f1'
    },
    { id: 'sc2', name: '분노', sceneIds: ['s3'], chunks: [chunk('s3', 'angry')] },
    {
      id: 'sc3',
      name: '울음',
      sceneIds: ['s4'],
      chunks: [chunk('s4', 'cry')],
      imageOptions: { aspectRatio: '5:3', size: '1k' },
      extra: { prompt: 'rain', negativePrompt: 'sun' },
      triggerPosition: 'end'
    }
  ],
  casts: [
    {
      id: 'A2',
      name: 'Alice · 겨울복',
      characterId: 'c1',
      presetId: 'p2',
      extra: { prompt: 'winter coat', negativePrompt: '' }
    },
    {
      id: 'A3',
      name: 'Alice · 수영복',
      characterId: 'c1',
      presetId: 'p1',
      extra: { prompt: 'swimsuit', negativePrompt: '' }
    }
  ]
})
const plan = (): Record<string, unknown> => ({
  id: 'plan1',
  name: '',
  rows: [
    { kind: 'character', id: 'c1' },
    { kind: 'cast', id: 'A2' },
    { kind: 'cast', id: 'A3' },
    { kind: 'character', id: 'c2', presetId: 'p2' }
  ],
  columns: ['sc1', 'sc2', 'sc3'],
  count: 2,
  exceptions: { 'character:c1|sc2': 0, 'cast:A3|sc3': 3 },
  order: 'byRow'
})
let seq = 0
const ids = (): string => `id-${++seq}`

describe('characters × scenes batch reservations', () => {
  it('expands rows × columns in checklist order with per-cell exceptions; both orders give the same multiset', () => {
    seq = 0
    const out = expandBatchPlan(seed(), plan(), {
      idFactory: ids,
      batchSize: 4,
      batchId: 'b1',
      now: Date.UTC(2026, 9, 10, 5, 2)
    })
    expect(out.problems).toEqual([])
    // A1(c1): sc1 2 + sc2 0 + sc3 2 = 4 / A2: 6 / A3: 2+2+3 = 7 / B1(c2): 6 → 23 jobs, 11 pairs
    expect(out.totals).toEqual({ pairs: 11, jobs: 23, images: 92, batchSize: 4 })
    expect(out.order.map((item) => `${item.rowKey}|${item.columnId}:${item.count}`)).toEqual([
      'character:c1|sc1:2',
      'character:c1|sc3:2',
      'cast:A2|sc1:2',
      'cast:A2|sc2:2',
      'cast:A2|sc3:2',
      'cast:A3|sc1:2',
      'cast:A3|sc2:2',
      'cast:A3|sc3:3',
      'character:c2|sc1:2',
      'character:c2|sc2:2',
      'character:c2|sc3:2'
    ])
    const first = out.reservations[0]
    expect({
      preset: first.presetId,
      character: first.characterId,
      scenes: first.sceneIds,
      count: first.count,
      batch: first.batch
    }).toEqual({
      preset: 'p1',
      character: 'c1',
      scenes: ['s1', 's2'],
      count: 2,
      batch: { id: 'b1', name: out.batch.name, rowName: 'Alice', columnName: '웃음·손' }
    })
    expect(out.reservations[2]).toMatchObject({
      presetId: 'p2',
      characterId: 'c1',
      batch: { rowName: 'Alice · 겨울복' }
    })
    expect(out.reservations[8]).toMatchObject({ presetId: 'p2', characterId: 'c2' })
    expect(out.batch.name).toMatch(/^캐릭터 4 × 씬 3 · \d{2}-\d{2} \d{2}:\d{2}$/)
    const byColumn = expandBatchPlan(
      seed(),
      { ...plan(), order: 'byColumn' },
      { idFactory: ids, batchSize: 4 }
    )
    expect(byColumn.order.map((item) => item.columnId)).toEqual([
      'sc1',
      'sc1',
      'sc1',
      'sc1',
      'sc2',
      'sc2',
      'sc2',
      'sc3',
      'sc3',
      'sc3',
      'sc3'
    ])
    const sortKey = (item: { rowKey: string; columnId: string }): string =>
      `${item.rowKey}|${item.columnId}`
    expect([...out.order].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))).toEqual(
      [...byColumn.order].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
    )
    expect(expandBatchPlan(seed(), plan(), { batchSize: 1 }).totals.images).toBe(23)
    expect(expandBatchPlan(seed(), plan(), { batchSize: 0 }).totals.batchSize).toBe(4)
  })

  it('a character row without a preset is an error: nothing is expanded and nothing is appended', () => {
    const library = seed()
    const before = copy(library)
    const out = expandBatchPlan(
      library,
      { ...plan(), rows: [{ kind: 'character', id: 'c2' }] },
      { idFactory: ids }
    )
    expect(out.reservations).toEqual([])
    expect(out.problems).toHaveLength(1)
    expect(out.problems[0]).toMatchObject({ level: 'error', rowKey: 'character:c2' })
    expect(out.problems[0].message).toMatch(/Bob.*프리셋/)
    expect(() => appendBatchReservations(library, out)).toThrow(/해결할 조합/)
    expect(library).toEqual(before)
    expect(
      expandBatchPlan(library, { ...plan(), rows: [{ kind: 'cast', id: 'nope' }] }).problems[0]
        .message
    ).toMatch(/출연 nope/)
    const deletedPreset = copy(library) as { presets: { id: string }[] }
    deletedPreset.presets = deletedPreset.presets.filter((item) => item.id !== 'p1')
    expect(
      expandBatchPlan(deletedPreset, { ...plan(), rows: [{ kind: 'character', id: 'c1' }] })
        .problems[0].message
    ).toMatch(/프리셋 p1/)
  })

  it('a missing scene card is an error; a broken chunk link is a warning and the stored copy is used', () => {
    const out = expandBatchPlan(
      seed(),
      { ...plan(), columns: ['sc1', 'ghost'] },
      { idFactory: ids }
    )
    expect(out.reservations).toEqual([])
    expect(out.problems.find((item) => item.level === 'error')?.message).toMatch(/씬 ghost/)
    const library = seed() as { scenes: { id: string }[] }
    library.scenes = library.scenes.filter((item) => item.id !== 's2')
    const warned = expandBatchPlan(
      library,
      { ...plan(), rows: [{ kind: 'character', id: 'c1' }], columns: ['sc1'] },
      { idFactory: ids }
    )
    expect(warned.problems).toEqual([
      expect.objectContaining({ level: 'warning', columnId: 'sc1' })
    ])
    expect(warned.problems[0].message).toMatch(/s2.*사본/)
    expect(warned.reservations[0].snapshot?.chunks.map((item) => item.prompt)).toEqual([
      'smile',
      'wave'
    ])
    const appended = appendBatchReservations(library, warned)
    const [job] = expandReservations(appended, { idFactory: ids })
    expect(job.prompt).toBe('quality, trig, alice, smile, wave')
  })

  it('image settings and trigger position follow scene > plan > nothing; absent values add no field', () => {
    const out = expandBatchPlan(
      seed(),
      { ...plan(), rows: [{ kind: 'character', id: 'c1' }], exceptions: {} },
      { idFactory: ids }
    )
    const [sc1, sc2, sc3] = out.reservations
    expect('imageOptions' in sc1).toBe(false)
    expect('imageOptions' in sc2).toBe(false)
    expect(sc3.imageOptions).toEqual({ aspectRatio: '5:3', size: '1k' })
    expect('triggerPosition' in sc1).toBe(false)
    expect(sc3.triggerPosition).toBe('end')
    const planned = expandBatchPlan(
      seed(),
      {
        ...plan(),
        rows: [{ kind: 'character', id: 'c1' }],
        exceptions: {},
        imageOptions: { aspectRatio: '3:5', size: '1.5k' }
      },
      { idFactory: ids }
    )
    expect(planned.reservations[0].imageOptions).toEqual({ aspectRatio: '3:5', size: '1.5k' })
    expect(planned.reservations[2].imageOptions).toEqual({ aspectRatio: '5:3', size: '1k' })
    const jobs = expandReservations(appendBatchReservations(seed(), planned), { idFactory: ids })
    expect(jobs[0].imageOptions).toEqual({ aspectRatio: '3:5', size: '1.5k' })
    expect(jobs[0].composition.reservation.batch?.rowName).toBe('Alice')
  })

  it('cast text lands after the character and scene text after the chunks; without extras the prompt is unchanged', () => {
    const library = normalizeLibrary(seed())
    const [preset] = library.presets
    const [character] = library.characters
    const chunks = [library.scenes[0]]
    const plain = composePrompts(library.common, character, chunks, preset, 1)
    expect(plain).toEqual({
      prompt: 'quality, trig, alice, smile',
      negativePrompt: 'lowres, bad s1'
    })
    expect(composePrompts(library.common, character, chunks, preset, 1, {})).toEqual(plain)
    const extras = {
      cast: { prompt: 'winter coat', negativePrompt: 'summer' },
      scene: { prompt: 'rain', negativePrompt: 'sun' }
    }
    expect(composePrompts(library.common, character, chunks, preset, 1, extras)).toEqual({
      prompt: 'quality, trig, alice, winter coat, smile, rain',
      negativePrompt: 'lowres, summer, bad s1, sun'
    })
    expect(composePrompts(library.common, character, chunks, preset, 'end', extras).prompt).toBe(
      'quality, alice, winter coat, smile, rain, trig'
    )
    expect(composePrompts(library.common, character, chunks, preset, 3, extras).prompt).toBe(
      'quality, alice, winter coat, smile, trig, rain'
    )
    const out = expandBatchPlan(
      seed(),
      { ...plan(), rows: [{ kind: 'cast', id: 'A2' }], columns: ['sc3'], exceptions: {} },
      { idFactory: ids }
    )
    expect(out.reservations[0].snapshot?.extras).toEqual({
      cast: { prompt: 'winter coat', negativePrompt: '' },
      scene: { prompt: 'rain', negativePrompt: 'sun' }
    })
    const [job] = expandReservations(appendBatchReservations(seed(), out), { idFactory: ids })
    expect(job.prompt).toBe('quality, alice, winter coat, cry, rain')
    expect(job.negativePrompt).toBe('lowres, bad s4, sun')
  })

  it('appending is all-or-nothing and respects the 1,000 job cap', () => {
    const library = seed()
    const out = expandBatchPlan(library, plan(), { idFactory: ids, batchId: 'b9' })
    const next = appendBatchReservations(library, out)
    expect(next.reservations).toHaveLength(11)
    expect(next.reservations.every((item) => item.batch?.id === 'b9')).toBe(true)
    expect((library as { reservations: unknown[] }).reservations).toHaveLength(0)
    expect(() => appendBatchReservations(library, { ...out, reservations: [] })).toThrow(
      /예약할 조합이 없습니다/
    )
    const full = copy(library) as { reservations: unknown[] }
    full.reservations = [
      { id: 'r', presetId: 'p1', characterId: 'c1', sceneIds: ['s1'], count: 100 },
      { id: 'r2', presetId: 'p1', characterId: 'c1', sceneIds: ['s1'], count: 100 }
    ]
    const huge = expandBatchPlan(
      full,
      { ...plan(), count: 100, exceptions: {} },
      { idFactory: ids }
    )
    expect(huge.totals.jobs).toBe(1200)
    expect(() => appendBatchReservations(full, huge)).toThrow(/1,000개/)
    expect(normalizeLibrary(full).reservations).toHaveLength(2)
  })

  it('new collections round-trip through normalization and backups; a script-era library gains no keys; script export drops app-only data', () => {
    const library = normalizeLibrary(seed())
    expect(Object.keys(library).sort()).toEqual([
      'casts',
      'characters',
      'chunkFolders',
      'common',
      'presets',
      'reservations',
      'sceneCards',
      'sceneFolders',
      'scenes',
      'version'
    ])
    const old = normalizeLibrary({
      version: 1,
      common: { prompt: '', negativePrompt: '' },
      presets: [],
      characters: [{ id: 'c', name: 'C', prompt: '', negativePrompt: '' }],
      scenes: [],
      reservations: []
    })
    expect(Object.keys(old).sort()).toEqual([
      'characters',
      'chunkFolders',
      'common',
      'presets',
      'reservations',
      'scenes',
      'version'
    ])
    expect('defaultPresetId' in old.characters[0]).toBe(false)
    const withPlan = {
      ...seed(),
      batchPlans: [{ ...plan(), name: '표정 세트' }],
      reservations: expandBatchPlan(seed(), plan(), { idFactory: ids, batchId: 'b2' }).reservations
    }
    const backup = makeSettingsBackup(
      withPlan,
      { maxCredits: null, filePrefix: '', repeat: 1 },
      { appVersion: 'pixais-0.1', exportedAt: '2026-10-10T00:00:00.000Z' }
    )
    const parsed = parseSettingsBackup(JSON.stringify(backup))
    expect(parsed.library).toEqual(normalizeLibrary(withPlan))
    expect(parsed.library.batchPlans?.[0].name).toBe('표정 세트')
    expect(parsed.library.reservations[0].batch?.id).toBe('b2')
    for (const broken of [
      {
        ...seed(),
        sceneCards: [{ id: 'x', name: 'x', sceneIds: ['s1'], chunks: [chunk('s2', 'wave')] }]
      },
      { ...seed(), casts: [{ id: 'x', name: 'x', characterId: 'c1' }] },
      {
        ...seed(),
        sceneCards: [
          { id: 'x', name: 'x', sceneIds: ['s1'], chunks: [chunk('s1', 'smile')], folderId: 'nope' }
        ]
      },
      {
        ...seed(),
        sceneCards: [
          { id: 'x', name: 'x', sceneIds: ['s1'], chunks: [chunk('s1', 'smile')], apiKey: 'k' }
        ]
      }
    ]) {
      expect(() =>
        makeSettingsBackup(
          broken,
          { maxCredits: null, filePrefix: '', repeat: 1 },
          { appVersion: 'x', exportedAt: '2026-10-10T00:00:00.000Z' }
        )
      ).toThrow()
    }
    // 스크립트용 내보내기: 앱 전용 키와 추가 문구가 든 예약은 빠지고, 그 사실을 알려 준다.
    const forScript = exportForScript(withPlan)
    expect(Object.keys(forScript.library).sort()).toEqual([
      'characters',
      'chunkFolders',
      'common',
      'presets',
      'reservations',
      'scenes',
      'version'
    ])
    expect(forScript.library.reservations.every((item) => !('batch' in item))).toBe(true)
    expect(forScript.library.characters.every((item) => !('defaultPresetId' in item))).toBe(true)
    expect(forScript.dropped.reservations).toBe(8) // 출연 문구(A2·A3 각 3) + 씬 문구(sc3: A1·B1)
    expect(forScript.dropped.keys).toEqual([
      'sceneFolders',
      'sceneCards',
      'casts',
      'batchPlans',
      'characters.defaultPresetId',
      'reservations.batch'
    ])
    const scriptBackup = makeSettingsBackup(
      withPlan,
      { maxCredits: null, filePrefix: '', repeat: 1 },
      { appVersion: 'pixais-0.1', exportedAt: '2026-10-10T00:00:00.000Z' },
      'script'
    )
    expect(Object.keys(scriptBackup.library).sort()).toEqual([
      'characters',
      'chunkFolders',
      'common',
      'presets',
      'reservations',
      'scenes',
      'version'
    ])
  })

  it('batch plans reject unknown kinds, orders, malformed exception keys and counts outside 0~100; stale exceptions are dropped', () => {
    expect(normalizeBatchPlan(plan()).order).toBe('byRow')
    expect(normalizeBatchPlan({ ...plan(), order: undefined }).order).toBe('byRow')
    for (const bad of [
      { ...plan(), rows: [{ kind: 'preset', id: 'p1' }] },
      { ...plan(), order: 'random' },
      { ...plan(), exceptions: { nopipe: 1 } },
      { ...plan(), exceptions: { 'character:c1|sc1': 101 } },
      { ...plan(), count: 0 },
      {
        ...plan(),
        rows: [
          { kind: 'character', id: 'c1' },
          { kind: 'character', id: 'c1' }
        ]
      },
      { ...plan(), columns: ['sc1', 'sc1'] },
      { ...plan(), secret: 'x' }
    ]) {
      expect(() => normalizeBatchPlan(bad), JSON.stringify(bad).slice(0, 60)).toThrow()
    }
    expect(batchCellKey(batchRowKey({ kind: 'cast', id: 'A2' }), 'sc3')).toBe('cast:A2|sc3')
    expect(
      normalizeBatchPlan({
        ...plan(),
        exceptions: { 'character:zz|sc1': 1, 'character:c1|zz': 5, 'character:c1|sc2': 0 }
      }).exceptions
    ).toEqual({ 'character:c1|sc2': 0 })
  })

  it('makeSceneCard snapshots live chunks with an automatic name and never stores a character; refresh only reports differences', () => {
    seq = 0
    const card = makeSceneCard(
      seed(),
      { sceneIds: ['s2', 's1'], imageOptions: { aspectRatio: '16:9', size: '1k' } },
      { idFactory: ids }
    )
    expect(card).toEqual({
      id: 'id-1',
      name: 'S2 · S1',
      sceneIds: ['s2', 's1'],
      chunks: [chunk('s2', 'wave'), chunk('s1', 'smile')],
      imageOptions: { aspectRatio: '16:9', size: '1k' }
    })
    expect(JSON.stringify(card).includes('alice')).toBe(false)
    expect(() => makeSceneCard(seed(), { sceneIds: ['s1', 'zz'] })).toThrow(/zz/)
    expect(() => makeSceneCard(seed(), { sceneIds: [] })).toThrow(/하나 이상/)
    expect(
      makeSceneCard(seed(), { name: ' 내 씬 ', sceneIds: ['s1'], folderId: 'f1' })
    ).toMatchObject({ name: '내 씬', folderId: 'f1' })
    const library = seed() as { scenes: { id: string; prompt: string }[] }
    library.scenes[0].prompt = 'big smile'
    library.scenes = library.scenes.filter((item) => item.id !== 's2')
    const refreshed = refreshSceneCard(library, 'sc1')
    expect(refreshed.changes).toEqual([
      { id: 's1', field: 'prompt', before: 'smile', after: 'big smile' }
    ])
    expect(refreshed.missing).toEqual(['s2'])
    expect(refreshed.card.chunks.map((item) => item.prompt)).toEqual(['big smile', 'wave'])
    expect(normalizeLibrary(library).sceneCards?.[0].chunks[0].prompt).toBe('smile')
    expect(() => refreshSceneCard(library, 'nope')).toThrow(/갱신할 씬/)
  })
})
