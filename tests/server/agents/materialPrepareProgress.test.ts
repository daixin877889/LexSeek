/**
 * createMaterialPrepareEmitter 单元测试
 *
 * **Feature: assistant-file-reading**
 */
import { describe, it, expect, vi } from 'vitest'

;(globalThis as any).logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }

import { createMaterialPrepareEmitter } from '~~/server/agents/_shared/material-prepare/materialPrepareProgress'

const snap = (status: string) => [{ materialId: 1, name: 'a', status } as any]

describe('createMaterialPrepareEmitter', () => {
  it('runId 为 null 时 onProgress / finalize 均为安全空操作', async () => {
    const e = createMaterialPrepareEmitter(null, '')
    await e.onProgress(snap('recognizing'))
    await e.finalize()
    expect(e).toBeTruthy()
  })

  it('首次快照即全 ready 时整轮抑制，不 emit', async () => {
    const emit = vi.fn(async () => {})
    const e = createMaterialPrepareEmitter('run-1', 'sess-1', emit)
    await e.onProgress(snap('ready'))
    await e.finalize()
    expect(emit).not.toHaveBeenCalled()
  })

  it('有进行中材料时 emit start，再 finalize emit end', async () => {
    const emit = vi.fn(async () => {})
    const e = createMaterialPrepareEmitter('run-2', 'sess-2', emit)
    await e.onProgress(snap('recognizing'))
    await e.finalize()
    const phases = emit.mock.calls.map(c => (c[0] as any).data.phase)
    expect(phases).toContain('start')
    expect(phases).toContain('end')
  })
})
