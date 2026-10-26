import { describe, expect, it, vi } from 'vitest'
import {
  composePrompts,
  DEFAULT_BATCH_PROMPT_ORDER,
  expandReservations,
  exportForScript,
  makeSettingsBackup,
  normalizeBatchPlan,
  normalizeBatchPromptOrder,
  normalizeSnapshot,
  parseSettingsBackup,
  strictLibrary,
  type BatchPlan,
  type BatchPromptBlock,
  type Library,
  type TriggerPosition
} from '../src/shared/pixai/library'
import { appendBatchReservations, expandBatchPlan } from '../src/shared/pixai/batch-reserve'
import { buildPayload } from '../src/shared/pixai/execution'
import { pixaiLibrary } from './fixtures/pixai-workspace'

function fixture(): { library: Library; plan: BatchPlan } {
  const library = pixaiLibrary()
  library.common = { prompt: 'global', negativePrompt: 'bad-global' }
  library.presets[0].prompt = 'preset'
  library.presets[0].negativePrompt = 'bad-preset'
  library.characters[0].negativePrompt = 'bad-alice'
  library.scenes[0].negativePrompt = 'bad-smile'
  library.scenes[1].negativePrompt = 'bad-wave'
  library.scenes[2].negativePrompt = 'bad-angry'
  library.chunkFolders = [{ id: 'folder', name: '추가' }]
  library.scenes[2].folderId = 'folder'
  library.sceneCards![0] = {
    ...library.sceneCards![0],
    sceneIds: ['s1', 's2'],
    chunks: library.scenes.slice(0, 2).map((chunk) => ({ ...chunk })),
    extra: { prompt: 'scene-extra', negativePrompt: 'bad-scene-extra' }
  }
  library.casts = [
    {
      id: 'cast',
      name: 'Alice coat',
      characterId: 'c1',
      presetId: 'p1',
      extra: { prompt: 'coat', negativePrompt: 'bad-coat' }
    }
  ]
  const plan: BatchPlan = {
    id: 'plan',
    name: '구성',
    rows: [{ kind: 'cast', id: 'cast' }],
    columns: ['sc1'],
    count: 1,
    exceptions: {},
    order: 'byRow',
    extraChunkIds: ['s3']
  }
  return { library, plan }
}

const permutations: BatchPromptBlock[][] = [
  ['character', 'scene', 'extraChunks'],
  ['character', 'extraChunks', 'scene'],
  ['scene', 'character', 'extraChunks'],
  ['scene', 'extraChunks', 'character'],
  ['extraChunks', 'character', 'scene'],
  ['extraChunks', 'scene', 'character']
]
const orderedText = [
  [
    'alice, coat, smile, wave, scene-extra, angry',
    'bad-alice, bad-coat, bad-smile, bad-wave, bad-scene-extra, bad-angry'
  ],
  [
    'alice, coat, angry, smile, wave, scene-extra',
    'bad-alice, bad-coat, bad-angry, bad-smile, bad-wave, bad-scene-extra'
  ],
  [
    'smile, wave, scene-extra, alice, coat, angry',
    'bad-smile, bad-wave, bad-scene-extra, bad-alice, bad-coat, bad-angry'
  ],
  [
    'smile, wave, scene-extra, angry, alice, coat',
    'bad-smile, bad-wave, bad-scene-extra, bad-angry, bad-alice, bad-coat'
  ],
  [
    'angry, alice, coat, smile, wave, scene-extra',
    'bad-angry, bad-alice, bad-coat, bad-smile, bad-wave, bad-scene-extra'
  ],
  [
    'angry, smile, wave, scene-extra, alice, coat',
    'bad-angry, bad-smile, bad-wave, bad-scene-extra, bad-alice, bad-coat'
  ]
]

