import { describe, expect, it } from 'vitest'
import { makeLibrary } from '../src/shared/pixai/library'
import { pixaiLibrary } from './fixtures/pixai-workspace'
import {
  applySyncLibrary,
  canonicalSync,
  mergeSyncLibraries,
  parseSyncLibrary,
  projectSyncLibrary,
  SYNC_MAX_BYTES,
  type SyncLibrary
} from '../src/shared/pixai/library-sync'

const sample = (): SyncLibrary => projectSyncLibrary(pixaiLibrary())
const clone = <T>(value: T): T => structuredClone(value)

describe('library-only sync boundary', () => {
  it('projects only materials, links, folders and order, not local work/history/settings', () => {
    const source = pixaiLibrary()
    source.reservations = [
      { id: 'r', presetId: 'p1', characterId: 'c1', sceneIds: ['s1'], count: 1 }
    ]
    source.combinations = [
      {
        id: 'h',
        presetId: 'p1',
        characterId: 'c1',
        sceneIds: [],
        count: 1,
        favorite: true,
        name: 'local',
        at: 1
      }
    ]
    const projected = projectSyncLibrary(source)
    expect(projected).not.toHaveProperty('reservations')
    expect(projected).not.toHaveProperty('combinations')
    expect(projected.characters.map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])
    expect(projected.sceneCards[0].chunks).toEqual(source.sceneCards![0].chunks)
    expect(parseSyncLibrary(clone(projected))).toEqual(projected)
  })
  it.each(['key', 'apiKey', 'options', 'jobs', 'reservations', 'outputDir', 'combinations'])(
    'rejects extra top-level %s',
    (key) => {
      expect(() => parseSyncLibrary({ ...sample(), [key]: 'not-shared' })).toThrow(
        /라이브러리 재료/
      )
    }
  )
  it('rejects nested unknown fields, duplicated IDs and malformed collections', () => {
    const value = sample()
    Object.assign(value.presets[0], { secret: 'not-shared' })
    expect(() => parseSyncLibrary(value)).toThrow()
    const duplicate = sample()
    duplicate.characters.push(clone(duplicate.characters[0]))
    expect(() => parseSyncLibrary(duplicate)).toThrow(/중복/)
    expect(() => parseSyncLibrary({ ...sample(), scenes: null })).toThrow()
  })
  it('canonicalizes property order but preserves order of entries and rejects unsafe JSON', () => {
    expect(canonicalSync({ b: 2, a: [1, 3] })).toBe(canonicalSync({ a: [1, 3], b: 2 }))
    expect(canonicalSync([1, 3])).not.toBe(canonicalSync([3, 1]))
    expect(() => canonicalSync(JSON.parse('{"__proto__":{}}'))).toThrow()
    expect(() => canonicalSync({ value: Number.NaN })).toThrow()
    const cyclic: { next?: unknown } = {}
    cyclic.next = cyclic
    expect(() => canonicalSync(cyclic)).toThrow()
    expect(() => canonicalSync({ large: 'a'.repeat(SYNC_MAX_BYTES) })).toThrow(/용량/)
  })
})

