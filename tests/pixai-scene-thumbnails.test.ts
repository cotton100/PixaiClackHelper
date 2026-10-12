import { describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SceneThumbnails } from '../src/main/pixai/scene-thumbnails'
import { expandBatchPlan } from '../src/shared/pixai/batch-reserve'
import {
  expandReservations,
  makeSettingsBackup,
  parseSettingsBackup,
  exportForScript
} from '../src/shared/pixai/library'
import { PixaiRunner } from '../src/main/pixai/runner'
import { pixaiLibrary } from './fixtures/pixai-workspace'

describe('scene result previews', () => {
  it('keeps scene identity through backup, expansion, runner persistence without sending it to PixAI', async () => {
    const library = pixaiLibrary()
    library.reservations = expandBatchPlan(library, {
      id: 'plan',
      name: '묶음',
      rows: [{ kind: 'character', id: 'c1' }],
      columns: ['sc1', 'sc2'],
      count: 1,
      exceptions: {},
      order: 'byRow'
    }).reservations
    const options = { maxCredits: null, filePrefix: '', repeat: 1, imageCount: 4 }
    const backup = makeSettingsBackup(library, options, {
      appVersion: 'test',
      exportedAt: new Date().toISOString()
    })
    const restored = parseSettingsBackup(JSON.stringify(backup)).library
    expect(restored.reservations.map((r) => r.sourceSceneId)).toEqual(['sc1', 'sc2'])
    expect(
      exportForScript(restored).library.reservations.every((r) => !('sourceSceneId' in r))
    ).toBe(true)
    const jobs = expandReservations(restored).map((request) => ({
      request,
      options,
      imageCount: 4
    }))
    let journal: string | null = null
    const create = vi.fn(async () => '123')
    const save = vi.fn(async (job, id) => ({ path: `/output/${job.sourceSceneId}-${id}.png` }))
    const io = {
      read: () => journal,
      write: (text: string) => {
        journal = text
      },
      create,
      task: async () => ({
        id: '123',
        status: 'completed',
        outputs: { mediaIds: ['11', '12', '13', '14'] }
      }),
      save,
      sleep: async () => {}
    }
    const runner = new PixaiRunner(io)
    runner.start(jobs, '/output', 2)
    await vi.waitFor(() => expect(runner.status().running).toBe(false))
    expect(runner.status().jobs.map((j) => j.sourceSceneId)).toEqual(['sc1', 'sc2'])
    expect(
      runner.status().jobs.every((j) => j.state === 'done' && !('sourceSceneId' in j.payload))
    ).toBe(true)
    const reopened = new PixaiRunner(io)
    expect(reopened.status().jobs.map((j) => j.sourceSceneId)).toEqual(['sc1', 'sc2'])
    expect(() => reopened.start(jobs, '/output', 2)).toThrow('작업이 없습니다')
    expect(create).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenCalledTimes(8)
  })

  it('creates compact previews, keeps the full aspect ratio, updates each scene independently and restores without originals', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pixais-preview-test-'))
    try {
      const file = join(dir, 'synthetic.png')
      await sharp({ create: { width: 500, height: 300, channels: 3, background: '#338866' } })
        .png()
        .toFile(file)
      let saved: string | null = null
      const io = {
        read: () => saved,
        write: (text: string) => {
          saved = text
        }
      }
      const cache = new SceneThumbnails(io)
      await cache.remember('sc1', file)
      await cache.remember('sc2', file)
      await cache.remember('sc1', file)
      expect(cache.status().images?.map((i) => i.sceneId)).toEqual(['sc1', 'sc2'])
      const image = cache.status().images![0]
      const metadata = await sharp(Buffer.from(image.dataUrl.split(',')[1], 'base64')).metadata()
      expect(metadata.format).toBe('webp')
      expect(metadata.width).toBe(256)
      expect(metadata.height).toBe(154)
      expect(cache.status(cache.status().revision).images).toBeUndefined()
      const restarted = new SceneThumbnails(io)
      expect(restarted.status().images).toEqual(cache.status().images)
      const before = restarted.status()
      await restarted.remember('sc1', join(dir, 'missing.png'))
      expect(restarted.status()).toEqual(before)
      await restarted.remember(undefined, file)
      expect(restarted.status()).toEqual(before)
      io.write = () => {
        throw new Error('disk full')
      }
      await restarted.remember('sc3', file)
      expect(restarted.status()).toEqual(before)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('tolerates a corrupt cache and rejects non-image URLs with bounded retention', () => {
    expect(new SceneThumbnails({ read: () => 'invalid', write: () => {} }).status().images).toEqual(
      []
    )
    const image = { sceneId: 'sc1', savedAt: 1, dataUrl: 'data:image/webp;base64,AAAA' }
    const cache = new SceneThumbnails({
      read: () =>
        JSON.stringify([
          { ...image, dataUrl: 'file:///private' },
          ...Array.from({ length: 220 }, (_, i) => ({ ...image, sceneId: `sc${i}` }))
        ]),
      write: () => {}
    })
    expect(cache.status().images).toHaveLength(200)
    expect(
      cache.status().images?.every((i) => i.dataUrl.startsWith('data:image/webp;base64,'))
    ).toBe(true)
  })
})
