/**
 * consumeAgentStream 取消路径测试
 *
 * 回归：被取消 / 超时的 Agent 运行会在 Langfuse 留下「无名」trace。
 * 根因——消费侧中断后只 `reader.releaseLock()` 不 `reader.cancel()`，
 * 取消信号没透传到上游 LangGraph 流，图层级运行收不到结束回调，
 * Langfuse 根 span 永不结束、永不上报，只剩无根的孤儿子观测。
 *
 * 用例 1、3 的 mock 流会无限产出，靠测试内 abort / 抛错收口；
 * 显式 5s 超时兜底，防 consumeAgentStream 退出逻辑回归时卡死 CI。
 */

import { describe, it, expect } from 'vitest'
import './test-setup'
import { consumeAgentStream } from '../../../server/services/agent/agentWorker'

const encoder = new TextEncoder()

describe('consumeAgentStream 取消路径', () => {
  it('中断时调用上游流的 cancel()（取消透传），而非仅释放 reader', async () => {
    const abort = new AbortController()
    let cancelCalled = false
    let cancelReason: unknown

    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(encoder.encode('event: messages\ndata: {"k":1}\n\n'))
      },
      cancel(reason) {
        cancelCalled = true
        cancelReason = reason
      },
    })

    let received = 0
    await consumeAgentStream(stream, abort.signal, async () => {
      received++
      if (received === 2) abort.abort(new Error('Run cancelled'))
    })

    expect(cancelCalled).toBe(true)
    expect((cancelReason as Error)?.message).toBe('Run cancelled')
  }, 5000)

  it('正常读完：投递全部事件、返回最后一个 values 数据，且不取消上游', async () => {
    const abort = new AbortController()
    const chunks = [
      'event: messages\ndata: {"t":"a"}\n\n',
      'event: values\ndata: {"v":1}\n\n',
      'event: values\ndata: {"v":2}\n\n',
    ]
    let i = 0
    let cancelCalled = false

    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]))
        else controller.close()
      },
      cancel() {
        cancelCalled = true
      },
    })

    const events: string[] = []
    const result = await consumeAgentStream(stream, abort.signal, async (event) => {
      events.push(event)
    })

    expect(events).toEqual(['messages', 'values', 'values'])
    expect(result.lastValuesData).toEqual({ v: 2 })
    expect(cancelCalled).toBe(false)
  })

  it('onEvent 投递抛错时也取消上游流（错误路径不遗弃流）', async () => {
    const abort = new AbortController()
    let cancelCalled = false

    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(encoder.encode('event: messages\ndata: {"k":1}\n\n'))
      },
      cancel() {
        cancelCalled = true
      },
    })

    await expect(
      consumeAgentStream(stream, abort.signal, async () => {
        throw new Error('publish failed')
      }),
    ).rejects.toThrow('publish failed')

    expect(cancelCalled).toBe(true)
  }, 5000)
})