describe('three-way material merge', () => {
  it('unions initial libraries without interpreting absence as deletion or changing IDs', () => {
    const app = projectSyncLibrary(makeLibrary()),
      script = sample()
    app.common = clone(script.common)
    app.scenes.push({ id: 'app-only', name: 'app', prompt: 'local', negativePrompt: '' })
    const result = mergeSyncLibraries(null, app, script)
    expect(result.conflicts).toEqual([])
    expect(new Set(result.library.scenes.map((c) => c.id))).toEqual(
      new Set(['app-only', 's1', 's2', 's3'])
    )
    expect(mergeSyncLibraries(result.library, result.library, result.library)).toEqual(result)
  })
  it('asks for same-ID initial changes and different default common text', () => {
    const app = sample(),
      script = sample()
    script.characters[0].prompt = 'different'
    script.common.prompt = 'other common'
    const result = mergeSyncLibraries(null, app, script)
    expect(result.conflicts.map((x) => x.key)).toEqual(['common', 'characters:c1'])
    expect(
      mergeSyncLibraries(null, app, script, { common: 'script', 'characters:c1': 'app' }).library
        .common.prompt
    ).toBe('other common')
  })
  it('merges disjoint offline edits and additions without duplication', () => {
    const base = sample(),
      app = clone(base),
      script = clone(base)
    app.characters[0].prompt = 'app edit'
    script.characters[1].prompt = 'script edit'
    app.scenes.push({ id: 'a', name: 'A', prompt: 'a', negativePrompt: '' })
    script.scenes.push({ id: 'b', name: 'B', prompt: 'b', negativePrompt: '' })
    const result = mergeSyncLibraries(base, app, script)
    expect(result.conflicts).toEqual([])
    expect(result.library.characters.slice(0, 2).map((x) => x.prompt)).toEqual([
      'app edit',
      'script edit'
    ])
    expect(result.library.scenes).toHaveLength(5)
    expect(mergeSyncLibraries(base, result.library, result.library).library).toEqual(result.library)
  })
  it('propagates deletion versus unchanged, but asks on deletion versus edit', () => {
    const base = sample(),
      app = clone(base),
      script = clone(base)
    app.characters = app.characters.filter((c) => c.id !== 'c1')
    expect(
      mergeSyncLibraries(base, app, script).library.characters.some((c) => c.id === 'c1')
    ).toBe(false)
    script.characters[0].prompt = 'changed while offline'
    const result = mergeSyncLibraries(base, app, script)
    expect(result.conflicts).toEqual([expect.objectContaining({ key: 'characters:c1', app: null })])
    expect(
      mergeSyncLibraries(base, app, script, { 'characters:c1': 'script' }).library.characters[0]
        .prompt
    ).toBe('changed while offline')
    expect(
      mergeSyncLibraries(base, app, script, { 'characters:c1': 'app' }).library.characters.some(
        (c) => c.id === 'c1'
      )
    ).toBe(false)
  })
  it('preserves one-sided reorder, detects two-sided reorder, and keeps concurrent additions', () => {
    const base = sample(),
      app = clone(base),
      script = clone(base)
    script.characters = [script.characters[2], script.characters[0], script.characters[1]]
    expect(mergeSyncLibraries(base, app, script).library.characters.map((c) => c.id)).toEqual([
      'c3',
      'c1',
      'c2'
    ])
    app.characters = [app.characters[1], app.characters[0], app.characters[2]]
    script.characters.push({ id: 'c4', name: 'new', prompt: 'new', negativePrompt: '' })
    expect(mergeSyncLibraries(base, app, script).conflicts.map((x) => x.key)).toEqual([
      'order:characters'
    ])
    const resolved = mergeSyncLibraries(base, app, script, { 'order:characters': 'script' })
    expect(resolved.library.characters.map((c) => c.id)).toEqual(['c3', 'c1', 'c2', 'c4'])
  })
  it('merges folder rename and independent member move preserving empty folders and folder order', () => {
    const base = sample()
    base.chunkFolders = [
      { id: 'f1', name: 'one' },
      { id: 'f2', name: 'two' }
    ]
    base.scenes[0].folderId = 'f1'
    const app = clone(base),
      script = clone(base)
    app.chunkFolders[0].name = 'renamed'
    script.scenes[0].folderId = 'f2'
    const result = mergeSyncLibraries(base, app, script).library
    expect(result.chunkFolders.map((f) => f.name)).toEqual(['renamed', 'two'])
    expect(result.scenes[0].folderId).toBe('f2')
  })
  it('blocks a newly dangling reference from independent delete and new-link changes without mutation', () => {
    const base = sample()
    for (const c of base.characters) delete c.defaultPresetId
    const app = clone(base),
      script = clone(base)
    app.presets = []
    script.characters[0].defaultPresetId = 'p1'
    const before = canonicalSync({ base, app, script })
    expect(() => mergeSyncLibraries(base, app, script)).toThrow(/새 연결/)
    expect(canonicalSync({ base, app, script })).toBe(before)
  })
  it('preserves existing stale saved-config references and frozen scene chunks', () => {
    const base = sample()
    base.characters[0].defaultPresetId = 'already-missing'
    base.scenes = []
    expect(mergeSyncLibraries(base, base, base).library).toEqual(base)
    expect(base.sceneCards[0].chunks[0].prompt).toBe('smile')
  })
  it('rejects stale or invalid conflict selections', () => {
    expect(() =>
      mergeSyncLibraries(sample(), sample(), sample(), { 'characters:c1': 'app' })
    ).toThrow(/최신/)
    expect(() =>
      mergeSyncLibraries(null, sample(), sample(), { common: 'other' } as never)
    ).toThrow(/선택/)
  })
})

describe('local reservation preservation', () => {
  it('freezes old reservation content before replacing materials and retains local history', () => {
    const current = pixaiLibrary()
    current.reservations = [
      { id: 'r', presetId: 'p1', characterId: 'c1', sceneIds: ['s1'], count: 2 }
    ]
    current.combinations = [
      {
        id: 'h',
        presetId: 'p1',
        characterId: 'c1',
        sceneIds: [],
        count: 1,
        favorite: true,
        name: 'local',
        at: 1
      }
    ]
    const incoming = projectSyncLibrary(current)
    incoming.presets[0].prompt = 'new preset'
    incoming.characters[0].prompt = 'new char'
    const changed = applySyncLibrary(current, incoming)
    expect(changed.characters[0].prompt).toBe('new char')
    expect(changed.reservations[0].snapshot?.character.prompt).toBe('alice')
    expect(changed.reservations[0].snapshot?.preset.prompt).toBeUndefined()
    expect(changed.reservations[0].count).toBe(2)
    expect(changed.combinations).toEqual(current.combinations)
    expect(current.reservations[0].snapshot).toBeUndefined()
    expect(applySyncLibrary(changed, incoming)).toEqual(changed)
  })
  it('does not change or freeze anything on a no-op sync', () => {
    const current = pixaiLibrary()
    current.reservations = [
      { id: 'r', presetId: 'p1', characterId: 'c1', sceneIds: ['s1'], count: 1 }
    ]
    expect(applySyncLibrary(current, projectSyncLibrary(current))).toEqual(current)
  })
  it('rejects a material change if an old unsnapshotted reservation cannot be safely preserved', () => {
    const current = pixaiLibrary()
    current.reservations = [
      { id: 'r', presetId: 'p1', characterId: 'missing', sceneIds: ['s1'], count: 1 }
    ]
    const incoming = projectSyncLibrary(current)
    incoming.common.prompt = 'new'
    expect(() => applySyncLibrary(current, incoming)).toThrow(/기존 예약/)
    expect(current.common.prompt).toBe('quality')
  })
})
