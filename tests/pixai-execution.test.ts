import { describe, it, expect, vi } from 'vitest'
import { buildPayload, type QueuedJob } from '../src/shared/pixai/execution'
import { expandReservations } from '../src/shared/pixai/library'
import { pixaiLibrary } from './fixtures/pixai-workspace'
import { PixaiRunner } from '../src/main/pixai/runner'
import { ApiError, PixaiClient, imageUrl } from '../src/main/pixai/client'
import { PixaiVault } from '../src/main/pixai/vault'

function job(id = 'job1'): QueuedJob {
  const library = pixaiLibrary()
  library.reservations = [
    {
      id: 'r1',
      presetId: 'p1',
      characterId: 'c1',
      sceneIds: ['s1'],
      count: 1,
      imageOptions: { aspectRatio: '5:3', size: '1k' }
    }
  ]
  return {
    request: expandReservations(library, { idFactory: () => id })[0],
    imageCount: 4,
    options: {
      maxCredits: null,
      filePrefix: '',
      repeat: 1,
      imageCount: 4,
      api: { aspectRatio: '3:5' }
    }
  }
}
// Inferred mock signatures are intentionally retained for failure injection.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function fixture() {
  let persisted: string | null = null
  const io = {
    read: () => persisted,
    write: vi.fn((text: string) => {
      persisted = text
    }),
    create: vi.fn(async () => '123'),
    task: vi.fn(async () => ({
      id: '123',
      status: 'completed',
      outputs: { mediaIds: ['11', '12', '13', '14'] }
    })),
    save: vi.fn(async (_job: unknown, id: string) => `/output/${id}.png`),
    sleep: vi.fn(async () => {})
  }
  return { io, runner: new PixaiRunner(io), saved: () => persisted }
}
async function finished(runner: PixaiRunner): Promise<void> {
  await vi.waitFor(() => expect(runner.status().running).toBe(false))
}
describe('PixAI generation boundary', () => {
  it('freezes 4-image landscape requests and does not duplicate LoRA triggers', () => {
    const payload = buildPayload(job(), 42)
    expect(payload).toMatchObject({
      modelVersionId: '100',
      aspectRatio: '5:3',
      batchSize: 4,
      seed: 42,
      promptHelper: 'disable',
      loras: [{ modelId: '200', weight: 0.5, triggerWords: '' }]
    })
    const bad = job()
    bad.request.configuration.loras[0].weight = 1.1
    expect(() => buildPayload(bad, 42)).toThrow('0~1')
    expect(() => buildPayload({ ...job(), imageCount: 0 }, 42)).toThrow('1장 또는 4장')
  })
  it('submits once, saves all four outputs, and does not resubmit after restart', async () => {
    const f = fixture()
    f.runner.start([job()], '/output', 2)
    await finished(f.runner)
    expect(f.io.create).toHaveBeenCalledOnce()
    expect(f.io.save).toHaveBeenCalledTimes(4)
    expect(f.runner.status().jobs[0]).toMatchObject({
      state: 'done',
      taskId: '123',
      files: ['/output/11.png', '/output/12.png', '/output/13.png', '/output/14.png']
    })
    const restored = new PixaiRunner(f.io)
    expect(() => restored.start([job()], '/output', 2)).toThrow('작업이 없습니다')
    expect(f.io.create).toHaveBeenCalledOnce()
  })
  it('persists the submitting marker before a paid call and blocks unknown retry', async () => {
    const f = fixture()
    f.io.create.mockImplementation(async () => {
      expect(JSON.parse(f.saved()!)[0].state).toBe('submitting')
      throw new ApiError('timeout')
    })
    f.runner.start([job()], '/output', 2)
    await finished(f.runner)
    expect(f.runner.status().jobs[0].state).toBe('submission_unknown')
    expect(() => new PixaiRunner(f.io).start([job()], '/output', 2)).toThrow('제출 여부')
    expect(f.io.create).toHaveBeenCalledOnce()
  })
  it('does not send a paid call if the submission journal write fails', async () => {
    const f = fixture()
    f.io.write
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error('disk full')
      })
    f.runner.start([job()], '/output', 2)
    await finished(f.runner)
    expect(f.io.create).not.toHaveBeenCalled()
  })
  it('handles a crash after server acceptance as unknown instead of a second POST', async () => {
    const f = fixture()
    const write = f.io.write.getMockImplementation()!
    f.io.write.mockImplementation((text) => {
      if (JSON.parse(text)[0]?.taskId) throw new Error('disk full')
      write(text)
    })
    f.runner.start([job()], '/output', 2)
    await finished(f.runner)
    expect(f.io.create).toHaveBeenCalledOnce()
    f.io.write.mockImplementation(write)
    const restored = new PixaiRunner(f.io)
    expect(restored.status().jobs[0].state).toBe('submission_unknown')
    expect(() => restored.start([job()], '/output', 2)).toThrow('제출 여부')
  })
  it('resumes a partial image save without creating another task or re-saving known outputs', async () => {
    const f = fixture()
    f.io.save.mockResolvedValueOnce('/output/11.png').mockRejectedValueOnce(new Error('disk full'))
    f.runner.start([job()], '/output', 1)
    await finished(f.runner)
    expect(f.runner.status().jobs[0]).toMatchObject({
      state: 'save_failed',
      files: ['/output/11.png']
    })
    const restored = new PixaiRunner(f.io)
    restored.start([job()], '/output', 1)
    await finished(restored)
    expect(f.io.create).toHaveBeenCalledOnce()
    expect(restored.status().jobs[0].files).toHaveLength(4)
    expect(f.io.save.mock.calls.filter((call) => call[1] === '11')).toHaveLength(1)
  })
  it('keeps task IDs on failed polling and refuses to delete unfinished work', async () => {
    const f = fixture()
    f.io.task.mockRejectedValueOnce(new Error('offline'))
    f.runner.start([job()], '/output', 1)
    await finished(f.runner)
    expect(f.runner.status().jobs[0]).toMatchObject({ state: 'check_required', taskId: '123' })
    expect(() => f.runner.remove(['job1'])).toThrow('미완료')
    f.runner.start([job()], '/output', 1)
    await finished(f.runner)
    expect(f.io.create).toHaveBeenCalledOnce()
  })
  it('recovers known paid work beside an unknown submission, and only unblocks POST after explicit dismissal', async () => {
    const f = fixture()
    f.io.create.mockResolvedValueOnce('123').mockRejectedValueOnce(new ApiError('offline'))
    f.runner.start([job(), job('job2'), job('job3')], '/output', 2)
    await finished(f.runner)
    expect(f.io.create).toHaveBeenCalledTimes(2)
    const restored = new PixaiRunner(f.io)
    restored.start([], '/output', 2)
    await finished(restored)
    expect(restored.status().jobs.map((item) => item.state)).toEqual([
      'done',
      'submission_unknown',
      'queued'
    ])
    expect(f.io.task).toHaveBeenCalledOnce()
    expect(f.io.create).toHaveBeenCalledTimes(2)
    expect(() => restored.dismissUnknown('job2', false)).toThrow()
    restored.dismissUnknown('job2', true)
    restored.start([job('job2')], '/output', 2)
    await finished(restored)
    expect(restored.status().jobs.map((item) => item.state)).toEqual(['done', 'cancelled', 'done'])
    expect(f.io.create).toHaveBeenCalledTimes(3)
  })
  it('moves only remaining output destinations after an explicit folder change', async () => {
    const f = fixture()
    f.io.save.mockResolvedValueOnce('/old/11.png').mockRejectedValueOnce(new Error('drive missing'))
    f.runner.start([job()], '/old', 1)
    await finished(f.runner)
    f.io.save.mockImplementation(
      async (value, id) => `${(value as { outputDir: string }).outputDir}/${id}.png`
    )
    const restored = new PixaiRunner(f.io)
    restored.start([], '/new', 1, true)
    await finished(restored)
    expect(restored.status().jobs[0].files).toEqual([
      '/old/11.png',
      '/new/12.png',
      '/new/13.png',
      '/new/14.png'
    ])
    expect(f.io.create).toHaveBeenCalledOnce()
    expect(f.io.save.mock.calls.filter((call) => call[1] === '11')).toHaveLength(1)
  })
  it('validates every request before enqueue and distinguishes definite rejection', async () => {
    const f = fixture()
    const bad = job('job2')
    bad.imageCount = 0
    expect(() => f.runner.start([job(), bad], '/output', 2)).toThrow()
    expect(f.runner.status().jobs).toEqual([])
    f.io.create.mockRejectedValueOnce(new ApiError('401', true))
    f.runner.start([job()], '/output', 2)
    await finished(f.runner)
    expect(f.runner.status().jobs[0].state).toBe('failed')
  })
  it('never sends credentials to image hosts and rejects redirects/untrusted URLs', async () => {
    const fetcher = vi.fn(
      async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } })
    )
    const client = new PixaiClient(() => 'test-key', fetcher)
    await client.image('https://d2doj8oszwtcqy.cloudfront.net/a.png')
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit', redirect: 'error' })
    expect(fetcher.mock.calls[0][1]).not.toHaveProperty('headers')
    for (const url of [
      'https://evil.example/image',
      'http://pixai.art/a',
      'https://pixai.art.evil.example/a',
      'https://user:pass@pixai.art/a'
    ])
      expect(() => imageUrl(url)).toThrow()
  })
  it('keeps server response secrets out of errors and classifies 5xx conservatively', async () => {
    const client = new PixaiClient(
      () => 'secret-key',
      vi.fn(async () => new Response('secret-key prompt text', { status: 500 }))
    )
    const error = await client.create(buildPayload(job(), 1)).catch((e) => e)
    expect(error.message).not.toContain('secret-key')
    expect(error.message).not.toContain('prompt text')
    expect(error.notSubmitted).toBe(false)
  })
  it('uses OS ciphertext only when opted in, and removes saved keys in session-only mode', () => {
    let saved: string | null = null
    const io = {
      read: () => saved,
      write: (v: string) => {
        saved = v
      },
      available: () => true,
      encrypt: vi.fn(() => Buffer.from('ciphertext')),
      decrypt: vi.fn(() => 'test-key')
    }
    const vault = new PixaiVault(io)
    vault.connect('test-key', true)
    expect(saved).not.toContain('test-key')
    expect(vault.remembered).toBe(true)
    const restored = new PixaiVault(io)
    expect(restored.get()).toBe('test-key')
    restored.connect('another-key', false)
    expect(saved).toBe('')
    expect(restored.remembered).toBe(false)
    restored.forget()
    expect(restored.get()).toBe('')
    const unavailable = new PixaiVault({ ...io, available: () => false })
    expect(() => unavailable.connect('test', true)).toThrow('보호 저장')
  })
})
