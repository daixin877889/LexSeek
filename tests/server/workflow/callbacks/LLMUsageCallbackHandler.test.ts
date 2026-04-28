import { describe, it, expect } from 'vitest'
import { AIMessage } from '@langchain/core/messages'
import {
    LLMUsageCallbackHandler,
    extractCacheHitTokens,
    extractPromptTokens,
    type RawLLMUsage,
} from '~~/server/services/workflow/callbacks/LLMUsageCallbackHandler'

describe('LLMUsageCallbackHandler', () => {
  it('从 response_metadata.usage 读 DeepSeek 原始 cache 字段', async () => {
    const handler = new LLMUsageCallbackHandler({ tag: 'test', isWarmup: false })
    const fakeOutput = {
      generations: [[{
        message: new AIMessage({
          content: 'hi',
          response_metadata: {
            usage: {
              prompt_tokens: 1000,
              prompt_cache_hit_tokens: 600,
              prompt_cache_miss_tokens: 400,
              completion_tokens: 50,
            },
          },
        }),
      }]],
    }
    await handler.handleLLMEnd(fakeOutput as any, 'run-1')
    const records = handler.getRecords()
    expect(records).toHaveLength(1)
    expect(records[0].usage.prompt_tokens).toBe(1000)
    expect(records[0].usage.prompt_cache_hit_tokens).toBe(600)
    expect(records[0].isWarmup).toBe(false)
  })

  it('Anthropic 协议字段也能正确读取', async () => {
    const handler = new LLMUsageCallbackHandler({ tag: 'a', isWarmup: false })
    const fakeOutput = {
      generations: [[{
        message: new AIMessage({
          content: 'x',
          response_metadata: {
            usage: {
              input_tokens: 2000,
              output_tokens: 100,
              cache_read_input_tokens: 1500,
              cache_creation_input_tokens: 500,
            },
          },
        }),
      }]],
    }
    await handler.handleLLMEnd(fakeOutput as any, 'run-2')
    const r = handler.getRecords()[0]
    expect(r.usage.cache_read_input_tokens).toBe(1500)
  })

  it('isWarmup 标记会原样保留以便聚合时过滤', async () => {
    const handler = new LLMUsageCallbackHandler({ tag: 'warm', isWarmup: true })
    await handler.handleLLMEnd({
      generations: [[{ message: new AIMessage({ content: 'x', response_metadata: { usage: {} } }) }]],
    } as any, 'run-3')
    expect(handler.getRecords()[0].isWarmup).toBe(true)
  })

  it('记 latency（startTime → endTime）', async () => {
    const handler = new LLMUsageCallbackHandler({ tag: 't', isWarmup: false })
    const runId = 'run-4'
    await handler.handleLLMStart({} as any, ['hi'], runId)
    await new Promise(r => setTimeout(r, 20))
    await handler.handleLLMEnd({
      generations: [[{ message: new AIMessage({ content: 'x', response_metadata: { usage: {} } }) }]],
    } as any, runId)
    expect(handler.getRecords()[0].latencyMs).toBeGreaterThanOrEqual(20)
  })

  it('未先 handleLLMStart 直接 handleLLMEnd 时 latencyMs 兜底为 ~0', async () => {
    const handler = new LLMUsageCallbackHandler({ tag: 't', isWarmup: false })
    await handler.handleLLMEnd({
      generations: [[{ message: new AIMessage({ content: 'x', response_metadata: { usage: {} } }) }]],
    } as any, 'run-skip-start')
    const r = handler.getRecords()[0]
    expect(r.latencyMs).toBeGreaterThanOrEqual(0)
    expect(r.latencyMs).toBeLessThan(50)
  })

  it('reset() 清空 records 与 startTimes', async () => {
    const handler = new LLMUsageCallbackHandler({ tag: 'a', isWarmup: false })
    await handler.handleLLMStart({} as any, ['hi'], 'r1')
    await handler.handleLLMEnd({
      generations: [[{ message: new AIMessage({ content: 'x', response_metadata: { usage: {} } }) }]],
    } as any, 'r1')
    expect(handler.getRecords()).toHaveLength(1)
    handler.reset()
    expect(handler.getRecords()).toHaveLength(0)
  })

  it('setWarmup() 切换标记后续记录使用新值', async () => {
    const handler = new LLMUsageCallbackHandler({ tag: 't', isWarmup: true })
    await handler.handleLLMEnd({
      generations: [[{ message: new AIMessage({ content: 'x', response_metadata: { usage: {} } }) }]],
    } as any, 'r1')
    expect(handler.getRecords()[0].isWarmup).toBe(true)

    handler.setWarmup(false)
    await handler.handleLLMEnd({
      generations: [[{ message: new AIMessage({ content: 'x', response_metadata: { usage: {} } }) }]],
    } as any, 'r2')
    expect(handler.getRecords()[1].isWarmup).toBe(false)
  })

  it('output 为空 / generations 缺失时 usage 取空对象不抛错', async () => {
    const handler = new LLMUsageCallbackHandler({ tag: 't', isWarmup: false })
    await handler.handleLLMEnd({} as any, 'r1')
    await handler.handleLLMEnd({ generations: [] } as any, 'r2')
    await handler.handleLLMEnd({ generations: [[]] } as any, 'r3')
    expect(handler.getRecords()).toHaveLength(3)
    for (const r of handler.getRecords()) {
      expect(r.usage).toBeDefined()
    }
  })

  it('DeepSeek 走 Anthropic 协议时缺 input_tokens，从 usage_metadata 兜底', async () => {
    const handler = new LLMUsageCallbackHandler({ tag: 't', isWarmup: false })
    const fakeOutput = {
      generations: [[{
        message: {
          response_metadata: {
            usage: { output_tokens: 100 }, // 缺 input_tokens / prompt_tokens
          },
          usage_metadata: {
            input_tokens: 1500,
            output_tokens: 100,
            input_token_details: { cache_read: 800 },
          },
        },
      }]],
    }
    await handler.handleLLMEnd(fakeOutput as any, 'r-fallback')
    const r = handler.getRecords()[0]
    expect(r.usage.input_tokens).toBe(1500)
    expect(r.usage.prompt_tokens).toBe(1500)
    expect(r.usage.cache_read_input_tokens).toBe(800)
  })
})

