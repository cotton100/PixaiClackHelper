/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { request as httpRequest, createServer } from 'node:http'
import { LibrarySyncServer, LIBRARY_SYNC_PORT, syncHash } from '../src/main/pixai/library-sync'
import { makeLibrary } from '../src/shared/pixai/library'
import { projectSyncLibrary, type SyncLibrary } from '../src/shared/pixai/library-sync'
import type { SyncExchange } from '../src/shared/pixai/execution'
import { MAX_WORKSPACE_BYTES } from '../src/shared/pixai/expansion-budget'
import { LibrarySyncApplyBridge } from '../src/main/pixai/library-sync-apply-bridge'
import type { LibrarySyncApplyRequest } from '../src/shared/pixai/execution'

// Keep the real HTTP path/Host/auth contract, but never bind the installed app's port.
const testListener = vi.hoisted(() => ({ port: 0 }))
vi.mock('node:http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:http')>()
  return {
    ...actual,
    createServer: (...args: Parameters<typeof actual.createServer>) => {
      const server = actual.createServer(...args)
      const listen = server.listen
      vi.spyOn(server, 'listen').mockImplementation((...listenArgs: unknown[]) => {
        if (listenArgs[0] === 50321) listenArgs[0] = testListener.port
        return Reflect.apply(listen, server, listenArgs)
      })
      return server
    }
  }
})
beforeAll(async () => {
  const probe = createServer()
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', resolve)
  })
  testListener.port = (probe.address() as import('node:net').AddressInfo).port
  await new Promise<void>((resolve) => probe.close(() => resolve()))
})

const active: LibrarySyncServer[] = []
afterEach(async () => {
  vi.useRealTimers()
  for (const server of active.splice(0)) await server.close()
})
const empty = () => projectSyncLibrary(makeLibrary())
function material(id: string): SyncLibrary {
  const value = empty()
  value.scenes.push({ id, name: id, prompt: id, negativePrompt: '' })
  return value
}
function call(
  path: string,
  body: unknown,
  token?: string,
  options: {
    method?: string
    headers?: Record<string, string>
    raw?: string
  } = {}
) {
  return new Promise<{
    status: number
    body: SyncExchange & { token?: string; error?: string }
    headers: Record<string, unknown>
  }>((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: testListener.port,
        path: `/v1/library-sync/${path}`,
        method: options.method ?? 'POST',
        headers: {
          Host: `127.0.0.1:${LIBRARY_SYNC_PORT}`,
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...options.headers
        }
      },
      (res) => {
        let text = ''
        res.on('data', (chunk) => {
          text += chunk
        })
        res.on('end', () =>
          resolve({ status: res.statusCode!, body: JSON.parse(text), headers: res.headers })
        )
      }
    )
    req.on('error', reject)
    req.end(options.raw ?? JSON.stringify(body))
  })
}
function fixture() {
  let saved: string | null = null
  let current = empty()
  let now = 1_000_000
  const apply = vi.fn(async (expected: SyncLibrary, next: SyncLibrary) => {
    expect(current).toEqual(expected)
    current = structuredClone(next)
  })
  const write = vi.fn((value: string) => {
    saved = value
  })
  const create = () => {
    const server = new LibrarySyncServer({
      read: () => structuredClone(current),
      apply,
      readState: () => saved,
      writeState: write,
      now: () => now
    })
    active.push(server)
    return server
  }
  return {
    create,
    apply,
    write,
    get saved() {
      return saved
    },
    get current() {
      return current
    },
    replaceSaved(value: string) {
      saved = value
    },
    setCurrent(value: SyncLibrary) {
      current = structuredClone(value)
    },
    advance(ms: number) {
      now += ms
    }
  }
}
async function connect(server: LibrarySyncServer) {
  expect((await server.enable(true)).listening).toBe(true)
  const status = await server.newPair()
  const result = await call('pair', { code: status.code })
  expect(result.status).toBe(200)
  return result.body.token as string
}
async function propose(token: string, script: SyncLibrary) {
  const result = await call(
    'exchange',
    { library: script, automatic: false, requestSync: true },
    token
  )
  expect(result.status).toBe(200)
  expect(result.body.state).toBe('preview')
  return result.body as SyncExchange
}

