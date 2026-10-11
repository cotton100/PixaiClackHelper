import { describe, expect, it } from 'vitest'
import {
  composePrompts,
  expandReservations,
  exportForScript,
  makeLibrary,
  makeSettingsBackup,
  normalizeLibrary,
  normalizeSnapshot,
  parseSettingsBackup,
  presetHasText,
  strictLibrary,
  type Library,
  type Preset,
  type Reservation
} from '../src/shared/pixai/library'
import { appendBatchReservations, expandBatchPlan } from '../src/shared/pixai/batch-reserve'
import { buildPayload } from '../src/shared/pixai/execution'
import { readWorkspace, type Workspace } from '../src/renderer/src/pixai/store'

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const model = { id: '10', versionId: '100', name: 'M' }
const loras = [{ id: '20', versionId: '200', name: 'L', weight: 0.5, triggerWords: 'trigger' }]
const presetA: Preset = {
  id: 'pa',
  name: 'A',
  model,
  loras,
  prompt: 'preset-style',
  negativePrompt: 'preset-bad'
}
const presetB: Preset = {
  id: 'pb',
  name: 'B',
  model,
  loras: [],
  prompt: 'b-style',
  negativePrompt: ''
}
const presetPlain: Preset = { id: 'pp', name: 'Plain', model, loras }
const library = (): Library => ({
  ...makeLibrary(),
  common: { prompt: 'global-quality', negativePrompt: 'global-bad' },
  presets: [copy(presetA), copy(presetB), copy(presetPlain)],
  characters: [
    {
      id: 'c1',
      name: 'Alice',
      prompt: 'character-text',
      negativePrompt: '',
      defaultPresetId: 'pa'
    },
    { id: 'c2', name: 'Bob', prompt: 'bob', negativePrompt: 'bob-bad', defaultPresetId: 'pp' }
  ],
  scenes: [{ id: 's1', name: '웃음', prompt: 'smile', negativePrompt: '' }],
  sceneCards: [
    {
      id: 'sc1',
      name: '웃음',
      sceneIds: ['s1'],
      chunks: [{ id: 's1', name: '웃음', prompt: 'smile', negativePrompt: '' }]
    }
  ],
  casts: [
    {
      id: 'A2',
      name: 'Alice · B',
      characterId: 'c1',
      presetId: 'pb',
      extra: { prompt: 'winter', negativePrompt: '' }
    }
  ]
})
const common = { prompt: 'global-quality', negativePrompt: 'global-bad' }
const character = { prompt: 'character-text', negativePrompt: '' }
const chunks = [{ prompt: 'smile', negativePrompt: '' }]
let seq = 0
const ids = (): string => `id-${++seq}`

