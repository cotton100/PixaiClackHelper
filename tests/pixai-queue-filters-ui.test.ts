// @vitest-environment happy-dom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ExecutionQueue } from '../src/renderer/src/pixai/execution'
import { createPixaiStore, emptyWorkspace } from '../src/renderer/src/pixai/store'
import { buildPayload, type ExecutionJob } from '../src/shared/pixai/execution'
import { pixaiLibrary } from './fixtures/pixai-workspace'
let root: Root, container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function setup(renamedMaterials = false) {
  let saved = JSON.stringify({ ...emptyWorkspace(), library: pixaiLibrary() })
  const write = vi.fn(async (value: string) => {
    saved = value
  })
  const store = createPixaiStore({ read: async () => saved, write })
  await store.getState().hydrate()
  await store.getState().reserve(
    {
      id: 'plan',
      name: 'batch',
      rows: [
        { kind: 'character', id: 'c1' },
        { kind: 'character', id: 'c2' }
      ],
      columns: ['sc1', 'sc2'],
      count: 1,
      exceptions: {},
      order: 'byRow'
    },
    true
  )
  const jobs = store.getState().workspace.jobs
  if (renamedMaterials)
    for (const [index, job] of jobs.entries()) {
      const suffix = index % 2 ? '변경 후' : '변경 전'
      job.request = {
        ...job.request,
        composition: {
          ...job.request.composition,
          character: { ...job.request.composition.character, name: `캐릭터 ${suffix}` },
          preset: { ...job.request.composition.preset, name: `프리셋 ${suffix}` }
        }
      }
    }
  jobs[0].registeredAt = 1
  jobs[2].registeredAt = 1
  const records: ExecutionJob[] = jobs.slice(0, 3).map((job, index) => ({
    id: job.request.id,
    title: job.request.title,
    payload: buildPayload(job, 42),
    state: index === 2 ? 'waiting' : 'done',
    outputDir: '/synthetic',
    files: [],
    error: '',
    updatedAt: Date.now(),
    registeredAt: job.registeredAt
  }))
  const status = { running: false, stopping: false, error: '', jobs: records }
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'pixai:status' || channel === 'pixai:remove' || channel === 'pixai:start')
      return structuredClone(status)
    throw new Error('Unexpected IPC ' + channel)
  })
  vi.stubGlobal('nais', { invoke })
  write.mockClear()
  await act(async () => root.render(h(ExecutionQueue, { store })))
  return { store, invoke, write, jobs, status }
}
async function select(label: string, value: string): Promise<void> {
  await act(async () => {
    const input = container.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!
    input.value = value
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
async function click(name: string): Promise<void> {
  const button = [...container.querySelectorAll('button')].find(
    (v) => v.textContent?.trim() === name
  )!
  expect(button, name).toBeTruthy()
  await act(async () => button.click())
}
it('filters without saving, clears selections, and explains that start still uses all waiting jobs', async () => {
  const f = await setup()
  expect(container.querySelectorAll('.px-queue-item')).toHaveLength(3)
  await act(async () => container.querySelector<HTMLInputElement>('.px-queue-item input')!.click())
  await select('대기열 캐릭터', 'id:c2')
  expect(container.querySelectorAll('.px-queue-item')).toHaveLength(2)
  expect(container.querySelectorAll('.px-queue-item input:checked')).toHaveLength(0)
  await select('대기열 씬', 'id:sc2')
  expect(container.querySelectorAll('.px-queue-item')).toHaveLength(1)
  expect(f.write).not.toHaveBeenCalled()
  expect(f.invoke.mock.calls.every((call) => call[0] === 'pixai:status')).toBe(true)
  await click('시작·저장 재개')
  expect(container.querySelector('.px-confirm')?.textContent).toContain('전체 대기 작업')
  expect(container.querySelector('.px-confirm')?.textContent).toContain('새 생성 1작업')
})
it('clears only visible completed jobs while preserving hidden old completions and unfinished jobs', async () => {
  const f = await setup()
  await click('완료 목록 비우기')
  expect(container.querySelector('.px-confirm')?.textContent).toContain('1개')
  await click('목록 삭제 확인')
  expect(f.invoke).toHaveBeenCalledWith('pixai:remove', { ids: [f.jobs[1].request.id] })
  expect(f.store.getState().workspace.jobs.map((v) => v.request.id)).toEqual([
    f.jobs[0].request.id,
    f.jobs[2].request.id,
    f.jobs[3].request.id
  ])
})
it('invalidates deletion confirmation when polling changes an old pending job into a hidden completed job', async () => {
  vi.useFakeTimers()
  const f = await setup()
  await act(async () => {
    await f.store.getState().commit((current) => ({
      ...current,
      jobs: current.jobs.map((job, index) => (index === 3 ? { ...job, registeredAt: 1 } : job))
    }))
  })
  const last = container.querySelectorAll<HTMLInputElement>('.px-queue-item input')[2]
  await act(async () => last.click())
  await click('선택 삭제')
  expect(container.querySelector('.px-confirm')?.textContent).toContain('1개')
  f.status.jobs.push({
    ...f.status.jobs[0],
    id: f.jobs[3].request.id,
    registeredAt: 1,
    state: 'done'
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000)
  })
  expect(container.querySelector('.px-confirm')?.textContent).toContain('표시 목록이 바뀌었습니다')
  expect(
    [...container.querySelectorAll('button')].some(
      (button) => button.textContent === '목록 삭제 확인'
    )
  ).toBe(false)
  expect(f.invoke.mock.calls.some((call) => call[0] === 'pixai:remove')).toBe(false)
})
it('uses the same material name in the selected option and collapsed summary across renamed snapshots', async () => {
  const f = await setup(true)
  await select('대기열 캐릭터', 'id:c1')
  await select('대기열 프리셋', `id:${f.jobs[0].request.composition.preset.id}`)
  const panel = container.querySelector<HTMLDetailsElement>('.px-queue-filter-panel')!
  await act(async () => {
    panel.open = false
    panel.dispatchEvent(new Event('toggle'))
  })
  expect(panel.open).toBe(false)
  const summary = panel.querySelector('summary')!
  for (const label of ['캐릭터', '프리셋']) {
    const input = panel.querySelector<HTMLSelectElement>(`[aria-label="대기열 ${label}"]`)!
    const selectedName = input.options[input.selectedIndex].textContent!
    expect(selectedName).toContain('변경 후')
    expect(summary.textContent).toContain(`${label} ${selectedName}`)
    expect(summary.textContent).not.toContain(`${label} 변경 전`)
  }
  expect(f.write).not.toHaveBeenCalled()
})
it('keeps date, active conditions and visible counts in the collapsed filter accessible name', async () => {
  await setup()
  await select('대기열 캐릭터', 'id:c2')
  await select('대기열 씬', 'id:sc2')
  const panel = container.querySelector<HTMLDetailsElement>('.px-queue-filter-panel')!
  await act(async () => {
    panel.open = false
    panel.dispatchEvent(new Event('toggle'))
  })
  expect(panel.open).toBe(false)
  const summaryName = panel.querySelector('summary')!.getAttribute('aria-label')!
  expect(summaryName).toContain('최근 7일')
  for (const label of ['캐릭터', '씬']) {
    const input = panel.querySelector<HTMLSelectElement>(`[aria-label="대기열 ${label}"]`)!
    expect(summaryName).toContain(`${label} ${input.options[input.selectedIndex].textContent}`)
  }
  expect(summaryName).toMatch(/표시\s*1/)
  expect(summaryName).toMatch(/전체\s*4/)
})
it('starts hidden pending jobs only after cost consent and sends the frozen requests despite library edits', async () => {
  const f = await setup()
  const frozen = structuredClone(f.store.getState().workspace.jobs)
  await act(async () => {
    await f.store.getState().commit((current) => ({
      ...current,
      library: {
        ...current.library,
        common: { prompt: 'new common', negativePrompt: 'new negative' },
        characters: current.library.characters.map((character) => ({
          ...character,
          prompt: 'new character'
        })),
        scenes: current.library.scenes.map((chunk) => ({ ...chunk, prompt: 'new chunk' }))
      }
    }))
  })
  await select('대기열 캐릭터', 'id:c1')
  expect(container.querySelectorAll('.px-queue-item')).toHaveLength(1)
  expect(container.querySelector('.px-queue-item')?.textContent).toContain('저장 완료')
  await click('시작·저장 재개')
  const confirmation = container.querySelector('.px-confirm')!
  expect(confirmation.textContent).toContain('새 생성 1작업')
  const run = [...confirmation.querySelectorAll('button')].find(
    (button) => button.textContent === '확인한 작업 실행'
  )!
  expect(run.disabled).toBe(true)
  expect(f.invoke.mock.calls.some((call) => call[0] === 'pixai:start')).toBe(false)
  const consent = [...confirmation.querySelectorAll('label')]
    .find((label) => label.textContent?.includes('API 비용이 발생하며'))!
    .querySelector('input')!
  await act(async () => consent.click())
  await click('확인한 작업 실행')
  expect(f.invoke).toHaveBeenCalledWith('pixai:start', {
    jobs: frozen,
    expectedWorkspaceRevision: '',
    costsAccepted: true,
    relocatePending: false
  })
  expect(f.invoke.mock.calls.filter((call) => call[0] === 'pixai:start')).toHaveLength(1)
  expect(f.store.getState().workspace.jobs).toEqual(frozen)
})
it('blocks a pending deletion when polling shows that the still-visible job was submitted', async () => {
  vi.useFakeTimers()
  const f = await setup()
  await select('대기열 캐릭터', 'id:c2')
  await select('대기열 씬', 'id:sc2')
  expect(container.querySelectorAll('.px-queue-item')).toHaveLength(1)
  await act(async () => container.querySelector<HTMLInputElement>('.px-queue-item input')!.click())
  await click('선택 삭제')
  expect(container.querySelector('.px-confirm')?.textContent).toContain('1개')
  f.status.jobs.push({
    ...f.status.jobs[0],
    id: f.jobs[3].request.id,
    state: 'waiting'
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000)
  })
  expect(container.querySelectorAll('.px-queue-item')).toHaveLength(1)
  expect(container.querySelector('.px-confirm')?.textContent).toContain(
    '제출된 미완료 작업은 지울 수 없습니다.'
  )
  expect(
    [...container.querySelectorAll('button')].some(
      (button) => button.textContent === '목록 삭제 확인'
    )
  ).toBe(false)
  expect(f.invoke.mock.calls.some((call) => call[0] === 'pixai:remove')).toBe(false)
  expect(f.write).not.toHaveBeenCalled()
})