describe('new material folder client compatibility', () => {
  const headers = { 'X-Pixai-Library-Features': 'material-folders-v1' }
  it('blocks an old client before preview or writes while a supported client can apply and ack', async () => {
    const io = fixture(),
      server = io.create(),
      token = await connect(server)
    const app = empty()
    app.presetFolders = [{ id: 'pf', name: 'Preset folder' }]
    app.commonPresetFolders = [{ id: 'cf', name: 'Common folder' }]
    io.setCurrent(app)
    const blocked = await call(
      'exchange',
      { library: empty(), automatic: true, requestSync: true },
      token
    )
    expect(blocked.body.state).toBe('blocked')
    expect(blocked.body.message).toContain('0.10.22')
    expect(io.apply).not.toHaveBeenCalled()
    expect(JSON.parse(io.saved!)).not.toHaveProperty('pending')
    const preview = await call(
      'exchange',
      { library: empty(), automatic: false, requestSync: true },
      token,
      { headers }
    )
    expect(preview.body.state).toBe('preview')
    const id = preview.body.proposal.id
    const approved = await call('approve', { id, choices: {} }, token, { headers })
    expect(approved.body.state).toBe('apply')
    expect(approved.body.library.presetFolders).toEqual(app.presetFolders)
    expect((await call('ack', { id, library: approved.body.library }, token)).body.state).toBe(
      'blocked'
    )
    expect(JSON.parse(io.saved!)).toHaveProperty('pending')
    expect(
      (await call('ack', { id, library: approved.body.library }, token, { headers })).body.state
    ).toBe('idle')
    expect(JSON.parse(io.saved!).baseline.commonPresetFolders).toEqual(app.commonPresetFolders)
  })
  it('does not mistake an old client for folder deletion after the app clears its final folder', async () => {
    const io = fixture(),
      server = io.create(),
      token = await connect(server)
    const app = empty()
    app.presetFolders = [{ id: 'pf', name: 'Preset folder' }]
    io.setCurrent(app)
    const preview = await call(
      'exchange',
      { library: empty(), automatic: false, requestSync: true },
      token,
      { headers }
    )
    const id = preview.body.proposal.id
    const approved = await call('approve', { id, choices: {} }, token, { headers })
    await call('ack', { id, library: approved.body.library }, token, { headers })
    io.setCurrent(empty())
    const savedBefore = io.saved
    expect((await call('exchange', { library: empty(), automatic: true }, token)).body.state).toBe(
      'blocked'
    )
    expect(io.saved).toBe(savedBefore)
    const next = await call('exchange', { library: app, automatic: true }, token, { headers })
    expect(next.body.state).toBe('apply')
    expect(next.body.library).not.toHaveProperty('presetFolders')
  })
})

