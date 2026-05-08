/**
 * Langfuse 业务接入集成测试
 *
 * 覆盖 PR 2 接入路径：业务入口 withLangfuseContext → chatModelFactory wrapWithLangfuse → invoke 时 ALS 同步注入 RunnableConfig。
 *
 * 不真启 NodeSDK / 不真上送 Langfuse；用 fake chat model 捕获 invoke 收到的 config 做断言。
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { _resetLangfuseClientCache } from '~~/server/lib/langfuse/client'
import { withLangfuseContext } from '~~/server/lib/langfuse/context'
import { wrapWithLangfuse } from '~~/server/lib/langfuse/modelProxy'

function createFakeModel() {
  return {
    invoke: vi.fn().mockResolvedValue({ content: 'ok' }),
    stream: vi.fn().mockResolvedValue([] as unknown[]),
    batch: vi.fn().mockResolvedValue([{ content: 'ok' }]),
    streamEvents: vi.fn().mockResolvedValue([] as unknown[]),
  } as unknown as BaseChatModel & Record<string, ReturnType<typeof vi.fn>>
}

describe('Langfuse 业务接入集成', () => {
  afterEach(() => {
    _resetLangfuseClientCache()
  })

  it('案件初分链路：withLangfuseContext({caseId, vertical:init-analysis}) → invoke 收到完整 metadata', async () => {
    const model = createFakeModel()
    const wrapped = wrapWithLangfuse(model)

    await withLangfuseContext(
      {
        runId: 'run-init-1',
        sessionId: 'sess-init-1',
        threadId: 'sess-init-1',
        userId: 100,
        caseId: 999,
        vertical: 'init-analysis',
      },
      async () => {
        await wrapped.invoke('analyze case')
      },
    )

    expect(model.invoke).toHaveBeenCalledTimes(1)
    const [input, config] = model.invoke.mock.calls[0]!
    expect(input).toBe('analyze case')
    expect(config.runName).toBe('init-analysis')
    expect(config.tags).toContain('init-analysis')
    expect(config.metadata.caseId).toBe(999)
    expect(config.metadata.fallbackUserId).toBe('100')
    expect(config.metadata.fallbackSessionId).toBe('sess-init-1')
    expect(config.metadata.runId).toBe('run-init-1')
    expect(config.metadata.businessScope).toBe('CASE')
  })

  it('嵌套 vertical：runtime 顶层 case-main → 子 agent invoke-node-json 覆盖（merge 语义）', async () => {
    const model = createFakeModel()
    const wrapped = wrapWithLangfuse(model)

    // 模拟：runtime.runDomainAgent 顶层包 vertical='case-main' + 完整 ctx
    await withLangfuseContext(
      {
        runId: 'run-2',
        sessionId: 'sess-2',
        userId: 7,
        caseId: 42,
        vertical: 'case-main',
      },
      async () => {
        // 模拟：invokeNodeJson tool 入口包 vertical='invoke-node-json'
        await withLangfuseContext({ vertical: 'invoke-node-json' }, async () => {
          await wrapped.invoke('json extract')
        })
      },
    )

    const [, config] = model.invoke.mock.calls[0]!
    // 内层 vertical 覆盖外层
    expect(config.metadata.businessScope).toBe('TOOL')
    expect(config.runName).toBe('invoke-node-json')
    // 外层业务字段保留
    expect(config.metadata.runId).toBe('run-2')
    expect(config.metadata.caseId).toBe(42)
    expect(config.metadata.fallbackUserId).toBe('7')
  })

  it('合同审查链路：handler 包 reviewId/caseId → 内层 model.invoke 拿到 reviewId metadata', async () => {
    const model = createFakeModel()
    const wrapped = wrapWithLangfuse(model)

    await withLangfuseContext(
      {
        userId: 88,
        caseId: 1234,
        reviewId: 'review-XYZ',
        vertical: 'contract',
      },
      async () => {
        await wrapped.invoke('check contract')
      },
    )

    const [, config] = model.invoke.mock.calls[0]!
    expect(config.metadata.reviewId).toBe('review-XYZ')
    expect(config.metadata.caseId).toBe(1234)
    expect(config.metadata.businessScope).toBe('CONTRACT')
    expect(config.tags).toContain('contract')
  })

  it('worker 重建 ALS：从 run/session 数据起根 → invoke 含 runId', async () => {
    const model = createFakeModel()
    const wrapped = wrapWithLangfuse(model)

    // 模拟 agentWorker.executeRun 入口（非 HTTP 上下文，自己重建 ALS）
    const fakeRun = {
      id: 'worker-run-1',
      sessionId: 'sess-worker-1',
      userId: 200,
      caseId: 555,
    }

    await withLangfuseContext(
      {
        runId: fakeRun.id,
        sessionId: fakeRun.sessionId,
        threadId: fakeRun.sessionId,
        userId: fakeRun.userId,
        caseId: fakeRun.caseId,
      },
      async () => {
        // 模拟下游 runDomainAgent 又包了 vertical
        await withLangfuseContext({ vertical: 'case-main' }, async () => {
          await wrapped.invoke('worker job')
        })
      },
    )

    const [, config] = model.invoke.mock.calls[0]!
    expect(config.metadata.runId).toBe('worker-run-1')
    expect(config.metadata.fallbackSessionId).toBe('sess-worker-1')
    expect(config.metadata.caseId).toBe(555)
    expect(config.runName).toBe('case-main')
  })

  it('素材摘要链路：vertical=material-summary + materialId 透传', async () => {
    const model = createFakeModel()
    const wrapped = wrapWithLangfuse(model)

    await withLangfuseContext(
      {
        userId: 11,
        materialId: 'mat-77',
        vertical: 'material-summary',
      },
      async () => {
        await wrapped.invoke('summarize')
      },
    )

    const [, config] = model.invoke.mock.calls[0]!
    expect(config.metadata.materialId).toBe('mat-77')
    expect(config.metadata.businessScope).toBe('MATERIAL')
    expect(config.tags).toContain('material-summary')
  })
})
