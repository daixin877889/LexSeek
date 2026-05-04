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
    nonInterceptedMethod: vi.fn().mockReturnValue('raw'),
  } as unknown as BaseChatModel & Record<string, ReturnType<typeof vi.fn>>
}

describe('wrapWithLangfuse', () => {
  afterEach(() => {
    _resetLangfuseClientCache()
  })

  it('invoke 注入完整 RunnableConfig（runName / tags 顶层 / camelCase metadata）', async () => {
    const model = createFakeModel()
    const wrapped = wrapWithLangfuse(model)

    await withLangfuseContext(
      {
        requestId: 'req-1',
        userId: 42,
        sessionId: 'sess-1',
        runId: 'run-1',
        caseId: 100,
        vertical: 'case-analysis',
      },
      async () => wrapped.invoke('hello'),
    )

    expect(model.invoke).toHaveBeenCalledTimes(1)
    const [input, config] = model.invoke.mock.calls[0]!
    expect(input).toBe('hello')
    expect(config.runName).toBe('case-analysis')
    expect(config.tags).toContain('case-analysis')
    expect(config.metadata.langfuseUserId).toBe('42')
    expect(config.metadata.langfuseSessionId).toBe('sess-1')
    expect(config.metadata.requestId).toBe('req-1')
    expect(config.metadata.runId).toBe('run-1')
    expect(config.metadata.caseId).toBe(100)
    expect(config.metadata.scope).toBe('CASE')
    expect(Array.isArray(config.callbacks)).toBe(true)
  })

  it('已存在的 callbacks / tags / metadata 应合并而不是覆盖', async () => {
    const model = createFakeModel()
    const wrapped = wrapWithLangfuse(model)
    const existingCallback = { handleLLMStart: vi.fn() }

    await withLangfuseContext(
      { requestId: 'req-1', vertical: 'contract' },
      async () => wrapped.invoke('hi', {
        tags: ['custom-tag'],
        callbacks: [existingCallback as any],
        metadata: { customField: 'x' },
      }),
    )

    const [, config] = model.invoke.mock.calls[0]!
    expect(config.tags).toContain('custom-tag')
    expect(config.tags).toContain('contract')
    expect(config.callbacks).toContain(existingCallback)
    expect(config.metadata.customField).toBe('x')
    expect(config.metadata.scope).toBe('CONTRACT')
  })

  it('用户传入的 runName 优先于默认 vertical', async () => {
    const model = createFakeModel()
    const wrapped = wrapWithLangfuse(model)

    await withLangfuseContext(
      { requestId: 'req-1', vertical: 'contract' },
      async () => wrapped.invoke('hi', { runName: 'custom-name' }),
    )

    const [, config] = model.invoke.mock.calls[0]!
    expect(config.runName).toBe('custom-name')
  })

  it('无 ALS 上下文时仍能调通（metadata 字段 undefined 即可，不抛异常）', async () => {
    const model = createFakeModel()
    const wrapped = wrapWithLangfuse(model)

    await wrapped.invoke('hi')

    expect(model.invoke).toHaveBeenCalledTimes(1)
    const [, config] = model.invoke.mock.calls[0]!
    expect(config.metadata.langfuseUserId).toBeUndefined()
    expect(config.metadata.langfuseSessionId).toBeUndefined()
  })

  it('stream / batch / streamEvents 同样被拦截', async () => {
    const model = createFakeModel()
    const wrapped = wrapWithLangfuse(model)

    await withLangfuseContext(
      { requestId: 'req-1', vertical: 'document' },
      async () => {
        await wrapped.stream('a')
        await wrapped.batch(['b'])
        ;(wrapped as Record<string, (...args: unknown[]) => Promise<unknown>>)
          .streamEvents!('c')
      },
    )

    for (const fn of [model.stream, model.batch, model.streamEvents]) {
      expect(fn).toHaveBeenCalledTimes(1)
      const [, config] = fn.mock.calls[0]!
      expect(config.runName).toBe('document')
      expect(config.metadata.scope).toBe('DOCUMENT')
    }
  })

  it('未拦截的方法保持原行为', () => {
    const model = createFakeModel()
    const wrapped = wrapWithLangfuse(model) as unknown as { nonInterceptedMethod: () => string }
    expect(wrapped.nonInterceptedMethod()).toBe('raw')
    expect(model.nonInterceptedMethod).toHaveBeenCalledOnce()
  })
})
