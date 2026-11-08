import { describe, expect, it } from 'vitest'
import { pixaiLibrary } from './fixtures/pixai-workspace'
import {
  composePrompts,
  expandReservations,
  exportForScript,
  makeSettingsBackup,
  normalizeMaterialOrder,
  parseSettingsBackup,
  strictLibrary,
  type MaterialOrderItem,
  type Reservation
} from '../src/shared/pixai/library'
import {
  backupSelection,
  freezeReservation,
  makeTransferBackup,
  parseTransferBackup,
  prepareBackupImport
} from '../src/shared/pixai/backup-transfer'
import { createPixaiStore, emptyWorkspace } from '../src/renderer/src/pixai/store'
import { applySyncLibrary, projectSyncLibrary } from '../src/shared/pixai/library-sync'
import { buildPayload } from '../src/shared/pixai/execution'

const common = { prompt: 'global', negativePrompt: 'bad-global' }
const character = { prompt: 'character', negativePrompt: 'bad-character' }
const chunks = [
  { prompt: 'first', negativePrompt: 'bad-first' },
  { prompt: 'second', negativePrompt: 'bad-second' }
]
const preset = {
  prompt: 'preset',
  negativePrompt: 'bad-preset',
  loras: [{ id: '10', name: 'Lora', weight: 0.5, triggerWords: 'trigger' }]
}
const extras = {
  cast: { prompt: 'cast', negativePrompt: 'bad-cast' },
  scene: { prompt: 'scene-extra', negativePrompt: 'bad-scene-extra' }
}
const order: MaterialOrderItem[] = ['chunk:s1', 'common', 'chunk:s2', 'character']
const sceneIds = ['s1', 's2']
const meta = { appVersion: 'test', exportedAt: '2026-11-08T00:00:00.000Z' }
const options = emptyWorkspace().options

function reservation(): Reservation {
  return {
    id: 'r1',
    presetId: 'p1',
    characterId: 'c1',
    sceneIds: [...sceneIds],
    count: 1,
    materialOrder: [...order],
    triggerPosition: 1
  }
}

