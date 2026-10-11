import { expect, it } from 'vitest'
import { pixaiLibrary } from './fixtures/pixai-workspace'
import {
  deleteCommonPreset,
  expandReservations,
  exportForScript,
  makeSettingsBackup,
  parseSettingsBackup,
  resolvePresetCommon,
  strictLibrary
} from '../src/shared/pixai/library'
import { expandBatchPlan } from '../src/shared/pixai/batch-reserve'
import { buildPayload } from '../src/shared/pixai/execution'
import { emptyWorkspace, readWorkspace } from '../src/renderer/src/pixai/store'

function fixture(): ReturnType<typeof pixaiLibrary> {
  const library = pixaiLibrary()
  library.commonPresets = [
    { id: 'cp1', name: '밝은 색', prompt: 'bright, pastel', negativePrompt: 'dark' },
    { id: 'cp2', name: '비어 있음', prompt: '', negativePrompt: '' }
  ]
  library.presets[0].commonPresetId = 'cp1'
  library.presets[0].prompt = 'preset-extra'
  library.presets[0].negativePrompt = 'preset-bad'
  return library
}

it('replaces both global prompts, permits an intentionally empty set, and falls back only without a link', () => {
  const library = fixture()
  expect(resolvePresetCommon(library, library.presets[0])).toEqual({
    prompt: 'bright, pastel',
    negativePrompt: 'dark'
  })
  expect(resolvePresetCommon(library, { commonPresetId: 'cp2' })).toEqual({
    prompt: '',
    negativePrompt: ''
  })
  expect(resolvePresetCommon(library, {})).toEqual(library.common)
  expect(() => strictLibrary({ ...library, commonPresets: [] })).toThrow('연결된 공통문 세트')
  expect(() =>
    strictLibrary({
      ...library,
      commonPresets: [...library.commonPresets!, library.commonPresets![0]]
    })
  ).toThrow('중복')
  expect(() =>
    strictLibrary({
      ...library,
      commonPresets: [{ ...library.commonPresets![0], unexpected: true }]
    })
  ).toThrow()
})

it('preserves sets and links in app backup/restart and continues reading old backups', () => {
  const workspace = { ...emptyWorkspace(), library: fixture() }
  const meta = { appVersion: '0.1.10', exportedAt: new Date().toISOString() }
  const backup = makeSettingsBackup(workspace.library, workspace.options, meta)
  expect(parseSettingsBackup(JSON.stringify(backup)).library).toEqual(
    strictLibrary(workspace.library)
  )
  expect(readWorkspace(JSON.stringify(workspace)).library).toEqual(strictLibrary(workspace.library))
  expect(strictLibrary(pixaiLibrary())).not.toHaveProperty('commonPresets')
  expect(
    parseSettingsBackup(JSON.stringify(makeSettingsBackup(pixaiLibrary(), workspace.options, meta)))
      .library
  ).not.toHaveProperty('commonPresets')
})

it('freezes each batch preset choice through set edits/deletion, registration, restart and API payload', () => {
  const library = fixture()
  library.presets.push({ ...library.presets[0], id: 'p2', commonPresetId: 'cp2' })
  library.characters[1].defaultPresetId = 'p2'
  let sequence = 0
  const { reservations } = expandBatchPlan(
    library,
    {
      id: 'b1',
      name: 'batch',
      rows: [
        { kind: 'character', id: 'c1' },
        { kind: 'character', id: 'c2' }
      ],
      columns: ['sc1'],
      count: 1,
      exceptions: {},
      order: 'byRow'
    },
    { idFactory: () => 'r' + ++sequence }
  )
  library.reservations = reservations
  const before = expandReservations(library, { idFactory: () => 'job' + ++sequence })
  expect(before[0].prompt).toBe('bright, pastel, preset-extra, trigger, alice, smile')
  expect(before[0].negativePrompt).toBe('dark, preset-bad')
  expect(before[1].prompt).toBe('preset-extra, trigger, bob, smile')
  library.commonPresets![0].prompt = 'CHANGED'
  const deleted = deleteCommonPreset(library, 'cp1')
  expect(deleted.presets[0]).not.toHaveProperty('commonPresetId')
  expect(resolvePresetCommon(deleted, deleted.presets[0])).toEqual(library.common)
  const after = expandReservations(deleted)
  expect(after.map((job) => job.prompt)).toEqual(before.map((job) => job.prompt))
  const workspace = emptyWorkspace()
  workspace.library = deleted
  workspace.jobs = after.map((request) => ({ request, imageCount: 4, options: workspace.options }))
  const restored = readWorkspace(JSON.stringify(workspace))
  expect(buildPayload(restored.jobs[0], 1)).toMatchObject({
    prompt: before[0].prompt,
    negativePrompt: before[0].negativePrompt
  })
})

it('uses linked text in legacy unfrozen reservations and reports script export losses without losing frozen common text', () => {
  const library = fixture()
  delete library.presets[0].prompt
  delete library.presets[0].negativePrompt
  library.reservations = [
    { id: 'live', presetId: 'p1', characterId: 'c1', sceneIds: ['s1'], count: 1 }
  ]
  expect(expandReservations(library)[0].prompt).toBe('bright, pastel, trigger, alice, smile')
  const frozen = {
    ...library.reservations[0],
    id: 'frozen',
    snapshot: {
      common: resolvePresetCommon(library, library.presets[0]),
      preset: library.presets[0],
      character: library.characters[0],
      chunks: [library.scenes[0]]
    }
  }
  library.reservations.push(frozen)
  library.combinations = [
    {
      id: 'history',
      presetId: 'p1',
      characterId: 'c1',
      sceneIds: ['s1'],
      count: 1,
      favorite: true,
      name: 'favorite',
      at: 1
    }
  ]
  const exported = exportForScript(library)
  expect(exported.dropped).toMatchObject({
    presetsWithText: ['기본 모델'],
    combinationsWithPresetText: 1,
    reservations: 1,
    reservationsWithPresetText: 1
  })
  expect(exported.library).not.toHaveProperty('commonPresets')
  expect(exported.library.presets[0]).not.toHaveProperty('commonPresetId')
  expect(exported.library.reservations).toHaveLength(1)
  expect(exported.library.reservations[0].snapshot!.preset).not.toHaveProperty('commonPresetId')
  expect(expandReservations(exported.library)[0].prompt).toBe(
    'bright, pastel, trigger, alice, smile'
  )
})
