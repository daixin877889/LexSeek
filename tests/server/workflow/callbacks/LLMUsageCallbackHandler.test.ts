import { describe, it, expect } from 'vitest'
import { AIMessage } from '@langchain/core/messages'
import { LLMUsageCallbackHandler } from '~~/server/services/workflow/callbacks/LLMUsageCallbackHandler'

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
})
