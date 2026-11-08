import { describe, expect, it } from 'vitest'
import {
  characterWithoutLoras,
  expandReservations,
  exportForScript,
  makeSettingsBackup,
  mergeCharacterLoras,
  normalizeCharacterLoras,
  normalizeSnapshot,
  parseSettingsBackup,
  strictLibrary,
  type BatchPlan,
  type Library,
  type LoraRef,
  type Reservation
} from '../src/shared/pixai/library'
import {
  appendBatchReservations,
  expandBatchPlan,
  resolveBatchRow
} from '../src/shared/pixai/batch-reserve'
import {
  backupSelection,
  makeTransferBackup,
  parseTransferBackup,
  prepareBackupImport
} from '../src/shared/pixai/backup-transfer'
import { buildPayload } from '../src/shared/pixai/execution'
import { emptyWorkspace, readWorkspace } from '../src/renderer/src/pixai/store'
import { pixaiLibrary } from './fixtures/pixai-workspace'

const lora = (id: string, extra: Partial<LoraRef> = {}): LoraRef => ({
  id,
  name: `LoRA ${id}`,
  versionId: `${id}0`,
  weight: 0.7,
  triggerWords: `trigger-${id}`,
  ...extra
})
const characterLora = (): LoraRef => lora('31')
const ids = (): (() => string) => {
  let n = 0
  return () => `new-${++n}`
}
const meta = { appVersion: 'test', exportedAt: '2026-11-07T00:00:00.000Z' }
const options = { maxCredits: null, filePrefix: '', repeat: 1, imageCount: 4 }
function library(): Library {
  const value = pixaiLibrary()
  value.characters[0].loras = [characterLora()]
  return value
}
function plan(): BatchPlan {
  return {
    id: 'plan',
    name: 'Character LoRAs',
    rows: [{ kind: 'character', id: 'c1' }],
    columns: ['sc1'],
    count: 1,
    exceptions: {},
    order: 'byRow'
  }
}
function reservation(): Reservation {
  return { id: 'r1', presetId: 'p1', characterId: 'c1', sceneIds: ['s1'], count: 1 }
}
function frozenLibrary(): Library {
  const value = library()
  return appendBatchReservations(value, expandBatchPlan(value, plan(), { idFactory: ids() }))
}

