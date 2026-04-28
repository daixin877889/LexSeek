/**
 * 通用 Agent SSE 流构造器
 *
 * 抽取自 server/api/v1/case/analysis/chat.post.ts 的内联实现（原 L215-370），
 * 用于服务所有订阅 AgentRun 事件流的 SSE 端点（case chat、assistant chat 等）。
 *
 * 行为：
 * - 已完成 run（latestRunStatus ∈ TERMINAL_STATUSES）：跳过 Redis Stream 重放，
 *   直接从 PostgresSaver 取最终 checkpoint 发送一次 values 事件后关闭。
 * - 活跃 run：先通过 replayEvents 补发 Redis Stream 中缺失的历史事件，
 *   再通过 createEventSubscription 订阅实时事件，直到终结状态后关闭。
 * - 客户端断开：on('close') 触发 AbortController，清理 keepalive 与 controller。
 * - Keepalive：每 15 秒注入 `: keepalive\n\n`，避免 Nginx/CDN/LB 超时切断。
 */

import type { H3Event } from 'h3'
import { replayEvents, createEventSubscription } from '~~/server/services/agent/agentEventBridge'
import { getActiveRunService } from '~~/server/services/agent/agentRun.service'
import { getThreadValuesService } from '~~/server/services/workflow/agents'
import { AGENT_RUN_STATUS } from '#shared/types/agentRun'

/** 终结状态列表（包括 interrupted，重连时 replay 后需关闭流） */
const TERMINAL_STATUSES: readonly string[] = [
  AGENT_RUN_STATUS.COMPLETED,
  AGENT_RUN_STATUS.FAILED,
  AGENT_RUN_STATUS.CANCELLED,
  AGENT_RUN_STATUS.INTERRUPTED,
]

/** 判断单条消息是否为内部消息（system / 注入上下文），不应发送到前端 */
function isInternalMessage(m: any): boolean {
  // 只过滤 SystemMessage（ToolMessage 必须保留，前端需要它匹配工具调用结果）
  if (m._getType?.() === 'system') return true
  const type = m.type ?? m.data?.type
  if (type === 'system') return true

  // HumanMessage 检测 metadata（注入的上下文消息）
  const injector = (m.response_metadata?.injectedBy ?? m.data?.response_metadata?.injectedBy) as string | undefined
  if (injector?.startsWith('ModuleContext') || injector?.startsWith('CaseMaterial')) {
    return true
  }

  return false
}

/** 过滤掉上下文注入消息（HumanMessage with metadata.injectedBy） */
function filterInjectedMessages(messages: any[]): any[] {
  return messages.filter(m => !isInternalMessage(m))
}

/** 过滤 messages 事件中的内部消息，返回 null 表示整条事件应跳过 */
function filterMessagesEvent(data: any): any | null {
  if (Array.isArray(data)) {
    const filtered = data.filter((m: any) => !isInternalMessage(m))
    return filtered.length > 0 ? filtered : null
  }
  return isInternalMessage(data) ? null : data
}

/**
 * 创建 Agent SSE 流所需的入参。
 *
 * - `runId`：初始 run 标识。若启动时检测到当前 session 有更新的活跃 run，内部会覆盖为该 run。
 * - `event`：H3 事件对象，用于监听客户端断开（`event.node.req.on('close')`）。
 * - `sessionId`：LangGraph thread_id，用于查询当前活跃 run 以及 PostgresSaver checkpoint。
 * - `latestRunStatus`：可选，最近一次 run 的状态；若为终结状态则走"仅发 checkpoint"快路径。
 */
export interface CreateAgentSseStreamOptions {
  runId: string
  event: H3Event
  sessionId: string
  latestRunStatus?: string
}

/**
 * 构造一个符合 LangGraph `toEventStream()` 协议的 SSE ReadableStream。
 *
 * 注意：本函数只负责编排"补发 + 订阅"，session/run/case 等权限与业务校验应在调用方完成。
 * 内部不做任何额外的 DB 权限查询，避免重复往返。
 */