describe('batch extra chunks and prompt block order', () => {
  it.each(permutations.map((order, index) => ({ order, text: orderedText[index] })))(
    'assembles both prompts in $order order, keeping cast and scene extras in their blocks',
    ({ order, text }) => {
      const { library, plan } = fixture()
      const expansion = expandBatchPlan(library, { ...plan, promptOrder: order })
      expect(expansion.problems).toEqual([])
      const [request] = expandReservations(appendBatchReservations(library, expansion))
      expect(request.prompt).toBe(`global, preset, trigger, ${text[0]}`)
      expect(request.negativePrompt).toBe(`bad-global, bad-preset, ${text[1]}`)
      expect(request.composition.reservation.snapshot?.promptOrder).toEqual(order)
    }
  )

  it.each<[{ position: TriggerPosition; expected: string }]>([
    [
      {
        position: 0,
        expected: 'trigger, global, preset, angry, smile, wave, scene-extra, alice, coat'
      }
    ],
    [
      {
        position: 1,
        expected: 'global, preset, trigger, angry, smile, wave, scene-extra, alice, coat'
      }
    ],
    [
      {
        position: 2,
        expected: 'global, preset, angry, smile, wave, scene-extra, alice, coat, trigger'
      }
    ],
    [
      {
        position: 3,
        expected: 'global, preset, angry, smile, trigger, wave, scene-extra, alice, coat'
      }
    ],
    [
      {
        position: 4,
        expected: 'global, preset, angry, smile, wave, trigger, scene-extra, alice, coat'
      }
    ],
    [
      {
        position: 'end',
        expected: 'global, preset, angry, smile, wave, scene-extra, alice, coat, trigger'
      }
    ]
  ])(
    'keeps trigger $position anchored to its material after reordering',
    ({ position, expected }) => {
      const { library, plan } = fixture()
      library.sceneCards![0].triggerPosition = position
      const out = expandBatchPlan(library, {
        ...plan,
        promptOrder: ['extraChunks', 'scene', 'character']
      })
      const [request] = expandReservations(appendBatchReservations(library, out))
      expect(request.prompt).toBe(expected)
    }
  )

  it.each<[{ position: TriggerPosition; expected: string }]>([
    [{ position: 0, expected: 'trigger, global, preset, alice, coat, smile, wave, scene-extra' }],
    [{ position: 1, expected: 'global, preset, trigger, alice, coat, smile, wave, scene-extra' }],
    [{ position: 2, expected: 'global, preset, alice, coat, trigger, smile, wave, scene-extra' }],
    [{ position: 3, expected: 'global, preset, alice, coat, smile, trigger, wave, scene-extra' }],
    [{ position: 4, expected: 'global, preset, alice, coat, smile, wave, trigger, scene-extra' }],
    [
      {
        position: 'end',
        expected: 'global, preset, alice, coat, smile, wave, scene-extra, trigger'
      }
    ]
  ])('preserves legacy output and shape at trigger $position', ({ position, expected }) => {
    const { library, plan } = fixture()
    delete plan.extraChunkIds
    library.sceneCards![0].triggerPosition = position
    const out = expandBatchPlan(library, plan)
    expect(out.plan).not.toHaveProperty('extraChunkIds')
    expect(out.plan).not.toHaveProperty('promptOrder')
    expect(out.reservations[0].snapshot).not.toHaveProperty('extraChunks')
    expect(out.reservations[0].snapshot).not.toHaveProperty('promptOrder')
    const [request] = expandReservations(appendBatchReservations(library, out))
    expect(request.prompt).toBe(expected)
    expect(request.negativePrompt).toBe(
      'bad-global, bad-preset, bad-alice, bad-coat, bad-smile, bad-wave, bad-scene-extra'
    )
  })

  it('keeps the old six-argument API compatible with empty materials and multiple triggers', () => {
    const preset = {
      loras: [
        { id: 'one', name: '', weight: 1, triggerWords: ' first ' },
        { id: 'two', name: '', weight: 1, triggerWords: 'second' }
      ]
    }
    const blank = { prompt: '', negativePrompt: '' }
    expect(
      composePrompts(blank, blank, [], preset, 2, {
        scene: { prompt: 'rain', negativePrompt: 'sun' }
      })
    ).toEqual({ prompt: 'first, second, rain', negativePrompt: 'sun' })
    expect(
      composePrompts(blank, blank, [], preset, 'end', {
        scene: { prompt: 'rain', negativePrompt: 'sun' }
      })
    ).toEqual({ prompt: 'rain, first, second', negativePrompt: 'sun' })
  })

  it('adds the selected chunks to every pair without multiplying jobs or mutating scene cards', () => {
    const { library, plan } = fixture()
    plan.rows.push({ kind: 'character', id: 'c2' })
    plan.columns.push('sc2')
    plan.extraChunkIds = ['s3', 's1']
    plan.count = 2
    const original = structuredClone(library)
    const out = expandBatchPlan(library, plan, { batchSize: 4 })
    expect(out.totals).toEqual({ pairs: 4, jobs: 8, images: 32, batchSize: 4 })
    expect(out.reservations).toHaveLength(4)
    for (const reservation of out.reservations) {
      expect(reservation.snapshot?.extraChunks?.map((chunk) => chunk.id)).toEqual(['s3', 's1'])
      expect(reservation.sceneIds).toEqual(reservation.snapshot?.chunks.map((chunk) => chunk.id))
      expect(reservation.snapshot?.extraChunks?.[0]).not.toHaveProperty('folderId')
    }
    expect(library).toEqual(original)
    expect(out.reservations[0].snapshot?.extraChunks).not.toBe(
      out.reservations[1].snapshot?.extraChunks
    )
  })

  it('allows a scene copy and the current extra chunk to share an ID, with a warning', () => {
    const { library, plan } = fixture()
    library.scenes[0].prompt = 'updated-smile'
    plan.extraChunkIds = ['s1']
    const out = expandBatchPlan(library, plan)
    expect(out.problems).toEqual([
      expect.objectContaining({ level: 'warning', message: expect.stringContaining('두 번 포함') })
    ])
    expect(out.reservations).toHaveLength(1)
    expect(expandReservations(appendBatchReservations(library, out))[0].prompt).toBe(
      'global, preset, trigger, alice, coat, smile, wave, scene-extra, updated-smile'
    )
  })

  it('fails the whole batch when a selected additional chunk was deleted', () => {
    const { library, plan } = fixture()
    plan.extraChunkIds = ['s3', 'deleted']
    const out = expandBatchPlan(library, plan)
    expect(out.reservations).toEqual([])
    expect(out.problems).toContainEqual({
      level: 'error',
      message: '선택한 추가 청크가 없습니다: deleted'
    })
    expect(() => appendBatchReservations(library, out)).toThrow('deleted')
  })

  it('freezes extra text and order through edit, deletion, backup and API payload assembly', () => {
    const { library, plan } = fixture()
    plan.promptOrder = ['extraChunks', 'scene', 'character']
    const out = expandBatchPlan(library, plan)
    const reserved = appendBatchReservations(library, out)
    const [before] = expandReservations(reserved)
    library.scenes[2].prompt = 'changed'
    plan.promptOrder.reverse()
    reserved.scenes = []
    reserved.chunkFolders = []
    reserved.sceneCards = []
    reserved.presets = []
    reserved.characters = []
    const backup = makeSettingsBackup(
      reserved,
      { maxCredits: null, filePrefix: '', repeat: 1 },
      { appVersion: 'test', exportedAt: '2026-10-26T00:00:00.000Z' }
    )
    const restored = parseSettingsBackup(JSON.stringify(backup)).library
    const [after] = expandReservations(restored)
    expect(after.prompt).toBe(before.prompt)
    expect(after.negativePrompt).toBe(before.negativePrompt)
    expect(after.composition.reservation.snapshot).toEqual(before.composition.reservation.snapshot)
    const payload = buildPayload(
      { request: after, imageCount: 4, options: { maxCredits: null, filePrefix: '', repeat: 1 } },
      1
    )
    expect(payload.prompt).toBe(before.prompt)
    expect(payload.negativePrompt).toBe(before.negativePrompt)
    expect(payload.loras[0].triggerWords).toBe('')
  })

  it('bounds additional text before allocating multiplied snapshots', () => {
    const { library, plan } = fixture()
    library.scenes[2].prompt = 'x'.repeat(100_000)
    plan.count = 100
    const idFactory = vi.fn(() => 'must-not-run')
    expect(() => expandBatchPlan(library, plan, { idFactory })).toThrow('너무 큽니다')
    expect(idFactory).not.toHaveBeenCalled()
  })

  it.each([
    { order: null },
    { order: [] },
    { order: ['character', 'scene'] },
    { order: ['character', 'scene', 'scene'] },
    { order: ['character', 'scene', 'unknown'] }
  ])('rejects malformed block order $order in plans and snapshots', ({ order }) => {
    const { library, plan } = fixture()
    expect(() => normalizeBatchPromptOrder(order)).toThrow('문구 순서')
    expect(() => normalizeBatchPlan({ ...plan, promptOrder: order })).toThrow('문구 순서')
    const snapshot = expandBatchPlan(library, plan).reservations[0].snapshot!
    expect(() => normalizeSnapshot({ ...snapshot, promptOrder: order })).toThrow('문구 순서')
  })

  it('strictly validates extra chunk IDs and keeps the added optional fields in app libraries', () => {
    const { library, plan } = fixture()
    expect(() => normalizeBatchPlan({ ...plan, extraChunkIds: ['s3', 's3'] })).toThrow('중복')
    expect(() => normalizeBatchPlan({ ...plan, extraChunkIds: 's3' })).toThrow('목록 형식')
    expect(() => normalizeBatchPlan({ ...plan, extraChunkIds: [''] })).toThrow()
    plan.promptOrder = ['scene', 'extraChunks', 'character']
    const reserved = appendBatchReservations(library, expandBatchPlan(library, plan))
    reserved.batchPlans = [plan]
    const strict = strictLibrary(reserved)
    expect(strict.batchPlans).toEqual([plan])
    expect(strict.reservations[0].snapshot?.promptOrder).toEqual(plan.promptOrder)
    const snapshot = strict.reservations[0].snapshot!
    expect(() =>
      normalizeSnapshot({
        ...snapshot,
        extraChunks: [snapshot.extraChunks![0], snapshot.extraChunks![0]]
      })
    ).toThrow('중복')
    expect(() => normalizeSnapshot({ ...snapshot, extraChunks: null })).toThrow('목록 형식')
  })

  it('omits unsupported reservations from script backups and strips harmless default metadata', () => {
    const library = pixaiLibrary()
    const plan: BatchPlan = {
      id: 'plan',
      name: '',
      rows: [{ kind: 'character', id: 'c1' }],
      columns: ['sc1'],
      count: 1,
      exceptions: {},
      order: 'byRow'
    }
    let id = 0
    const reserved = appendBatchReservations(
      library,
      expandBatchPlan(library, plan, { idFactory: () => `r${++id}` })
    )
    const legacy = structuredClone(reserved.reservations[0])
    reserved.reservations = [
      legacy,
      {
        ...structuredClone(legacy),
        id: 'extra',
        snapshot: { ...legacy.snapshot!, extraChunks: [library.scenes[1]] }
      },
      {
        ...structuredClone(legacy),
        id: 'reordered',
        snapshot: { ...legacy.snapshot!, promptOrder: ['scene', 'character', 'extraChunks'] }
      },
      {
        ...structuredClone(legacy),
        id: 'default',
        snapshot: {
          ...legacy.snapshot!,
          extraChunks: [],
          promptOrder: [...DEFAULT_BATCH_PROMPT_ORDER]
        }
      }
    ]
    const exported = exportForScript(reserved)
    expect(exported.dropped.reservations).toBe(2)
    expect(exported.dropped.keys).toEqual(
      expect.arrayContaining([
        'reservations.snapshot.extraChunks',
        'reservations.snapshot.promptOrder'
      ])
    )
    expect(exported.library.reservations.map((reservation) => reservation.id)).toEqual([
      legacy.id,
      'default'
    ])
    for (const reservation of exported.library.reservations) {
      expect(reservation.snapshot).not.toHaveProperty('extraChunks')
      expect(reservation.snapshot).not.toHaveProperty('promptOrder')
    }
    expect(expandReservations(exported.library).map((request) => request.prompt)).toEqual([
      'quality, trigger, alice, smile',
      'quality, trigger, alice, smile'
    ])
  })
})