describe('character LoRA merge contract', () => {
  it('leaves old characters optional and preserves preset-first order without mutating either list', () => {
    const value = pixaiLibrary()
    const old = strictLibrary(value)
    expect(old.characters[0]).not.toHaveProperty('loras')
    const preset = [lora('20')]
    const character = [lora('31'), lora('32')]
    const original = JSON.stringify({ preset, character })
    expect(mergeCharacterLoras(preset)).toEqual({ loras: preset, sources: ['preset'] })
    const merged = mergeCharacterLoras(preset, character)
    expect(merged.loras.map((item) => item.id)).toEqual(['20', '31', '32'])
    expect(merged.sources).toEqual(['preset', 'character', 'character'])
    merged.loras[0].weight = 0
    merged.loras[1].triggerWords = 'changed'
    expect(JSON.stringify({ preset, character })).toBe(original)
  })

  it('deduplicates the same normalized version, weight and trigger while retaining the preset name', () => {
    const first = lora('20', { triggerWords: '  first\r\nsecond  ' })
    const second = { ...first, name: 'Other display name', triggerWords: 'first\nsecond' }
    const result = mergeCharacterLoras([first, lora('21')], [second, lora('31')])
    expect(result.sources).toEqual(['both', 'preset', 'character'])
    expect(result.loras.map((item) => item.id)).toEqual(['20', '21', '31'])
    expect(result.loras[0]).toMatchObject({ name: first.name, triggerWords: 'first\nsecond' })
  })

  it.each([
    ['weight', { weight: 0.8 }],
    ['trigger', { triggerWords: 'different-trigger' }],
    ['same parent, different version', { versionId: '201' }],
    ['same version, different parent', { id: '21', versionId: '200' }]
  ] as const)('rejects %s conflicts instead of silently overriding or summing', (_name, change) => {
    const preset = [lora('20')]
    const character = [lora('20', change)]
    const before = JSON.stringify({ preset, character })
    expect(() => mergeCharacterLoras(preset, character)).toThrow()
    expect(JSON.stringify({ preset, character })).toBe(before)
  })

  it('normalizes optional character LoRAs and rejects unknown nested fields or a non-list value', () => {
    const value = library()
    value.characters[0].loras![0].triggerWords = '  trigger-31  '
    expect(strictLibrary(value).characters[0].loras![0].triggerWords).toBe('trigger-31')
    const invalid = structuredClone(value) as unknown as {
      characters: Array<{ loras: unknown }>
    }
    invalid.characters[0].loras = [{ ...characterLora(), accidentalSecret: 'not-allowed' }]
    expect(() => strictLibrary(invalid)).toThrow()
    invalid.characters[0].loras = null
    expect(() => strictLibrary(invalid)).toThrow()
  })

  it('allows omitted names but rejects duplicate parent IDs and invalid stored weights', () => {
    expect(normalizeCharacterLoras(undefined)).toEqual([])
    expect(normalizeCharacterLoras([{ id: '31', weight: '0.7' }])).toEqual([
      { id: '31', name: '', weight: 0.7 }
    ])
    expect(() => normalizeCharacterLoras([lora('31'), lora('31')])).toThrow()
    for (const weight of ['', NaN, Infinity, -2.1, 2.1, null]) {
      expect(() => normalizeCharacterLoras([lora('31', { weight: weight as number })])).toThrow()
    }
  })

  it('merges equally unspecified versions but refuses a known/unknown version mismatch', () => {
    const unknownVersion = lora('31')
    delete unknownVersion.versionId
    expect(mergeCharacterLoras([unknownVersion], [unknownVersion])).toEqual({
      loras: [unknownVersion],
      sources: ['both']
    })
    expect(() => mergeCharacterLoras([unknownVersion], [characterLora()])).toThrow()
    expect(() => mergeCharacterLoras([characterLora()], [unknownVersion])).toThrow()
  })

  it('does not accept LoRAs inside a frozen character, including an empty list', () => {
    const value = library()
    const snapshot = {
      common: value.common,
      preset: value.presets[0],
      character: value.characters[0],
      chunks: [value.scenes[0]]
    }
    expect(() => normalizeSnapshot(snapshot)).toThrow()
    expect(() =>
      normalizeSnapshot({ ...snapshot, character: { ...snapshot.character, loras: [] } })
    ).toThrow()
    const character = characterWithoutLoras(snapshot.character)
    expect(character).not.toHaveProperty('loras')
    expect(snapshot.character.loras).toEqual([characterLora()])
    expect(normalizeSnapshot({ ...snapshot, character }).character).toEqual(character)
  })
})

