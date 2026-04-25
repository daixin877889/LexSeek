import { describe, it, expect } from 'vitest'
import { consumeAgentSseStream } from './sseConsumer'

function streamFromString(s: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(s))
      controller.close()
    },
  })
}

describe('consumeAgentSseStream', () => {
  it('解析 named events 提取最终 AI message', async () => {
    const sse = [
      'event: messages',
      'data: {"role":"assistant","content":"hello"}',
      '',
      'event: values',
      'data: {"messages":[{"role":"user","content":"hi"},{"role":"assistant","content":"final answer 内容"}]}',
      '',
      'event: custom',
      'data: {"threadId":"thread-abc","status":"ok"}',
      '',
    ].join('\n')

    const result = await consumeAgentSseStream(streamFromString(sse))
    expect(result.finalAnswer).toBe('final answer 内容')
    expect(result.threadId).toBe('thread-abc')
  })

  it('多个 values event 取最后一个的最后 AI message', async () => {
    const sse = [
      'event: values',
      'data: {"messages":[{"role":"assistant","content":"中间答案"}]}',
      '',
      'event: values',
      'data: {"messages":[{"role":"user","content":"q"},{"role":"assistant","content":"最终答案"}]}',
      '',
    ].join('\n')
    const result = await consumeAgentSseStream(streamFromString(sse))
    expect(result.finalAnswer).toBe('最终答案')
  })

  it('空流返回空字符串', async () => {
    const result = await consumeAgentSseStream(streamFromString(''))
    expect(result.finalAnswer).toBe('')
    expect(result.threadId).toBe('')
  })
})