export function createAgentSseStream(
  opts: CreateAgentSseStreamOptions,
): ReadableStream<Uint8Array> {
  const { event, sessionId, latestRunStatus } = opts
  let { runId } = opts

  return new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const abortController = new AbortController()

      // 客户端断开时 abort
      event.node.req.on('close', () => {
        abortController.abort()
      })

      // Keepalive 心跳（防止 Nginx/CDN/LB 超时）
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'))
        }
        catch {
          // controller 已关闭时忽略
        }
      }, 15000)

      try {
        const isCompletedRun = latestRunStatus
          ? TERMINAL_STATUSES.includes(latestRunStatus)
          : false

        logger.info(`[SSE] runId=${runId}, latestRunStatus=${latestRunStatus}, isCompletedRun=${isCompletedRun}`)

        const currentActiveRun = await getActiveRunService(sessionId)
        logger.info(`[SSE] currentActiveRun=${currentActiveRun ? currentActiveRun.id : 'null'}`)
        if (currentActiveRun) {
          runId = currentActiveRun.id
        }
        else if (isCompletedRun) {
          const checkpointValues = await getThreadValuesService(sessionId)
          const messages = (checkpointValues?.messages as any[]) || []
          logger.info(`[SSE] checkpointValues exists=${!!checkpointValues}, messages count=${messages.length}`)
          if (checkpointValues) {
            if (messages.length > 0) {
              const filteredMessages = filterInjectedMessages(messages)
              logger.info(`[SSE] filteredMessages count=${filteredMessages.length}`)
              controller.enqueue(encoder.encode(
                `event: values\ndata: ${JSON.stringify({ ...checkpointValues, messages: filteredMessages })}\n\n`,
              ))
            }
          }
          return
        }
        // 有活跃 run 但旧 run 未完成或有未终结状态：走 replay + subscribe（需求2）

        // 活跃 run：重放 Redis Stream 补发历史事件，再订阅实时事件
        let missed: any[] = []
        try {
          missed = await replayEvents(runId)
        } catch (err) {
          logger.warn(`Redis Stream 补发失败: run=${runId}`, err)
        }

        // 如果 Redis Stream 没有数据，fallback 到 PostgresSaver checkpoint
        // 注意：不能直接 return，因为 PENDING run 还没被 Worker 处理，需要继续订阅实时事件
        let hasFallbackData = false
        if (missed.length === 0) {
          const checkpointValues = await getThreadValuesService(sessionId)
          if (checkpointValues) {
            const messages = (checkpointValues.messages as any[]) || []
            if (messages.length > 0) {
              const filteredMessages = filterInjectedMessages(messages)
              controller.enqueue(encoder.encode(
                `event: values\ndata: ${JSON.stringify({ ...checkpointValues, messages: filteredMessages })}\n\n`,
              ))
              hasFallbackData = true
              // 不 return，继续订阅实时事件以接收新 run 的输出
            }
          }
          // 如果都没有数据，说明是空的 session，直接订阅实时事件即可
        }

        // Redis Stream 有数据：发送补发事件
        if (missed.length > 0) {
          // 发送所有补发事件
          for (const evt of missed) {
            let sseData: string
            if (evt.type === 'stream_event') {
              if (evt.event === 'values') {
                // values 事件需要过滤消息
                const filteredMessages = filterInjectedMessages(evt.data.messages ?? [])
                sseData = `event: values\ndata: ${JSON.stringify({ ...evt.data, messages: filteredMessages })}\n\n`
              } else if (evt.event === 'messages') {
                // messages 事件也需要过滤注入消息
                const filtered = filterMessagesEvent(evt.data)
                if (!filtered) continue
                sseData = `event: messages\ndata: ${JSON.stringify(filtered)}\n\n`
              } else {
                sseData = `event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`
              }
            }
            else if (evt.type === 'custom_event') {
              // custom 通道承载 AgentCustomEvent 和 AgentStatusEvent 两类事件，消费方按 data.type 区分
              sseData = `event: custom\ndata: ${JSON.stringify(evt)}\n\n`
            }
            else {
              sseData = `event: custom\ndata: ${JSON.stringify(evt)}\n\n`
            }
            controller.enqueue(encoder.encode(sseData))
          }

          // 检查是否已经结束（补发的最后一个事件可能是终结状态）
          // 关键：仅当 parentToolCallId 为空（父 run 自己的终结）时才视为流结束。
          // 子 Agent 的 status_change（subAgentToolFactory.handleChainEnd 发出）
          // 也是 terminal status，但只代表"该子 Agent 完成"，父 run 还在继续。
          const lastMissed = missed.at(-1)
          if (
            lastMissed?.type === 'status_change'
            && TERMINAL_STATUSES.includes(lastMissed.status)
            && !lastMissed.metadata?.parentToolCallId
          ) {
            return
          }
        }

        // 订阅实时事件（活跃 run 或补发后未结束的 run）
        for await (const evt of createEventSubscription(runId, abortController.signal)) {
          if (evt.type === 'status_change' && TERMINAL_STATUSES.includes(evt.status)) {
            controller.enqueue(encoder.encode(`event: custom\ndata: ${JSON.stringify(evt)}\n\n`))
            // 仅父 run 自己的终结才关流（带 parentToolCallId 的是子 Agent 局部信号）
            if (!evt.metadata?.parentToolCallId) break
            continue
          }
          if (evt.type === 'stream_event') {
            let sseData: string
            if (evt.event === 'values') {
              // values 事件需要过滤消息
              const data = evt.data as { messages?: any[] }
              const filteredMessages = filterInjectedMessages(data.messages ?? [])
              sseData = `event: values\ndata: ${JSON.stringify({ ...data, messages: filteredMessages })}\n\n`
            } else if (evt.event === 'messages') {
              // messages 事件也需要过滤注入消息
              const filtered = filterMessagesEvent(evt.data)
              if (!filtered) continue
              sseData = `event: messages\ndata: ${JSON.stringify(filtered)}\n\n`
            } else {
              sseData = `event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`
            }
            controller.enqueue(encoder.encode(sseData))
          }
          if (evt.type === 'custom_event') {
            // custom 通道承载 AgentCustomEvent 和 AgentStatusEvent 两类事件，消费方按 data.type 区分
            controller.enqueue(encoder.encode(
              `event: custom\ndata: ${JSON.stringify(evt)}\n\n`,
            ))
          }
        }
      }
      catch (err) {
        logger.error(`SSE 流异常: run=${runId}`, err)
      }
      finally {
        clearInterval(keepalive)
        abortController.abort()
        controller.close()
      }
    },
  })
}
