/**
 * assistantProcessMaterialMiddleware 单元测试
 *
 * **Feature: assistant-file-reading**
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

;(globalThis as any).logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }

const ensureBySession = vi.hoisted(() => vi.fn())
vi.mock('~~/server/services/material/materialPipeline.service', () => ({
  ensureMaterialsReadyBySessionService: ensureBySession,
}))
vi.mock('~~/server/agents/_shared/material-prepare/materialPrepareProgress', () => ({
  createMaterialPrepareEmitter: () => ({ onProgress: vi.fn(), finalize: vi.fn() }),
}))

import { ATTACH_SENTINEL } from '#shared/utils/attachmentSentinel'
import { assistantProcessMaterialMiddleware } from '~~/server/agents/legal-assistant/assistantProcessMaterial.middleware'

/** 取中间件的 beforeAgent hook（兼容 createMiddleware 的 { hook } 形态） */
function getBeforeAgentHook(mw: any) {
  const ba = mw.beforeAgent
  return typeof ba === 'function' ? ba : ba.hook
}

const humanMsg = (content: string) => ({ getType: () => 'human', content })

describe('assistantProcessMaterialMiddleware', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('最新消息含附件 sentinel 时调用 ensureMaterialsReadyBySessionService', async () => {
    ensureBySession.mockResolvedValue({
      materials: [], totalMaterials: 0, alreadyEmbedded: 0, newlyProcessed: 0, embeddedMap: new Map(), failed: [],
    })
    const mw = assistantProcessMaterialMiddleware(1, 'sess-1', 'run-1')
    const content = `${ATTACH_SENTINEL}${JSON.stringify([{ id: 7 }, { id: 8 }])}\n\n看图`
    await getBeforeAgentHook(mw)({ messages: [humanMsg(content)] })
    expect(ensureBySession).toHaveBeenCalledWith('sess-1', 1, { fileIds: [7, 8] }, expect.any(Function))
  })

  it('无附件时不调用任何处理', async () => {
    const mw = assistantProcessMaterialMiddleware(1, 'sess-2', 'run-2')
    await getBeforeAgentHook(mw)({ messages: [humanMsg('纯文本提问')] })
    expect(ensureBySession).not.toHaveBeenCalled()
  })

  it('ensure 抛错时吞掉异常不阻断 Agent', async () => {
    ensureBySession.mockRejectedValue(new Error('boom'))
    const mw = assistantProcessMaterialMiddleware(1, 'sess-3', 'run-3')
    const content = `${ATTACH_SENTINEL}${JSON.stringify([{ id: 1 }])}`
    await expect(getBeforeAgentHook(mw)({ messages: [humanMsg(content)] })).resolves.not.toThrow()
  })
})
