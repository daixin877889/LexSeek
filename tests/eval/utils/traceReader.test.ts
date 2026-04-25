/**
 * Eval traceReader 单元测试。
 *
 * 真实数据源：LangGraph PostgresSaver 把 messages 序列化后存到
 * `langgraph.checkpoint_blobs` 表（channel='messages', type='json', blob 为
 * UTF-8 编码的 LangChain serialized messages 数组）。每条 AIMessage 的
 * tool_calls 在 `kwargs.tool_calls` 数组里：`{ name, args, id, type }`。
 *
 * 同一 thread 会有多个 version（递增），messages 是累积的，取最大 version 即为
 * 最终消息列表。本测试在 ls_eval 库自建 langgraph.checkpoint_blobs 表后写入
 * fixture blob，验证：
 *   1. thread 存在 → 解析出全部 tool_calls
 *   2. thread 不存在 → 返回空数组
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { getToolCallsFromThread } from './traceReader'

const TEST_THREAD = `eval-trace-${Date.now()}`

const FIXTURE_MESSAGES = [
  {
    lc: 1,
    type: 'constructor',
    id: ['langchain_core', 'messages', 'HumanMessage'],
    kwargs: { content: '帮我查一下抖音账号合作合同的法条', additional_kwargs: {}, response_metadata: {} },
  },
  {
    lc: 1,
    type: 'constructor',
    id: ['langchain_core', 'messages', 'AIMessageChunk'],
    kwargs: {
      content: '',
      additional_kwargs: {},
      response_metadata: {},
      tool_calls: [
        { name: 'search_case_memory', args: { query: 'foo' }, id: 't1', type: 'tool_call' },
        { name: 'search_case_materials', args: { query: 'bar' }, id: 't2', type: 'tool_call' },
      ],
    },
  },
  {
    lc: 1,
    type: 'constructor',
    id: ['langchain_core', 'messages', 'ToolMessage'],
    kwargs: { content: '{"hits":[]}', tool_call_id: 't1' },
  },
]

describe('getToolCallsFromThread', () => {
  beforeAll(async () => {
    // 在 ls_eval 库手动创建 langgraph schema + checkpoint_blobs 表（PostgresSaver
    // 在生产由 setup() 创建；ls_eval 不跑生产 saver，只为单测手工建结构）。
    await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS langgraph`)
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS langgraph.checkpoint_blobs (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        channel TEXT NOT NULL,
        version TEXT NOT NULL,
        type TEXT NOT NULL,
        blob BYTEA,
        PRIMARY KEY (thread_id, checkpoint_ns, channel, version)
      )
    `)
    await prisma.$executeRawUnsafe(
      `DELETE FROM langgraph.checkpoint_blobs WHERE thread_id = $1`,
      TEST_THREAD,
    )
    const blob = Buffer.from(JSON.stringify(FIXTURE_MESSAGES), 'utf8')
    await prisma.$executeRawUnsafe(
      `INSERT INTO langgraph.checkpoint_blobs (thread_id, checkpoint_ns, channel, version, type, blob)
       VALUES ($1, '', 'messages', '2', 'json', $2)`,
      TEST_THREAD,
      blob,
    )
  })

  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      `DELETE FROM langgraph.checkpoint_blobs WHERE thread_id = $1`,
      TEST_THREAD,
    )
    await prisma.$disconnect()
  })

  it('返回 thread 内所有 tool_calls 的 name 列表', async () => {
    const calls = await getToolCallsFromThread(TEST_THREAD)
    const names = calls.map(c => c.name).sort()
    expect(names).toEqual(['search_case_materials', 'search_case_memory'])
    const memCall = calls.find(c => c.name === 'search_case_memory')
    expect(memCall?.args).toEqual({ query: 'foo' })
    expect(memCall?.id).toBe('t1')
  })

  it('thread 不存在时返回空数组', async () => {
    const calls = await getToolCallsFromThread('non-existent-thread-xyz')
    expect(calls).toEqual([])
  })
})
