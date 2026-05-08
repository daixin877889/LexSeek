/**
 * 回归测试：modelProxy 不得破坏 LangGraph streamMode='messages' 的 token 流。
 *
 * 历史 bug：modelProxy 曾在 mergedConfig 里主动写 callbacks: [...existing, langfuseHandler]，
 * LangChain 把显式 callbacks 视为覆盖 ALS 中的 callbacks，导致 LangGraph 通过 ALS 注入
 * 的 StreamMessagesHandler 被挤掉，model 流式 token 无法被 messages 流捕获，前端表现为
 * "每个分析模块结束才一次性渲染"。
 *
 * 本测试用 FakeStreamingChatModel + 单节点 StateGraph 跑流式，断言 messages 事件数 > 1
 * （token 级流而非节点级 final 一条）。如果未来有人改回 modelProxy 注入 callbacks，本
 * 测试会立刻退化到 messages 事件数 = 1，红牌阻止合入。
 */

import { describe, it, expect, afterEach } from 'vitest'
import { AIMessage, HumanMessage } from '@langchain/core/messages'
import { FakeStreamingChatModel } from '@langchain/core/utils/testing'
import { StateGraph, START, END, MessagesAnnotation } from '@langchain/langgraph'
import { _resetLangfuseClientCache } from '~~/server/lib/langfuse/client'
import { wrapWithLangfuse } from '~~/server/lib/langfuse/modelProxy'
import { buildLangfuseTopLevelConfig } from '~~/server/lib/langfuse'
import { withLangfuseContext } from '~~/server/lib/langfuse/context'

async function countStreamEvents(model: any) {
  const graph = new StateGraph(MessagesAnnotation)
    .addNode('llm', async (state) => ({ messages: [await model.invoke(state.messages)] }))
    .addEdge(START, 'llm')
    .addEdge('llm', END)
    .compile()

  const stream = await graph.stream(
    { messages: [new HumanMessage('hi')] },
    { streamMode: ['values', 'messages'] as any },
  )

  let messageEvents = 0
  let valueEvents = 0
  for await (const chunk of stream) {
    const [mode] = chunk as [string, unknown]
    if (mode === 'messages') messageEvents++
    if (mode === 'values') valueEvents++
  }
  return { messageEvents, valueEvents }
}

describe('wrapWithLangfuse + LangGraph streamMode messages 回归', () => {
  afterEach(() => {
    _resetLangfuseClientCache()
  })

  it('包装后的 model 仍能让 LangGraph messages 流逐 token 输出', async () => {
    const fakeModel = new FakeStreamingChatModel({
      // 多 token 响应：FakeStreamingChatModel 会按字符 yield chunks
      responses: [new AIMessage('hello world streamed many tokens')],
    })

    const wrapped = wrapWithLangfuse(fakeModel as any)
    const wrappedResult = await countStreamEvents(wrapped)

    // 关键断言：流式事件数远大于 1（每 token 一条）。原 bug 下此值会退化为 1。
    expect(wrappedResult.messageEvents).toBeGreaterThan(5)
    expect(wrappedResult.valueEvents).toBeGreaterThan(0)
  })

  it('未包装 model 与包装 model 的 messages 事件数应一致（proxy 不应改变流式行为）', async () => {
    const responseText = 'hello world streamed many tokens here'
    const rawModel = new FakeStreamingChatModel({ responses: [new AIMessage(responseText)] })
    const rawResult = await countStreamEvents(rawModel as any)

    const wrappedModel = new FakeStreamingChatModel({ responses: [new AIMessage(responseText)] })
    const wrappedResult = await countStreamEvents(wrapWithLangfuse(wrappedModel as any))

    expect(wrappedResult.messageEvents).toBe(rawResult.messageEvents)
    expect(wrappedResult.valueEvents).toBe(rawResult.valueEvents)
  })

  /**
   * 回归测试：子 chain 不得在 invoke/stream 第二参数显式传 callbacks，否则覆盖 ALS 中
   * 的 StreamMessagesHandler。
   *
   * 历史 bug：runAnalysisSubAgent / 业务子 chain 调用 model.invoke 时显式传
   * `{ callbacks: [...buildLangfuseTopLevelConfig().callbacks] }`，LangChain ensureConfig
   * 把显式 callbacks 视为覆盖 ALS implicit config（ALS 来自父 graph runManager.getChild()），
   * 导致 LangGraph streamMode='messages' 注入到 ALS 的 StreamMessagesHandler 被挤掉，
   * model token 不再 emit chunks，整段 ai message 改走 handleLLMEnd 一次性输出。
   */
  it('子 chain 显式传 buildLangfuseTopLevelConfig().callbacks 会覆盖 ALS 的 StreamMessagesHandler（验证教训）', async () => {
    const responseText = 'hello world streamed many tokens here'
    // 模拟父 graph 在 ALS 中放了 StreamMessagesHandler（streamMode: messages）。
    // 我们直接跑子 chain 的等价场景：单 graph + model.invoke 显式带上 callbacks 数组。
    const fakeModel = new FakeStreamingChatModel({ responses: [new AIMessage(responseText)] })
    const wrapped = wrapWithLangfuse(fakeModel as any)

    const graphWithExplicitCallbacks = new StateGraph(MessagesAnnotation)
      .addNode('llm', async (state) => {
        // 错误用法：在子 chain 里把 buildLangfuseTopLevelConfig() 整体展开传给 model.invoke
        return await withLangfuseContext({ vertical: 'case-analysis' as any }, async () => {
          const config = buildLangfuseTopLevelConfig()
          // 模拟历史 bug：把 [langfuseHandler] 显式传给 model.invoke
          return { messages: [await wrapped.invoke(state.messages, { callbacks: [{ name: 'fake-langfuse', handleLLMNewToken: () => {} } as any], ...config })] }
        })
      })
      .addEdge(START, 'llm')
      .addEdge('llm', END)
      .compile()

    const stream = await graphWithExplicitCallbacks.stream(
      { messages: [new HumanMessage('hi')] },
      { streamMode: ['values', 'messages'] as any },
    )
    let m = 0, v = 0
    for await (const chunk of stream) {
      const [mode] = chunk as [string, unknown]
      if (mode === 'messages') m++
      if (mode === 'values') v++
    }
    // 显式 callbacks 覆盖 ALS → token 流失效，messages 退化为 1
    // 这条断言记录了反向行为；如果未来有人在 modelProxy 重新注入 callbacks 或
    // 在子 chain 调用点重新加 buildLangfuseTopLevelConfig，会让这个数字仍是 1，
    // 而上一条用例会从 1 涨回 >5，红牌可见。
    expect(m).toBe(1)
    expect(v).toBeGreaterThan(0)
  })
})