describe('loopback sync boundary', () => {
  it('starts disabled, requires explicit enable/pair and stores only token hash', async () => {
    const io = fixture(),
      server = io.create()
    await server.start()
    expect(server.status()).toMatchObject({ enabled: false, listening: false, paired: false })
    const token = await connect(server)
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(io.saved).not.toContain(token)
    expect(JSON.parse(io.saved!).tokenHash).toMatch(/^[a-f0-9]{64}$/)
    expect(server.status()).not.toHaveProperty('tokenHash')
    expect(server.status()).not.toHaveProperty('code')
    expect((await call('pair', { code: 'used-or-wrong' })).status).toBe(401)
    expect((await call('exchange', { library: empty(), automatic: true }, token)).body.state).toBe(
      'idle'
    )
    expect(io.apply).not.toHaveBeenCalled()
  })
  it('rejects auth, origin, host, methods, query paths, content type and oversized requests', async () => {
    const io = fixture(),
      token = await connect(io.create())
    const payload = { library: empty(), automatic: false }
    expect((await call('exchange', payload)).status).toBe(401)
    expect((await call('exchange', payload, 'wrong')).status).toBe(401)
    expect(
      (
        await call('exchange', payload, token, {
          headers: { Host: `localhost:${LIBRARY_SYNC_PORT}` }
        })
      ).status
    ).toBe(403)
    expect(
      (await call('exchange', payload, token, { headers: { Origin: 'https://evil.example' } }))
        .status
    ).toBe(403)
    expect((await call('exchange', payload, token, { headers: { Origin: 'null' } })).status).toBe(
      403
    )
    expect(
      (await call('pair', { code: 'x' }, undefined, { headers: { Origin: 'https://pixai.art' } }))
        .status
    ).toBe(403)
    const allowed = await call('exchange', payload, token, {
      headers: { Origin: 'https://pixai.art' }
    })
    expect(allowed.status).toBe(200)
    expect(allowed.headers).not.toHaveProperty('access-control-allow-origin')
    expect((await call('exchange', payload, token, { method: 'GET' })).status).toBe(405)
    expect((await call('exchange', payload, token, { method: 'OPTIONS' })).status).toBe(405)
    expect((await call('exchange?q=x', payload, token)).status).toBe(404)
    expect((await call('other', payload, token)).status).toBe(404)
    expect(
      (await call('exchange', payload, token, { headers: { 'Content-Type': 'text/plain' } })).status
    ).toBe(415)
    expect(
      (
        await call('exchange', payload, token, {
          headers: { 'Content-Length': String(MAX_WORKSPACE_BYTES + 1) }
        })
      ).status
    ).toBe(413)
    expect((await call('exchange', payload, token, { raw: '{broken' })).status).toBe(400)
    expect((await call('exchange', { ...payload, apiKey: 'no' }, token)).status).toBe(400)
    expect(io.apply).not.toHaveBeenCalled()
  })
  it('expires and rate-limits codes; new code and disconnect revoke previous tokens', async () => {
    const io = fixture(),
      server = io.create()
    await server.enable(true)
    const code = (await server.newPair()).code
    expect(code!.length).toBeGreaterThanOrEqual(22)
    io.advance(5 * 60_000)
    expect((await call('pair', { code })).status).toBe(401)
    for (let n = 0; n < 4; n++) expect((await call('pair', { code: 'wrong' })).status).toBe(401)
    expect((await call('pair', { code: 'wrong' })).status).toBe(429)
    io.advance(60_001)
    const token = await connect(server)
    await server.newPair()
    expect((await call('exchange', { library: empty(), automatic: false }, token)).status).toBe(401)
    const next = await call('pair', { code: server.status().code })
    await server.disconnect()
    expect(
      (await call('exchange', { library: empty(), automatic: false }, next.body.token)).status
    ).toBe(401)
  })
  it('reports occupied port without switching interface/port or enabling a second listener', async () => {
    const occupied = createServer()
    await new Promise<void>((resolve) => occupied.listen(LIBRARY_SYNC_PORT, '127.0.0.1', resolve))
    try {
      const status = await fixture().create().enable(true)
      expect(status).toMatchObject({ enabled: true, listening: false })
      expect(status.message).toContain('50321')
    } finally {
      await new Promise<void>((resolve) => occupied.close(() => resolve()))
    }
  })
  it('rechecks authentication after a slow request body and closes rejected uploads', async () => {
    const io = fixture(),
      server = io.create(),
      token = await connect(server)
    let finish!: () => void
    const result = new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: testListener.port,
          path: '/v1/library-sync/exchange',
          method: 'POST',
          headers: {
            Host: `127.0.0.1:${LIBRARY_SYNC_PORT}`,
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          }
        },
        (res) => {
          res.resume()
          res.on('end', () => resolve(res.statusCode!))
        }
      )
      req.on('error', reject)
      req.write('{"library":')
      finish = () => req.end(`${JSON.stringify(empty())},"automatic":false}`)
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    await server.disconnect()
    finish()
    expect(await result).toBe(401)
    expect(io.apply).not.toHaveBeenCalled()
  })
  it('preserves invalid journal text and remains off until explicit disconnect', async () => {
    const io = fixture()
    io.replaceSaved('{broken')
    const server = io.create()
    await server.start()
    expect(server.status()).toMatchObject({ enabled: false, listening: false, paired: false })
    expect(server.status().message).toContain('기록')
    expect(io.saved).toBe('{broken')
    await expect(server.enable(true)).rejects.toThrow()
    await server.disconnect()
    expect((await server.enable(true)).listening).toBe(true)
  })
})