describe('preset common prompts join the common block', () => {
  it('follows the documented order at every trigger position and leaves results unchanged without preset text', () => {
    expect(composePrompts(common, character, chunks, presetA, 1)).toEqual({
      prompt: 'global-quality, preset-style, trigger, character-text, smile',
      negativePrompt: 'global-bad, preset-bad'
    })
    expect(composePrompts(common, character, chunks, presetA, 0).prompt).toBe(
      'trigger, global-quality, preset-style, character-text, smile'
    )
    expect(composePrompts(common, character, chunks, presetA, 2).prompt).toBe(
      'global-quality, preset-style, character-text, trigger, smile'
    )
    expect(composePrompts(common, character, chunks, presetA, 3).prompt).toBe(
      'global-quality, preset-style, character-text, smile, trigger'
    )
    expect(composePrompts(common, character, chunks, presetA, 'end').prompt).toBe(
      'global-quality, preset-style, character-text, smile, trigger'
    )
    const plain = composePrompts(common, character, chunks, presetPlain, 1)
    expect(plain).toEqual({
      prompt: 'global-quality, trigger, character-text, smile',
      negativePrompt: 'global-bad'
    })
    expect(
      composePrompts(
        common,
        character,
        chunks,
        { ...presetPlain, prompt: '', negativePrompt: '' },
        1
      )
    ).toEqual(plain)
    expect(composePrompts(common, character, chunks, { ...presetPlain, prompt: '  ' }, 1)).toEqual(
      plain
    )
    // prompt-only / negative-only
    expect(
      composePrompts(common, character, chunks, { ...presetPlain, prompt: 'only-pos' }, 1)
    ).toEqual({
      prompt: 'global-quality, only-pos, trigger, character-text, smile',
      negativePrompt: 'global-bad'
    })
    expect(
      composePrompts(common, character, chunks, { ...presetPlain, negativePrompt: 'only-neg' }, 1)
    ).toEqual({ prompt: plain.prompt, negativePrompt: 'global-bad, only-neg' })
    // text is kept verbatim: no dedupe, no summary, an empty global common still yields the preset text
    expect(
      composePrompts(
        { prompt: '', negativePrompt: '' },
        character,
        chunks,
        { ...presetA, prompt: 'smile, smile' },
        1
      ).prompt
    ).toBe('smile, smile, trigger, character-text, smile')
    // scene/cast extras keep their places around the merged block
    expect(
      composePrompts(common, character, chunks, presetA, 1, {
        cast: { prompt: 'winter', negativePrompt: '' },
        scene: { prompt: 'rain', negativePrompt: 'sun' }
      })
    ).toEqual({
      prompt: 'global-quality, preset-style, trigger, character-text, winter, smile, rain',
      negativePrompt: 'global-bad, preset-bad, sun'
    })
    expect(presetHasText(presetA)).toBe(true)
    expect(presetHasText(presetPlain)).toBe(false)
    expect(presetHasText({ prompt: ' ', negativePrompt: '' })).toBe(false)
  })

  it('normalizes and backs up optional preset text without touching presets that never had it', () => {
    const normalized = normalizeLibrary(library())
    expect(normalized.presets[0]).toMatchObject({
      prompt: 'preset-style',
      negativePrompt: 'preset-bad'
    })
    expect(normalized.presets[1]).toMatchObject({ prompt: 'b-style', negativePrompt: '' })
    expect('prompt' in normalized.presets[2]).toBe(false)
    expect('negativePrompt' in normalized.presets[2]).toBe(false)
    expect(strictLibrary(library()).presets[0].prompt).toBe('preset-style')
    expect(() => strictLibrary({ ...library(), presets: [{ ...presetA, secret: 'x' }] })).toThrow()
    expect(() => normalizeLibrary({ ...library(), presets: [{ ...presetA, prompt: 5 }] })).toThrow()
    const backup = makeSettingsBackup(
      library(),
      { maxCredits: null, filePrefix: '', repeat: 1 },
      { appVersion: '0.1.6', exportedAt: '2026-10-11T00:00:00.000Z' }
    )
    expect(parseSettingsBackup(JSON.stringify(backup)).library).toEqual(normalized)
    // a script-era backup has no preset text and loads unchanged
    const old = makeSettingsBackup(
      { ...library(), presets: [copy(presetPlain)], characters: [], casts: [], reservations: [] },
      { maxCredits: null, filePrefix: '', repeat: 1 },
      { appVersion: '0.9.12', exportedAt: '2026-10-10T00:00:00.000Z' }
    )
    expect(Object.keys(parseSettingsBackup(JSON.stringify(old)).library.presets[0]).sort()).toEqual(
      ['id', 'loras', 'model', 'name']
    )
  })

  it('freezes the preset text in the reservation copy: later preset edits, restarts and old copies stay as they were', () => {
    const lib = normalizeLibrary(library())
    const reservation: Reservation = {
      id: 'r1',
      presetId: 'pa',
      characterId: 'c1',
      sceneIds: ['s1'],
      count: 1,
      snapshot: normalizeSnapshot({
        common: lib.common,
        preset: lib.presets[0],
        character: lib.characters[0],
        chunks: lib.scenes
      })
    }
    const reserved: Library = { ...lib, reservations: [reservation] }
    seq = 0
    const [job] = expandReservations(reserved, { idFactory: ids })
    expect(job.prompt).toBe('global-quality, preset-style, trigger, character-text, smile')
    expect(job.negativePrompt).toBe('global-bad, preset-bad')
    expect(job.composition.preset.prompt).toBe('preset-style')
    // edit the live preset afterwards
    const edited: Library = {
      ...reserved,
      presets: reserved.presets.map((p) =>
        p.id === 'pa' ? { ...p, prompt: 'CHANGED', negativePrompt: 'CHANGED-BAD' } : p
      )
    }
    seq = 0
    expect(expandReservations(edited, { idFactory: ids })[0].prompt).toBe(job.prompt)
    // a registered job rebuilt from the workspace keeps the frozen text, not today's preset
    const workspace: Workspace = {
      version: 1,
      library: edited,
      options: { maxCredits: null, filePrefix: '', repeat: 1, imageCount: 4 },
      jobs: [
        {
          request: {
            ...job,
            composition: { ...job.composition, reservation: { ...reservation, repeat: 1 } }
          },
          imageCount: 4,
          options: { maxCredits: null, filePrefix: '', repeat: 1, imageCount: 4 }
        }
      ],
      widths: {}
    }
    const restored = readWorkspace(JSON.stringify(workspace))
    expect(restored.jobs[0].request.prompt).toBe(job.prompt)
    expect(restored.jobs[0].request.negativePrompt).toBe(job.negativePrompt)
    expect(buildPayload(restored.jobs[0], 7)).toMatchObject({
      prompt: job.prompt,
      negativePrompt: job.negativePrompt
    })
    // an old copy made before preset text existed is never back-filled
    const oldCopy: Reservation = {
      ...reservation,
      id: 'r0',
      snapshot: normalizeSnapshot({
        common: lib.common,
        preset: copy(presetPlain),
        character: lib.characters[0],
        chunks: lib.scenes
      }),
      presetId: 'pp'
    }
    seq = 0
    const [oldJob] = expandReservations(
      {
        ...edited,
        presets: edited.presets.map((p) => (p.id === 'pp' ? { ...p, prompt: 'LATE' } : p)),
        reservations: [oldCopy]
      },
      { idFactory: ids }
    )
    expect(oldJob.prompt).toBe('global-quality, trigger, character-text, smile')
  })

  it('applies the cast preset text, not the character default, in characters × scenes batches and in the API payload', () => {
    seq = 0
    const expansion = expandBatchPlan(
      library(),
      {
        id: 'plan',
        rows: [
          { kind: 'character', id: 'c1' },
          { kind: 'cast', id: 'A2' },
          { kind: 'character', id: 'c2' }
        ],
        columns: ['sc1'],
        count: 1,
        exceptions: {},
        order: 'byRow'
      },
      { idFactory: ids, batchId: 'b1' }
    )
    expect(expansion.problems).toEqual([])
    const [alice, aliceB, bob] = expansion.reservations
    expect(alice.snapshot?.preset.prompt).toBe('preset-style')
    expect(aliceB.snapshot?.preset.prompt).toBe('b-style')
    expect('prompt' in bob.snapshot!.preset).toBe(false)
    seq = 0
    const jobs = expandReservations(appendBatchReservations(library(), expansion), {
      idFactory: ids
    })
    expect(jobs.map((job) => job.prompt)).toEqual([
      'global-quality, preset-style, trigger, character-text, smile',
      'global-quality, b-style, character-text, winter, smile',
      'global-quality, trigger, bob, smile'
    ])
    expect(jobs.map((job) => job.negativePrompt)).toEqual([
      'global-bad, preset-bad',
      'global-bad',
      'global-bad, bob-bad'
    ])
    const queued = {
      request: jobs[1],
      imageCount: 4,
      options: { maxCredits: null, filePrefix: '', repeat: 1, imageCount: 4 }
    }
    expect(buildPayload(queued, 1)).toMatchObject({
      prompt: 'global-quality, b-style, character-text, winter, smile',
      negativePrompt: 'global-bad'
    })
  })

  it('script export strips preset text, drops reservations whose copy carries it, and reports what the script will lose', () => {
    const lib = normalizeLibrary(library())
    const withText: Reservation = {
      id: 'r1',
      presetId: 'pa',
      characterId: 'c1',
      sceneIds: ['s1'],
      count: 1,
      snapshot: normalizeSnapshot({
        common: lib.common,
        preset: lib.presets[0],
        character: lib.characters[0],
        chunks: lib.scenes
      })
    }
    const plainCopy: Reservation = {
      id: 'r2',
      presetId: 'pp',
      characterId: 'c2',
      sceneIds: ['s1'],
      count: 2,
      snapshot: normalizeSnapshot({
        common: lib.common,
        preset: lib.presets[2],
        character: lib.characters[1],
        chunks: lib.scenes
      })
    }
    // copy made before text was added to preset B: judged by the copy, so it is kept
    const staleCopy: Reservation = {
      id: 'r3',
      presetId: 'pb',
      characterId: 'c1',
      sceneIds: ['s1'],
      count: 1,
      snapshot: normalizeSnapshot({
        common: lib.common,
        preset: { id: 'pb', name: 'B', model, loras: [] },
        character: lib.characters[0],
        chunks: lib.scenes
      })
    }
    // copy carries text although the live preset lost it: dropped
    const liveCleared: Library = {
      ...lib,
      presets: lib.presets.map((p) =>
        p.id === 'pa' ? { ...p, prompt: '', negativePrompt: '' } : p
      )
    }
    const textOnlyInCopy: Reservation = { ...withText, id: 'r4' }
    const unsnapshotted: Reservation = {
      id: 'r5',
      presetId: 'pa',
      characterId: 'c1',
      sceneIds: ['s1'],
      count: 1
    }
    const out = exportForScript({
      ...lib,
      reservations: [withText, plainCopy, staleCopy, unsnapshotted],
      combinations: [
        {
          id: 'k1',
          presetId: 'pa',
          characterId: 'c1',
          sceneIds: ['s1'],
          count: 1,
          favorite: true,
          name: 'fav',
          at: 1
        },
        {
          id: 'k2',
          presetId: 'pp',
          characterId: 'c2',
          sceneIds: ['s1'],
          count: 1,
          favorite: false,
          name: '',
          at: 2
        }
      ]
    })
    expect(out.library.presets.every((p) => !('prompt' in p) && !('negativePrompt' in p))).toBe(
      true
    )
    expect(out.library.reservations.map((r) => r.id)).toEqual(['r2', 'r3'])
    expect(
      out.library.reservations.every((r) => !r.snapshot || !('prompt' in r.snapshot.preset))
    ).toBe(true)
    expect(out.dropped).toMatchObject({
      reservations: 2,
      reservationsWithPresetText: 2,
      presetsWithText: ['A', 'B'],
      combinationsWithPresetText: 1
    })
    expect(out.dropped.keys).toEqual([
      'presets.prompt',
      'sceneCards',
      'casts',
      'characters.defaultPresetId'
    ])
    const cleared = exportForScript({ ...liveCleared, reservations: [textOnlyInCopy] })
    expect(cleared.library.reservations).toEqual([])
    expect(cleared.dropped).toMatchObject({
      reservations: 1,
      reservationsWithPresetText: 1,
      presetsWithText: ['B']
    })
    // the script-side strict parser shape: no unknown preset keys remain anywhere
    expect(() => strictLibrary(out.library)).not.toThrow()
    expect(JSON.stringify(out.library)).not.toContain('preset-style')
    const scriptBackup = makeSettingsBackup(
      { ...lib, reservations: [withText] },
      { maxCredits: null, filePrefix: '', repeat: 1 },
      { appVersion: '0.1.6', exportedAt: '2026-10-11T00:00:00.000Z' },
      'script'
    )
    expect(JSON.stringify(scriptBackup)).not.toContain('preset-style')
    expect(scriptBackup.library.reservations).toEqual([])
  })

  it.each([
    { prompt: 'style', negativePrompt: '', dropped: 1 },
    { prompt: '', negativePrompt: 'bad', dropped: 1 },
    { prompt: '', negativePrompt: '', dropped: 0 }
  ])('exports legacy reservations according to their effective preset: %j', (text) => {
    const lib: Library = {
      ...library(),
      presets: [{ ...copy(presetPlain), prompt: text.prompt, negativePrompt: text.negativePrompt }],
      reservations: [
        { id: 'legacy', presetId: 'pp', characterId: 'c1', sceneIds: ['s1'], count: 1 }
      ]
    }
    const original = copy(lib)
    const before = expandReservations(lib, { idFactory: () => 'job' })[0]
    const exported = exportForScript(lib)
    expect(exported.dropped.reservations).toBe(text.dropped)
    expect(exported.dropped.reservationsWithPresetText).toBe(text.dropped)
    expect(exported.library.reservations).toHaveLength(1 - text.dropped)
    if (!text.dropped) {
      const after = expandReservations(exported.library, { idFactory: () => 'job' })[0]
      expect(after.prompt).toBe(before.prompt)
      expect(after.negativePrompt).toBe(before.negativePrompt)
    }
    expect(lib).toEqual(original)
    expect(
      parseSettingsBackup(
        JSON.stringify(
          makeSettingsBackup(
            lib,
            { maxCredits: null, filePrefix: '', repeat: 1 },
            { appVersion: '0.1.6', exportedAt: '2026-10-11T00:00:00.000Z' }
          )
        )
      ).library.reservations
    ).toEqual(lib.reservations)
  })

  it('reads a 0.1.5 workspace (presets without text, queued jobs, options, widths, compose draft) unchanged', () => {
    const lib = normalizeLibrary({
      ...library(),
      presets: [copy(presetPlain)],
      characters: [
        {
          id: 'c1',
          name: 'Alice',
          prompt: 'character-text',
          negativePrompt: '',
          defaultPresetId: 'pp'
        }
      ],
      casts: []
    })
    const reservation: Reservation = {
      id: 'r1',
      presetId: 'pp',
      characterId: 'c1',
      sceneIds: ['s1'],
      count: 2,
      snapshot: normalizeSnapshot({
        common: lib.common,
        preset: lib.presets[0],
        character: lib.characters[0],
        chunks: lib.scenes
      })
    }
    seq = 0
    const [job] = expandReservations(
      { ...lib, reservations: [reservation] },
      { idFactory: ids, titlePrefix: 'old' }
    )
    const options = {
      maxCredits: 7800,
      filePrefix: 'old',
      repeat: 1,
      imageCount: 4,
      maxInFlight: 3,
      api: { aspectRatio: '5:3', size: '1k' }
    }
    const workspace: Workspace = {
      version: 1,
      library: lib,
      options,
      jobs: [
        {
          request: {
            ...job,
            composition: { ...job.composition, reservation: { ...reservation, repeat: 1 } }
          },
          imageCount: 4,
          options
        }
      ],
      widths: { compose: [30, 40, 30] },
      composeDraft: {
        presetId: 'pp',
        characterId: 'c1',
        sceneIds: ['s1'],
        count: 1,
        triggerPosition: 'end'
      }
    }
    const restored = readWorkspace(JSON.stringify(workspace))
    expect(restored.library).toEqual(lib)
    expect(restored.options).toEqual(options)
    expect(restored.widths).toEqual({ compose: [30, 40, 30] })
    expect(restored.composeDraft).toEqual(workspace.composeDraft)
    expect(restored.jobs[0].request.prompt).toBe('global-quality, trigger, character-text, smile')
    expect(restored.jobs[0].request.title).toBe(job.title)
    expect('prompt' in restored.jobs[0].request.composition.preset).toBe(false)
  })
})