describe('full composition material order', () => {
  it('requires an exact permutation and agrees with the ordered chunk ID list', () => {
    expect(normalizeMaterialOrder(undefined, sceneIds)).toEqual([
      'common',
      'character',
      'chunk:s1',
      'chunk:s2'
    ])
    expect(normalizeMaterialOrder(order, sceneIds)).toEqual(order)
    for (const value of [
      null,
      ['common', 'character'],
      ['common', 'common', 'chunk:s1', 'chunk:s2'],
      ['common', 'character', 'chunk:s2', 'chunk:s1'],
      ['common', 'character', 'chunk:s1', 'chunk:unknown'],
      [...order, 'triggers']
    ])
      expect(() => normalizeMaterialOrder(value, sceneIds)).toThrow('재료 순서')
  })

  it.each([
    [0, 'trigger, first, global, preset, second, character, cast, scene-extra'],
    [1, 'first, global, preset, trigger, second, character, cast, scene-extra'],
    [2, 'first, global, preset, second, character, cast, trigger, scene-extra'],
    [3, 'first, trigger, global, preset, second, character, cast, scene-extra'],
    [4, 'first, global, preset, second, trigger, character, cast, scene-extra'],
    ['end', 'first, global, preset, second, character, cast, scene-extra, trigger']
  ] as const)(
    'keeps trigger anchor %s while moving chunks ahead of common and character',
    (anchor, prompt) => {
      const composed = composePrompts(common, character, chunks, preset, anchor, extras, {
        materialOrder: order,
        sceneIds
      })
      expect(composed.prompt).toBe(prompt)
      expect(composed.negativePrompt).toBe(
        'bad-first, bad-global, bad-preset, bad-second, bad-character, bad-cast, bad-scene-extra'
      )
    }
  )

  it('keeps the legacy default output byte-identical for every trigger anchor', () => {
    for (const position of [0, 1, 2, 3, 4, 'end'] as const) {
      expect(
        composePrompts(common, character, chunks, preset, position, extras, {
          materialOrder: normalizeMaterialOrder(undefined, sceneIds),
          sceneIds
        })
      ).toEqual(composePrompts(common, character, chunks, preset, position, extras))
    }
    expect(
      composePrompts(
        common,
        character,
        [],
        preset,
        'end',
        {},
        {
          materialOrder: ['character', 'common'],
          sceneIds: []
        }
      ).prompt
    ).toBe('character, global, preset, trigger')
  })

  it('rejects ambiguous batch block order or missing chunk IDs instead of dropping an order', () => {
    expect(() =>
      composePrompts(common, character, chunks, preset, 1, {}, { materialOrder: order })
    ).toThrow('청크 ID')
    expect(() =>
      composePrompts(
        common,
        character,
        chunks,
        preset,
        1,
        {},
        {
          materialOrder: order,
          sceneIds,
          promptOrder: ['character', 'scene', 'extraChunks']
        }
      )
    ).toThrow('동시에')
    const library = pixaiLibrary()
    library.reservations = [freezeReservation(library, reservation())]
    library.reservations[0].snapshot!.promptOrder = ['character', 'scene', 'extraChunks']
    expect(() => strictLibrary(library)).toThrow('동시에')
  })

  it('keeps full backups, recent/favorites, frozen reservations and queued jobs through restart', async () => {
    const library = pixaiLibrary()
    library.reservations = [freezeReservation(library, reservation())]
    library.combinations = [
      { ...reservation(), id: 'favorite', favorite: true, name: 'saved order', at: 1 }
    ]
    const full = makeSettingsBackup(library, options, meta)
    expect(parseSettingsBackup(JSON.stringify(full)).library).toEqual(strictLibrary(library))
    let saved = JSON.stringify({ ...emptyWorkspace(), library })
    const storage = {
      read: async () => saved,
      write: async (text: string) => {
        saved = text
      }
    }
    const store = createPixaiStore(storage)
    await store.getState().hydrate()
    const before = expandReservations(library)[0]
    await store.getState().register()
    await store.getState().editLibrary((current) => ({
      ...current,
      common: { prompt: 'changed common', negativePrompt: 'changed negative' },
      scenes: current.scenes.map((chunk) => ({ ...chunk, prompt: 'changed chunk' }))
    }))
    const restart = createPixaiStore(storage)
    await restart.getState().hydrate()
    expect(restart.getState().error).toBe('')
    const restored = restart.getState().workspace
    expect(restored.jobs[0].request.composition.reservation.materialOrder).toEqual(order)
    expect(restored.library.combinations?.[0].materialOrder).toEqual(order)
    expect(restored.jobs[0].request.prompt).toBe(before.prompt)
    expect(restored.jobs[0].request.negativePrompt).toBe(before.negativePrompt)
    expect(buildPayload(restored.jobs[0], 42)).toMatchObject({
      prompt: before.prompt,
      negativePrompt: before.negativePrompt
    })
    expect(before.prompt).toBe('smile, quality, trigger, wave, alice')
  })

  it('remaps chunk tokens alongside IDs when appending selected reservations and favorites', () => {
    const source = pixaiLibrary()
    source.reservations = [freezeReservation(source, reservation())]
    source.combinations = [
      { ...reservation(), id: 'favorite', favorite: true, name: 'saved order', at: 1 }
    ]
    const selection = { ...backupSelection(false), reservations: true, combinations: true }
    const transfer = parseTransferBackup(
      JSON.stringify(makeTransferBackup(source, options, selection, meta))
    )
    let sequence = 0
    const result = prepareBackupImport(
      pixaiLibrary(),
      transfer,
      selection,
      'append',
      () => `new-${++sequence}`
    ).library
    for (const item of [...result.reservations, ...result.combinations!]) {
      expect(item.sceneIds).not.toEqual(sceneIds)
      expect(item.materialOrder).toEqual([
        `chunk:${item.sceneIds[0]}`,
        'common',
        `chunk:${item.sceneIds[1]}`,
        'character'
      ])
    }
    expect(expandReservations(result)[0].prompt).toBe(expandReservations(source)[0].prompt)
    expect(result.reservations[0].snapshot?.chunks.map((chunk) => chunk.id)).toEqual(
      result.reservations[0].sceneIds
    )
  })

  it('retains local custom reservations and history while syncing only library materials', () => {
    const source = pixaiLibrary()
    source.reservations = [reservation()]
    source.combinations = [
      { ...reservation(), id: 'favorite', favorite: true, name: 'saved order', at: 1 }
    ]
    const incoming = pixaiLibrary()
    incoming.common.prompt = 'incoming common'
    incoming.scenes[0].prompt = 'incoming first'
    const result = applySyncLibrary(source, projectSyncLibrary(incoming))
    expect(result.reservations[0].materialOrder).toEqual(order)
    expect(result.combinations?.[0].materialOrder).toEqual(order)
    expect(expandReservations(result)[0].prompt).toBe(expandReservations(source)[0].prompt)
    expect(projectSyncLibrary(result)).not.toHaveProperty('reservations')
    expect(projectSyncLibrary(result)).not.toHaveProperty('combinations')
  })

  it('explicitly excludes custom-order reservations and favorites from legacy export but keeps default order', () => {
    const source = pixaiLibrary()
    source.reservations = [
      reservation(),
      {
        ...reservation(),
        id: 'default',
        materialOrder: normalizeMaterialOrder(undefined, sceneIds)
      }
    ]
    source.combinations = source.reservations.map((item) => ({
      ...item,
      id: `comb-${item.id}`,
      favorite: true,
      name: 'saved',
      at: 1
    }))
    const result = exportForScript(source)
    expect(result.dropped.reservations).toBe(1)
    expect(result.dropped.combinationsWithMaterialOrder).toBe(1)
    expect(result.dropped.keys).toEqual(
      expect.arrayContaining(['reservations.materialOrder', 'combinations.materialOrder'])
    )
    expect(result.library.reservations.map((item) => item.id)).toEqual(['default'])
    expect(result.library.combinations?.map((item) => item.id)).toEqual(['comb-default'])
    expect(result.library.reservations[0]).not.toHaveProperty('materialOrder')
    expect(result.library.combinations?.[0]).not.toHaveProperty('materialOrder')
    expect(strictLibrary(result.library)).toEqual(result.library)
  })
})
