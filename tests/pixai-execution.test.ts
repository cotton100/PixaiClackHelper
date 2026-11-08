import { describe, it, expect, vi } from 'vitest'
import {
  buildPayload,
  type ExecutionJob,
  type QueuedJob,
  type SavedMedia
} from '../src/shared/pixai/execution'
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
    save: vi.fn(async (_job: unknown, id: string): Promise<SavedMedia> => ({
      path: `/output/${id}.png`
    })),
    sleep: vi.fn(async () => {})
  }
  return { io, runner: new PixaiRunner(io), saved: () => persisted }
}
async function finished(runner: PixaiRunner): Promise<void> {
  await vi.waitFor(() => expect(runner.status().running).toBe(false))
}
describe('PixAI generation boundary', () => {
  it('keeps the original registration date through status updates and runner restart', async () => {
    const f = fixture()
    f.runner.start([{ ...job(), registeredAt: 1700000000000 }], '/output', 1)
    await finished(f.runner)
    expect(f.runner.status().jobs[0]).toMatchObject({ state: 'done', registeredAt: 1700000000000 })
    expect(new PixaiRunner(f.io).status().jobs[0].registeredAt).toBe(1700000000000)
  })
  it('preserves original-save warnings through a later failure, recovery and completed restart without resubmitting', async () => {
    const f = fixture()
    const warning = '생성 요청 정보를 추가하지 못해 원본 그대로 저장했습니다.'
    f.io.save
      .mockResolvedValueOnce({ path: '/output/11.png', warning })
      .mockRejectedValueOnce(new Error('disk full'))
    f.runner.start([job()], '/output', 1, false, true)
    await finished(f.runner)
    expect(f.runner.status().jobs[0]).toMatchObject({
      state: 'save_failed',
      files: ['/output/11.png'],
      warnings: [`1번째 이미지: ${warning}`]
    })
    f.io.save.mockResolvedValueOnce({ path: '/output/12.png', warning })
    const restored = new PixaiRunner(f.io)
    restored.start([], '/output', 1, false, false)
    await finished(restored)
    const reopened = new PixaiRunner(f.io)
    expect(reopened.status().jobs[0]).toMatchObject({
      state: 'done',
      error: '',
      embedMetadata: true,
      files: ['/output/11.png', '/output/12.png', '/output/13.png', '/output/14.png'],
      warnings: [`1번째 이미지: ${warning}`, `2번째 이미지: ${warning}`]
    })
    expect(f.io.save.mock.calls.filter((call) => call[1] === '11')).toHaveLength(1)
    expect(f.io.create).toHaveBeenCalledOnce()
  })
  it('freezes metadata consent and reference IDs before submission and preserves them on recovery', async () => {
    const f = fixture()
    f.io.save.mockRejectedValueOnce(new Error('disk full'))
    f.runner.start([job()], '/output', 2, false, true)
    await finished(f.runner)
    expect(f.runner.status().jobs[0]).toMatchObject({
      embedMetadata: true,
      metadataReferences: { modelId: '10', loraModelIds: ['20'] },
      state: 'save_failed'
    })
    const restored = new PixaiRunner(f.io)
    restored.start([], '/output', 2, false, false)
    await finished(restored)
    expect(restored.status().jobs[0].embedMetadata).toBe(true)
    expect(f.io.create).toHaveBeenCalledOnce()
  })
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
  it('keeps all twelve LoRAs in order when building, persisting and restoring a request', async () => {
    const input = job()
    input.request.configuration.loras = Array.from({ length: 12 }, (_, index) => ({
      id: String(30 + index),
      versionId: String(300 + index),
      name: `LoRA ${index + 1}`,
      weight: index / 12,
      triggerWords: `trigger-${index + 1}`
    }))
    const expected = input.request.configuration.loras.map((lora) => ({
      modelId: lora.versionId,
      weight: lora.weight,
      triggerWords: ''
    }))
    const before = structuredClone(input)
    expect(buildPayload(input, 42).loras).toEqual(expected)
    expect(input).toEqual(before)
    const f = fixture()
    f.runner.start([input], '/output', 1, false, true)
    await finished(f.runner)
    expect(f.io.create).toHaveBeenCalledOnce()
    expect(f.runner.status().jobs[0].payload.loras).toEqual(expected)
    expect(new PixaiRunner(f.io).status().jobs[0]).toMatchObject({
      state: 'done',
      payload: { loras: expected },
      metadataReferences: { loraModelIds: input.request.configuration.loras.map((lora) => lora.id) }
    })
  })
  it('still rejects invalid IDs, weights and duplicate versions after the fifth LoRA', () => {
    const input = job()
    input.request.configuration.loras = Array.from({ length: 12 }, (_, index) => ({
      id: String(30 + index),
      versionId: String(300 + index),
      name: '',
      weight: 0.5
    }))
    const invalidId = structuredClone(input)
    invalidId.request.configuration.loras[11].versionId = 'not-an-id'
    expect(() => buildPayload(invalidId, 42)).toThrow('숫자 문자열')
    const invalidWeight = structuredClone(input)
    invalidWeight.request.configuration.loras[11].weight = 1.1
    expect(() => buildPayload(invalidWeight, 42)).toThrow('0~1')
    const duplicate = structuredClone(input)
    duplicate.request.configuration.loras[11].versionId = '300'
    expect(() => buildPayload(duplicate, 42)).toThrow('같은 LoRA 버전')
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
    f.io.save
      .mockResolvedValueOnce({ path: '/output/11.png' })
      .mockRejectedValueOnce(new Error('disk full'))
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
    f.io.save
      .mockResolvedValueOnce({ path: '/old/11.png' })
      .mockRejectedValueOnce(new Error('drive missing'))
    f.runner.start([job()], '/old', 1)
    await finished(f.runner)
    f.io.save.mockImplementation(async (value, id) => ({
      path: `${(value as { outputDir: string }).outputDir}/${id}.png`
    }))
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
  it.each([400, 403, 422, 500])(
    'stops on an actual client HTTP %i response after submitting seven LoRAs, preserving accepted and queued work',
    async (httpStatus) => {
      let persisted: string | null = null
      let deliverResponse!: (response: Response) => void
      const pendingResponse = new Promise<Response>((resolve) => {
        deliverResponse = resolve
      })
      const fetcher = vi.fn<typeof fetch>()
      fetcher
        .mockResolvedValueOnce(new Response(JSON.stringify({ id: '123' }), { status: 201 }))
        .mockImplementationOnce(() => pendingResponse)
      const client = new PixaiClient(() => 'synthetic-test-key', fetcher)
      const io = {
        read: () => persisted,
        write: (text: string) => {
          persisted = text
        },
        create: (value: ExecutionJob) => client.create(value.payload),
        task: (id: string) => client.task(id),
        save: vi.fn(async (): Promise<SavedMedia> => ({ path: '/output/unexpected.png' })),
        sleep: vi.fn(async () => {})
      }
      const runner = new PixaiRunner(io)
      const second = job('job2')
      second.request.configuration.loras = Array.from({ length: 7 }, (_, index) => ({
        id: String(30 + index),
        versionId: String(300 + index),
        name: `LoRA ${index + 1}`,
        weight: 0.5
      }))
      const expectedLoras = second.request.configuration.loras.map((lora) => ({
        modelId: lora.versionId,
        weight: lora.weight,
        triggerWords: ''
      }))
      expect(() => runner.start([job(), second, job('job3')], '/output', 3)).not.toThrow()
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
      expect(runner.status().running).toBe(true)
      expect(runner.status().jobs.map((value) => value.state)).toEqual([
        'waiting',
        'submitting',
        'queued'
      ])
      expect(runner.status().jobs[0].taskId).toBe('123')
      expect(fetcher.mock.calls[1][0]).toBe('https://api.pixai.art/v2/image/create')
      expect(fetcher.mock.calls[1][1]?.method).toBe('POST')
      expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).loras).toEqual(expectedLoras)
      deliverResponse(new Response('synthetic rejection', { status: httpStatus }))
      await finished(runner)
      const status = runner.status()
      expect(status.running).toBe(false)
      expect(status.error).toContain('생성 요청을 중단')
      expect(status.jobs.map((value) => value.state)).toEqual([
        'waiting',
        httpStatus === 500 ? 'submission_unknown' : 'failed',
        'queued'
      ])
      expect(status.jobs[1].error).toContain(`공식 API 오류 (${httpStatus})`)
      expect(status.jobs[1].taskId).toBeUndefined()
      expect(status.jobs[2].taskId).toBeUndefined()
      expect(fetcher).toHaveBeenCalledTimes(2)
      expect(io.save).not.toHaveBeenCalled()
      expect(io.sleep).not.toHaveBeenCalled()
      const reopened = new PixaiRunner(io).status()
      expect(reopened.running).toBe(false)
      expect(reopened.jobs).toEqual(status.jobs)
      expect(reopened.jobs[0]).toMatchObject({ state: 'waiting', taskId: '123' })
      expect(reopened.jobs[2].state).toBe('queued')
      expect(fetcher).toHaveBeenCalledTimes(2)
    }
  )
  it.each(['failed', 'cancelled'])(
    'stops after the server task reports %s without submitting the next queued job',
    async (taskStatus) => {
      let persisted: string | null = null
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(JSON.stringify({ id: '123' }), { status: 201 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: '123', status: taskStatus }), { status: 200 })
        )
      const client = new PixaiClient(() => 'synthetic-test-key', fetcher)
      const io = {
        read: () => persisted,
        write: (text: string) => {
          persisted = text
        },
        create: (value: ExecutionJob) => client.create(value.payload),
        task: (id: string) => client.task(id),
        save: vi.fn(async (): Promise<SavedMedia> => ({ path: '/output/unexpected.png' })),
        sleep: vi.fn(async () => {})
      }
      const runner = new PixaiRunner(io)
      runner.start([job(), job('job2'), job('job3')], '/output', 1)
      await finished(runner)
      const status = runner.status()
      expect(status.running).toBe(false)
      expect(status.jobs.map((value) => value.state)).toEqual(['failed', 'queued', 'queued'])
      expect(status.jobs[0]).toMatchObject({ state: 'failed', taskId: '123' })
      expect(status.jobs[0].error).toContain('서버가 생성 실패 또는 취소를 보고')
      expect(status.jobs[1].taskId).toBeUndefined()
      expect(status.jobs[2].taskId).toBeUndefined()
      expect(fetcher.mock.calls.map(([url, options]) => [url, options?.method])).toEqual([
        ['https://api.pixai.art/v2/image/create', 'POST'],
        ['https://api.pixai.art/v1/task/123', 'GET']
      ])
      expect(io.save).not.toHaveBeenCalled()
      expect(new PixaiRunner(io).status().jobs).toEqual(status.jobs)
      expect(fetcher).toHaveBeenCalledTimes(2)
    }
  )
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

it('preserves reservation batch identity through runner persistence and a restart without adding API payload fields', async () => {
  const { runner, io, saved } = fixture()
  const input = job()
  input.request.composition.reservation.batch = {
    id: 'b1',
    name: '표정 묶음',
    rowName: 'Alice',
    columnName: '웃음'
  }
  runner.start([input], '/output', 1)
  await finished(runner)
  expect(runner.status().jobs[0]).toMatchObject({
    batchId: 'b1',
    batchName: '표정 묶음',
    state: 'done'
  })
  expect(runner.status().jobs[0].payload).not.toHaveProperty('batchId')
  const restarted = new PixaiRunner({ ...io, read: () => saved() })
  expect(restarted.status().jobs[0]).toMatchObject({ batchId: 'b1', batchName: '표정 묶음' })
  expect(io.create).toHaveBeenCalledTimes(1)
})