describe('character LoRAs in reservations and jobs', () => {
  it('applies character and cast rows independently, keeping the selected trigger position', () => {
    const value = library()
    value.characters[1].loras = [lora('32')]
    value.presets.push({ ...value.presets[0], id: 'p2', name: 'No style LoRA', loras: [] })
    value.casts = [
      {
        id: 'cast1',
        name: 'Alice in a coat',
        characterId: 'c1',
        presetId: 'p2',
        extra: { prompt: 'coat', negativePrompt: '' },
        triggerPosition: 'end'
      }
    ]
    const expanded = expandBatchPlan(
      value,
      {
        ...plan(),
        rows: [
          { kind: 'character', id: 'c1' },
          { kind: 'cast', id: 'cast1' },
          { kind: 'character', id: 'c2' }
        ]
      },
      { idFactory: ids() }
    )
    expect(expanded.problems).toEqual([])
    expect(
      expanded.reservations.map((item) => item.snapshot!.preset.loras.map((x) => x.id))
    ).toEqual([['20', '31'], ['31'], ['20', '32']])
    for (const item of expanded.reservations)
      expect(item.snapshot!.character).not.toHaveProperty('loras')
    const jobs = expandReservations(appendBatchReservations(value, expanded), { idFactory: ids() })
    expect(jobs.map((item) => item.prompt)).toEqual([
      'quality, trigger, trigger-31, alice, smile',
      'quality, alice, coat, smile, trigger-31',
      'quality, trigger, trigger-32, bob, smile'
    ])
    expect(buildPayload({ request: jobs[1], imageCount: 4, options }, 7).loras).toEqual([
      { modelId: '310', weight: 0.7, triggerWords: '' }
    ])
  })

  it('reports a conflicting row and reserves nothing from a partly valid batch', () => {
    const value = library()
    value.characters[1].loras = [{ ...value.presets[0].loras[0], weight: 0.9 }]
    const before = JSON.stringify(value)
    const row = resolveBatchRow(value, { kind: 'character', id: 'c2' })
    expect(row.problems).toHaveLength(1)
    const expanded = expandBatchPlan(value, {
      ...plan(),
      rows: [
        { kind: 'character', id: 'c1' },
        { kind: 'character', id: 'c2' }
      ]
    })
    expect(expanded.reservations).toEqual([])
    expect(expanded.problems).toEqual([
      expect.objectContaining({ level: 'error', rowKey: 'character:c2', rowName: 'Bob' })
    ])
    expect(() => appendBatchReservations(value, expanded)).toThrow()
    expect(JSON.stringify(value)).toBe(before)
  })

  it.each(['missing-version', 'weight'] as const)(
    'reports %s before making a character-LoRA batch reservation',
    (failure) => {
      const value = library()
      if (failure === 'missing-version') delete value.characters[0].loras![0].versionId
      else value.characters[0].loras![0].weight = 1.2
      const expanded = expandBatchPlan(value, plan())
      expect(expanded.reservations).toEqual([])
      expect(expanded.problems).toEqual([
        expect.objectContaining({ level: 'error', rowKey: 'character:c1', rowName: 'Alice' })
      ])
    }
  )

  it('freezes merged LoRAs and triggers through live edits, restart and final API assembly', () => {
    const value = frozenLibrary()
    const [original] = expandReservations(value, { idFactory: ids() })
    value.presets[0].loras[0].weight = 0.1
    value.presets[0].loras[0].triggerWords = 'changed style'
    value.characters[0].loras = [lora('99')]
    const [after] = expandReservations(value, { idFactory: ids() })
    expect(after).toEqual(original)
    const workspace = {
      ...emptyWorkspace(),
      library: value,
      options,
      jobs: [{ request: after, imageCount: 4, options }]
    }
    const restored = readWorkspace(JSON.stringify(workspace))
    expect(restored.jobs[0].request.configuration).toEqual(original.configuration)
    expect(restored.jobs[0].request.composition.character).not.toHaveProperty('loras')
    expect(buildPayload(restored.jobs[0], 7)).toMatchObject({
      prompt: 'quality, trigger, trigger-31, alice, smile',
      loras: [
        { modelId: '200', weight: 0.5, triggerWords: '' },
        { modelId: '310', weight: 0.7, triggerWords: '' }
      ]
    })
  })

  it('keeps a pre-feature snapshot unchanged after adding LoRAs to the live character', () => {
    const value = pixaiLibrary()
    value.reservations = [
      {
        ...reservation(),
        snapshot: normalizeSnapshot({
          common: value.common,
          preset: value.presets[0],
          character: value.characters[0],
          chunks: [value.scenes[0]]
        })
      }
    ]
    const [before] = expandReservations(value, { idFactory: ids() })
    value.characters[0].loras = [characterLora()]
    expect(expandReservations(value, { idFactory: ids() })[0]).toEqual(before)
    expect(before.prompt).toBe('quality, trigger, alice, smile')
  })

  it('merges an unsnapshotted reservation once and strips LoRAs from its generated composition', () => {
    const value = library()
    value.reservations = [reservation()]
    const [job] = expandReservations(value, { idFactory: ids() })
    expect(job.configuration.loras.map((item) => item.id)).toEqual(['20', '31'])
    expect(job.composition.character).not.toHaveProperty('loras')
    expect(job.prompt).toBe('quality, trigger, trigger-31, alice, smile')
  })

  it('keeps equal trigger text on distinct LoRAs and deduplicates only the identical LoRA', () => {
    const value = library()
    value.characters[0].loras = [
      { ...value.presets[0].loras[0], name: 'Same style entry' },
      lora('31', { triggerWords: 'trigger' })
    ]
    value.reservations = [reservation()]
    const [job] = expandReservations(value, { idFactory: ids() })
    expect(job.configuration.loras).toHaveLength(2)
    expect(job.prompt).toBe('quality, trigger, trigger, alice, smile')
  })

  it.each([-0.2, 1.2])(
    'preserves stored weight %s but rejects it at the official API boundary',
    (weight) => {
      const value = library()
      value.characters[0].loras![0].weight = weight
      const stored = strictLibrary(value)
      expect(stored.characters[0].loras![0].weight).toBe(weight)
      stored.reservations = [reservation()]
      const [request] = expandReservations(stored, { idFactory: ids() })
      expect(() => buildPayload({ request, imageCount: 4, options }, 7)).toThrow('0~1')
    }
  )

  it('requires a version ID at the API boundary and never falls back to the parent ID', () => {
    const value = library()
    delete value.characters[0].loras![0].versionId
    value.reservations = [reservation()]
    const [request] = expandReservations(strictLibrary(value), { idFactory: ids() })
    expect(() => buildPayload({ request, imageCount: 4, options }, 7)).toThrow('ID')
  })

  it('keeps more than five distinct LoRAs in batch snapshots, backups and final payloads', () => {
    const value = library()
    value.presets[0].loras = [lora('20'), lora('21'), lora('22')]
    value.characters[0].loras = [
      lora('20'),
      ...['31', '32', '33', '34', '35', '36'].map((id) => lora(id))
    ]
    const expected = ['20', '21', '22', '31', '32', '33', '34', '35', '36'].map((id) => lora(id))
    const expanded = expandBatchPlan(value, plan(), { idFactory: ids() })
    expect(expanded.problems).toEqual([])
    const reserved = appendBatchReservations(value, expanded)
    expect(reserved.reservations[0].snapshot!.preset.loras).toEqual(expected)
    value.characters[0].loras = []
    const restored = parseSettingsBackup(
      JSON.stringify(makeSettingsBackup(reserved, options, meta))
    )
    const [request] = expandReservations(restored.library, { idFactory: ids() })
    expect(request.configuration.loras).toEqual(expected)
    expect(buildPayload({ request, imageCount: 4, options }, 7).loras).toEqual(
      expected.map((item) => ({ modelId: item.versionId, weight: item.weight, triggerWords: '' }))
    )
  })
})