describe('durable sync handshake', () => {
  it('retains ownership of a delayed save so restored data cannot be acknowledged ahead of it', async () => {
    const io = fixture(),
      server = io.create(),
      token = await connect(server)
    const restored = material('x')
    io.setCurrent(restored)
    const initial = (await propose(token, restored)).proposal!
    const initialOutput = (await call('approve', { id: initial.id, choices: {} }, token)).body
    await call('ack', { id: initial.id, library: initialOutput.library }, token)
    const deletion = (await propose(token, empty())).proposal!
    let applyRequest: LibrarySyncApplyRequest | undefined
    const bridge = new LibrarySyncApplyBridge({
      send: (request) => {
        applyRequest = request
      }
    })
    io.apply.mockImplementation((expected, next) => bridge.apply(expected, next))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    let approved = false
    const approval = server.approve(deletion.id, {}).then((status) => {
      approved = true
      return status
    })
    await Promise.resolve()
    expect(bridge.pendingCount).toBe(1)
    expect(applyRequest!.next).toEqual(empty())
    await vi.advanceTimersByTimeAsync(10_001)
    expect(Date.now()).toBeGreaterThan(applyRequest!.expiresAt)
    expect(approved).toBe(false)
    expect(JSON.parse(io.saved!).pending).toMatchObject({ id: deletion.id, phase: 'prepared' })
    // User restores x on the script while the renderer's earlier storage write is still pending.
    let requested = false,
      exchanged = false
    const request = server.request().then(() => {
      requested = true
    })
    const exchange = call(
      'exchange',
      { library: restored, automatic: true, requestSync: true },
      token
    ).then((result) => {
      exchanged = true
      return result
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(requested).toBe(false)
    expect(exchanged).toBe(false)
    expect(bridge.pendingCount).toBe(1)
    expect(io.current).toEqual(restored)
    // The in-flight renderer write conclusively completes; only its explicit reply releases ownership.
    io.setCurrent(applyRequest!.next)
    bridge.reply({ id: applyRequest!.id, ok: true })
    await approval
    await request
    const fresh = (await exchange).body
    vi.useRealTimers()
    expect(fresh.state).toBe('preview')
    expect(fresh.proposal).toMatchObject({ appCount: 0, scriptCount: 1, mergedCount: 0 })
    expect(fresh.proposal!.id).not.toBe(deletion.id)
    expect(JSON.parse(io.saved!).baseline).toEqual(restored)
    expect(JSON.parse(io.saved!)).not.toHaveProperty('pending')
    // No second no-op approval/ack has overtaken the save. The user can review/cancel the deletion
    // preview and intentionally restore the app row before requesting synchronization again.
    await server.cancel(fresh.proposal!.id)
    io.setCurrent(restored)
    expect(
      (await call('exchange', { library: restored, automatic: true, requestSync: true }, token))
        .body.state
    ).toBe('idle')
    expect((await call('exchange', { library: restored, automatic: true }, token)).body.state).toBe(
      'idle'
    )
    expect(io.current).toEqual(restored)
    expect(bridge.pendingCount).toBe(0)
  })

  it('shows the already resolved output after a guarded failure and restart', async () => {
    const io = fixture(),
      server = io.create(),
      token = await connect(server)
    io.setCurrent(material('x'))
    const script = material('x')
    script.scenes[0].prompt = 'chosen script edit'
    const preview = (await propose(token, script)).proposal!
    expect(preview.conflicts).toHaveLength(1)
    io.apply.mockRejectedValueOnce(new Error('미저장 입력'))
    const first = (
      await call('approve', { id: preview.id, choices: { 'scenes:x': 'script' } }, token)
    ).body
    expect(first).toMatchObject({
      state: 'blocked',
      proposal: { library: script, conflicts: [], mergedCount: 1 }
    })
    await server.close()
    await io.create().start()
    io.apply.mockRejectedValueOnce(new Error('미저장 입력'))
    const retried = (await call('approve', { id: preview.id, choices: {} }, token)).body
    expect(retried).toMatchObject({
      state: 'blocked',
      proposal: { library: script, conflicts: [], mergedCount: 1 }
    })
    const completed = (await call('approve', { id: preview.id, choices: {} }, token)).body
    expect(completed).toMatchObject({ state: 'apply', library: script })
    expect(io.current).toEqual(script)
  })
  it('previews first union, applies through callback, and advances baseline only after exact ack', async () => {
    const io = fixture(),
      server = io.create(),
      token = await connect(server)
    io.setCurrent(material('app'))
    const script = material('script'),
      preview = (await propose(token, script)).proposal!
    expect(preview).toMatchObject({ initial: true, appCount: 1, scriptCount: 1, mergedCount: 2 })
    expect(io.apply).not.toHaveBeenCalled()
    const applied = await call('approve', { id: preview.id, choices: {} }, token)
    expect(applied.body).toMatchObject({
      state: 'apply',
      transactionId: preview.id,
      expectedScriptHash: syncHash(script)
    })
    expect(io.apply).toHaveBeenCalledTimes(1)
    expect(JSON.parse(io.saved!)).not.toHaveProperty('baseline')
    expect((await call('ack', { id: preview.id, library: empty() }, token)).status).toBe(409)
    expect((await call('cancel', { id: preview.id }, token)).status).toBe(409)
    expect((await call('approve', { id: preview.id, choices: {} }, token)).body).toEqual(
      applied.body
    )
    expect(io.apply).toHaveBeenCalledTimes(1)
    const ack = await call('ack', { id: preview.id, library: applied.body.library }, token)
    expect(ack.body).toEqual({ state: 'idle' })
    expect(JSON.parse(io.saved!).baseline).toEqual(applied.body.library)
    expect(
      (await call('ack', { id: preview.id, library: applied.body.library }, token)).body
    ).toEqual({ state: 'idle' })
    expect(
      (await call('exchange', { library: applied.body.library, automatic: true }, token)).body
    ).toEqual({ state: 'idle' })
    expect(io.apply).toHaveBeenCalledTimes(1)
  })
  it('recovers pending delivery and lost ack response across restart without reapplying', async () => {
    const io = fixture(),
      server = io.create(),
      token = await connect(server)
    const script = material('script'),
      id = (await propose(token, script)).proposal!.id
    const output = (await call('approve', { id, choices: {} }, token)).body
    await server.close()
    const resumed = io.create()
    await resumed.start()
    expect((await call('exchange', { library: script, automatic: false }, token)).body).toEqual(
      output
    )
    // Script's save succeeded, but its ack was interrupted: output-equal poll still gets same transaction.
    expect(
      (await call('exchange', { library: output.library, automatic: false }, token)).body
    ).toEqual(output)
    expect(io.apply).toHaveBeenCalledTimes(1)
    await call('ack', { id, library: output.library }, token)
    await resumed.close()
    await io.create().start()
    expect((await call('ack', { id, library: output.library }, token)).body).toEqual({
      state: 'idle'
    })
  })
  it('rejects stale app previews and remote changes before delivery while keeping baseline unchanged', async () => {
    const io = fixture(),
      server = io.create(),
      token = await connect(server)
    const script = material('script'),
      preview = (await propose(token, script)).proposal!
    io.setCurrent(material('new-app'))
    expect((await call('approve', { id: preview.id, choices: {} }, token)).body.state).toBe(
      'blocked'
    )
    expect(io.apply).not.toHaveBeenCalled()
    const fresh = (await propose(token, script)).proposal!
    await call('approve', { id: fresh.id, choices: {} }, token)
    const remote = material('remote-edit')
    const blocked = await call('exchange', { library: remote, automatic: true }, token)
    expect(blocked.body.state).toBe('blocked')
    expect(blocked.body).not.toHaveProperty('library')
    expect(JSON.parse(io.saved!)).not.toHaveProperty('baseline')
    expect((await propose(token, remote)).proposal!.id).not.toBe(fresh.id)
  })
  it('blocks unsaved/busy renderer and keeps a retryable durable transaction', async () => {
    const io = fixture(),
      server = io.create(),
      token = await connect(server)
    const id = (await propose(token, material('script'))).proposal!.id
    io.apply.mockRejectedValueOnce(new Error('미저장 입력을 먼저 저장해 주세요.'))
    const blocked = await call('approve', { id, choices: {} }, token)
    expect(blocked.body.state).toBe('blocked')
    expect(io.current).toEqual(empty())
    expect(JSON.parse(io.saved!).pending.phase).toBe('prepared')
    expect((await call('approve', { id, choices: {} }, token)).body.state).toBe('apply')
  })
  it('recovers lost renderer reply only if actual persisted result matches', async () => {
    const io = fixture(),
      server = io.create(),
      token = await connect(server)
    const id = (await propose(token, material('script'))).proposal!.id
    io.apply.mockImplementationOnce(async (_expected, next) => {
      io.setCurrent(next)
      throw new Error('response lost')
    })
    expect((await call('approve', { id, choices: {} }, token)).body.state).toBe('apply')
    expect(JSON.parse(io.saved!).pending.phase).toBe('outgoing')
  })
  it('recovers the crash gap after app commit but before outgoing journal write', async () => {
    const io = fixture(),
      server = io.create(),
      token = await connect(server)
    const script = material('script'),
      id = (await propose(token, script)).proposal!.id
    const write = io.write.getMockImplementation()!
    io.write.mockImplementationOnce(write).mockImplementationOnce(() => {
      throw new Error('synthetic disk failure')
    })
    expect((await call('approve', { id, choices: {} }, token)).status).toBe(400)
    expect(JSON.parse(io.saved!).pending.phase).toBe('prepared')
    expect(io.current).toEqual(script)
    await server.close()
    await io.create().start()
    const resumed = await call('exchange', { library: script, automatic: false }, token)
    expect(resumed.body).toMatchObject({ state: 'apply', transactionId: id })
    expect(io.apply).toHaveBeenCalledTimes(1)
    await call('ack', { id, library: resumed.body.library }, token)
    expect(JSON.parse(io.saved!).baseline).toEqual(script)
  })
  it('preserves a CAS race and allows explicit resync or cancellation of unapplied preview', async () => {
    const io = fixture(),
      server = io.create(),
      token = await connect(server)
    const script = material('script'),
      id = (await propose(token, script)).proposal!.id
    io.apply.mockImplementationOnce(async () => {
      io.setCurrent(material('concurrent-local'))
      throw new Error('WORKSPACE_CONFLICT')
    })
    expect((await call('approve', { id, choices: {} }, token)).body.state).toBe('blocked')
    expect(io.current.scenes[0].id).toBe('concurrent-local')
    await server.request()
    const fresh = await call('exchange', { library: script, automatic: true }, token)
    expect(fresh.body.state).toBe('preview')
    expect(fresh.body.proposal.id).not.toBe(id)
    io.apply.mockRejectedValueOnce(new Error('미저장 입력'))
    await call('approve', { id: fresh.body.proposal.id, choices: {} }, token)
    expect((await call('cancel', { id: fresh.body.proposal.id }, token)).status).toBe(409)
    await server.request()
    const refreshed = await call('exchange', { library: script, automatic: true }, token)
    expect(refreshed.body.state).toBe('preview')
    expect((await call('cancel', { id: refreshed.body.proposal.id }, token)).body.state).toBe(
      'idle'
    )
    expect(JSON.parse(io.saved!)).not.toHaveProperty('pending')
    expect(io.current.scenes[0].id).toBe('concurrent-local')
  })
  it('retains app edits made after output transfer and merges them after ack', async () => {
    const io = fixture(),
      server = io.create(),
      token = await connect(server)
    const id = (await propose(token, material('script'))).proposal!.id
    const output = (await call('approve', { id, choices: {} }, token)).body.library
    const edited = structuredClone(io.current)
    edited.scenes.push(material('later-app').scenes[0])
    io.setCurrent(edited)
    await call('ack', { id, library: output }, token)
    expect(io.current).toEqual(edited)
    const next = await call('exchange', { library: output, automatic: true }, token)
    expect(next.body.state).toBe('apply')
    expect(next.body.library.scenes.map((row: { id: string }) => row.id)).toEqual([
      'script',
      'later-app'
    ])
    expect(io.current).toEqual(edited)
  })
  it('requires every conflict choice and does not mutate invalid choices or cancelled preview', async () => {
    const io = fixture(),
      server = io.create(),
      token = await connect(server)
    io.setCurrent(material('same'))
    const script = material('same')
    script.scenes[0].prompt = 'remote'
    const proposal = (await propose(token, script)).proposal!
    expect(proposal.conflicts).toHaveLength(1)
    expect((await call('approve', { id: proposal.id, choices: {} }, token)).status).toBe(409)
    expect(
      (await call('approve', { id: proposal.id, choices: { unknown: 'app' } }, token)).status
    ).toBe(400)
    expect(io.apply).not.toHaveBeenCalled()
    expect((await call('cancel', { id: proposal.id }, token)).body.state).toBe('idle')
    expect((await call('approve', { id: proposal.id, choices: {} }, token)).status).toBe(409)
  })
  it('app request waits for fresh poll and automatic applies only after baseline established', async () => {
    const io = fixture(),
      server = io.create(),
      token = await connect(server)
    await server.request()
    const initial = await call('exchange', { library: empty(), automatic: true }, token)
    expect(initial.body.state).toBe('preview')
    const id = initial.body.proposal.id
    const apply = await call('approve', { id, choices: {} }, token)
    expect(io.apply).not.toHaveBeenCalled() // equal libraries need only establish baseline
    await call('ack', { id, library: apply.body.library }, token)
    const automatic = await call(
      'exchange',
      { library: material('remote'), automatic: true },
      token
    )
    expect(automatic.body.state).toBe('apply')
    expect(io.apply).toHaveBeenCalledTimes(1)
  })
})