describe('extractPromptTokens 多协议兜底', () => {
  it('优先取 prompt_tokens（DeepSeek）', () => {
    const usage: RawLLMUsage = { prompt_tokens: 1000, input_tokens: 999 }
    expect(extractPromptTokens(usage)).toBe(1000)
  })

  it('回退到 input_tokens（Anthropic）', () => {
    expect(extractPromptTokens({ input_tokens: 500 })).toBe(500)
  })

  it('两者都缺时兜底为 0', () => {
    expect(extractPromptTokens({})).toBe(0)
  })
})

describe('extractCacheHitTokens 多协议兜底', () => {
  it('DeepSeek prompt_cache_hit_tokens 最高优先', () => {
    const usage: RawLLMUsage = {
      prompt_cache_hit_tokens: 600,
      cache_read_input_tokens: 500,
      prompt_tokens_details: { cached_tokens: 400 },
    }
    expect(extractCacheHitTokens(usage)).toBe(600)
  })

  it('回退到 Anthropic cache_read_input_tokens', () => {
    expect(extractCacheHitTokens({
      cache_read_input_tokens: 500,
      prompt_tokens_details: { cached_tokens: 400 },
    })).toBe(500)
  })

  it('回退到 OpenAI prompt_tokens_details.cached_tokens', () => {
    expect(extractCacheHitTokens({
      prompt_tokens_details: { cached_tokens: 400 },
    })).toBe(400)
  })

  it('全部缺失时返回 0', () => {
    expect(extractCacheHitTokens({})).toBe(0)
  })
})