describe('character LoRA backup preservation', () => {
  it('round-trips full backups with live LoRAs and fully flattened frozen reservations', () => {
    const value = frozenLibrary()
    const backup = makeSettingsBackup(value, options, meta)
    const restored = parseSettingsBackup(JSON.stringify(backup))
    expect(restored.library).toEqual(strictLibrary(value))
    expect(restored.library.characters[0].loras).toEqual([characterLora()])
    expect(restored.library.reservations[0].snapshot!.preset.loras).toHaveLength(2)
    expect(restored.library.reservations[0].snapshot!.character).not.toHaveProperty('loras')
  })

  it.each(['append', 'replace'] as const)(
    'preserves character LoRAs in selective %s imports without remapping model IDs',
    (mode) => {
      const source = library()
      const selection = { ...backupSelection(false), characters: true }
      const file = parseTransferBackup(
        JSON.stringify(makeTransferBackup(source, options, selection, meta))
      )
      const target = pixaiLibrary()
      const original = JSON.stringify(target)
      const imported = prepareBackupImport(target, file, selection, mode, ids())
      const incoming = imported.library.characters.find((item) => item.loras?.length)
      expect(incoming?.loras).toEqual([characterLora()])
      if (mode === 'append') {
        expect(incoming?.id).not.toBe('c1')
        expect(imported.library.characters).toHaveLength(6)
      } else expect(imported.library.characters).toHaveLength(3)
      expect(JSON.stringify(target)).toBe(original)
    }
  )

  it('freezes retained legacy reservations before replacement changes a live character', () => {
    const target = library()
    target.reservations = [reservation()]
    const selection = { ...backupSelection(false), characters: true }
    const file = makeTransferBackup(pixaiLibrary(), options, selection, meta)
    const imported = prepareBackupImport(target, file, selection, 'replace', ids())
    expect(imported.library.characters[0]).not.toHaveProperty('loras')
    const retained = imported.library.reservations[0]
    expect(retained.snapshot!.preset.loras.map((item) => item.id)).toEqual(['20', '31'])
    expect(retained.snapshot!.character).not.toHaveProperty('loras')
    expect(expandReservations(imported.library, { idFactory: ids() })[0].prompt).toBe(
      'quality, trigger, trigger-31, alice, smile'
    )
  })

  it('refuses lossy legacy script export while keeping normal old-library export available', () => {
    expect(() => exportForScript(library())).toThrow()
    expect(() => makeSettingsBackup(library(), options, meta, 'script')).toThrow()
    expect(() => exportForScript(pixaiLibrary())).not.toThrow()
    const empty = pixaiLibrary()
    empty.characters[0].loras = []
    expect(exportForScript(empty).library.characters[0]).not.toHaveProperty('loras')
  })
})
