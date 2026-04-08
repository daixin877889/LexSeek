/**
 * 统一对话 API 端点
 *
 * POST /api/v1/case/analysis/chat
 *
 * 兼容 @langchain/vue FetchStreamTransport 协议：
 * - 请求体: { input, config, command, streamSubgraphs }
 * - 响应: LangGraph toEventStream() 格式的标准 SSE 流
 *
 * 架构：入队 + 订阅 Redis + 转发 SSE
 * - 新消息 → 入队 AgentRun → Worker 后台执行 → Redis 事件 → SSE 推送
 * - 重连 → 订阅已有 Run 的 Redis 事件 → 补发缺失事件 + 实时推送
 * - 持久化保障 → Redis Stream 过期时 fallback 到 PostgresSaver checkpoint
 */

import { findCaseBySessionIdService } from '~~/server/services/case/caseSession.service'
import { enqueueRunService, getActiveRunService, getLatestRunService } from '~~/server/services/agent/agentRun.service'
import { updateRunStatusDAO } from '~~/server/services/agent/agentRun.dao'
import { replayEvents, createEventSubscription } from '~~/server/services/agent/agentEventBridge'
import { getThreadValuesService } from '~~/server/services/workflow/agents'
import { AGENT_RUN_STATUS } from '#shared/types/agentRun'
import {
  shouldRejectMessage,
  isValidResumeCommand,
  shouldRejectResume,
  getResumeCount,
  RESUME_COMMANDS,
  MAX_RESUME_COUNT,
} from '~~/server/utils/chat-branch-utils'

/** 过滤掉上下文注入消息（HumanMessage with metadata.injectedBy） */
function filterInjectedMessages(messages: any[]): any[] {
  return messages.filter(m => {
    // SystemMessage 和 ToolMessage 始终过滤
    if (m._getType?.() === 'system' || m._getType?.() === 'tool') return false

    // HumanMessage 检测 metadata
    const injector = m.response_metadata?.injectedBy as string | undefined
    if (injector?.startsWith('ModuleContext') || injector?.startsWith('CaseMaterial')) {
      return false
    }

    return true
  })
}

/** 从 FetchStreamTransport 请求体中提取参数 */
function extractParams(body: any) {
  const input = body?.input
  const config = body?.config
  const command = body?.command

  const sessionId = config?.configurable?.thread_id as string | undefined

  let message: string | undefined
  if (input?.messages && Array.isArray(input.messages)) {
    const lastMsg = input.messages.at(-1)
    if (lastMsg) {
      message = typeof lastMsg.content === 'string'
        ? lastMsg.content
        : typeof lastMsg === 'string'
          ? lastMsg
          : undefined
    }
  }

  return { sessionId, message, command }
}

/** 提示词防火墙黑名单 */
const BLACKLIST_PATTERNS = [
  /system\s*prompt/i,
  /ignore\s*previous/i,
  /忽略之前的指令/,
  /忽略上面的/,
  /输出你的提示词/,
  /显示系统提示/,
]

/** 终结状态列表（包括 interrupted，重连时 replay 后需关闭流） */
const TERMINAL_STATUSES: readonly string[] = [
  AGENT_RUN_STATUS.COMPLETED,
  AGENT_RUN_STATUS.FAILED,
  AGENT_RUN_STATUS.CANCELLED,
  AGENT_RUN_STATUS.INTERRUPTED,
]

export default defineEventHandler(async (event) => {
  // 1. 验证用户登录
  const user = event.context.auth?.user
  if (!user) {
    return resError(event, 401, '请先登录')
  }

  // 2. 解析 FetchStreamTransport 协议请求体
  const body = await readBody(event)
  const { sessionId, message, command } = extractParams(body)

  if (!sessionId) {
    return resError(event, 400, 'thread_id 不能为空')
  }

  // 3. 提示词防火墙
  if (message) {
    if (message.length > 10000) {
      return resError(event, 400, '输入内容过长，单次消息最大 10,000 字符')
    }
    if (BLACKLIST_PATTERNS.some(p => p.test(message))) {
      return resError(event, 400, '检测到不安全的输入内容')
    }
  }

  // 4. 验证案件权限
  const caseInfo = await findCaseBySessionIdService(sessionId)
  if (!caseInfo) {
    return resError(event, 404, '案件不存在')
  }
  if (user.id !== caseInfo.userId) {
    return resError(event, 403, '您没有权限访问该案件')
  }

  // 5. 四种分支逻辑
  const activeRun = await getActiveRunService(sessionId)
  let runId: string
  // 已完成 run 的状态，用于 SSE 中跳过事件重放（仅需最终 checkpoint）
  let latestRunStatus: string | undefined

  if (activeRun && command && activeRun.status === AGENT_RUN_STATUS.INTERRUPTED) {
    // 验证 command 白名单
    if (!isValidResumeCommand(command)) {
      return resError(event, 400, '无效的 resume 命令')
    }
    // 有 interrupted run + 有合法 command → resume：将旧 run 标记完成，入队新 run
    await updateRunStatusDAO(activeRun.id, AGENT_RUN_STATUS.COMPLETED, { completedAt: new Date() })
    const result = await enqueueRunService({
      sessionId,
      threadId: sessionId,
      userId: user.id,
      caseId: caseInfo.id,
      input: { message, command },
    })
    if ('error' in result) {
      return resError(event, 429, result.error)
    }
    runId = result.runId
  }
  else if (activeRun) {
    // 已有活跃 run + 有新消息 + run 正在运行 → 返回错误
    if (shouldRejectMessage(activeRun.status, !!message)) {
      return resError(event, 429, '请等待当前分析完成')
    }
    // 已有活跃 run + 无新消息或 run 非 RUNNING → 重连订阅模式
    runId = activeRun.id
  }
  else {
    if (!message && !command) {
      // 无活跃 run + 无消息也无 command → 尝试从最新 run 历史重放（页面刷新后重连）
      const latestRun = await getLatestRunService(sessionId)
      if (latestRun) {
        runId = latestRun.id
        latestRunStatus = latestRun.status
      }
      else {
        return resError(event, 400, '消息不能为空')
      }
    }
    else {
      // 无活跃 run + 有消息 → 入队新 run
      const result = await enqueueRunService({
        sessionId,
        threadId: sessionId,
        userId: user.id,
        caseId: caseInfo.id,
        input: { message, command },
      })
      if ('error' in result) {
        return resError(event, 429, result.error)
      }
      runId = result.runId
    }
  }

  // 6. 设置 SSE 响应头
  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  // 7. 创建 SSE 流
  const stream = new ReadableStream({
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
        // 补发缺失事件（重连场景）
        // 优化：已完成 run 跳过所有事件重放，直接取 PostgresSaver 最终快照发往前端。
        // Redis Stream 包含所有中间事件（流式 chunk、checkpoint 等），重放耗时且前端需
        // 处理数千个事件；而 PostgresSaver checkpoint 只存最终状态，一个 values 事件即可。
        const isCompletedRun = latestRunStatus
          ? TERMINAL_STATUSES.includes(latestRunStatus)
          : false

        // 检查此刻是否有新入队的 run（用户可能刚发了消息）
        // 优先检查活跃 run，有则直接订阅，不发旧 checkpoint（避免前端收到旧数据）
        const currentActiveRun = await getActiveRunService(sessionId)
        if (currentActiveRun) {
          runId = currentActiveRun.id
        }
        else if (isCompletedRun) {
          // 无活跃 run 且旧 run 已完成：发 checkpoint 后直接返回（需求1）
          const checkpointValues = await getThreadValuesService(sessionId)
          if (checkpointValues) {
            const messages = (checkpointValues.messages as any[]) || []
            if (messages.length > 0) {
              const filteredMessages = filterInjectedMessages(messages)
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
              } else {
                sseData = `event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`
              }
            }
            else if (evt.type === 'custom_event') {
              // 必须发完整事件对象（含 name 字段），前端依赖 evt.name 判断事件类型
              sseData = `event: custom\ndata: ${JSON.stringify(evt)}\n\n`
            }
            else {
              sseData = `event: status\ndata: ${JSON.stringify(evt)}\n\n`
            }
            controller.enqueue(encoder.encode(sseData))
          }

          // 检查是否已经结束（补发的最后一个事件可能是终结状态）
          const lastMissed = missed.at(-1)
          if (lastMissed?.type === 'status_change' && TERMINAL_STATUSES.includes(lastMissed.status)) {
            return
          }
        }

        // 订阅实时事件（活跃 run 或补发后未结束的 run）
        for await (const evt of createEventSubscription(runId, abortController.signal)) {
          if (evt.type === 'status_change' && TERMINAL_STATUSES.includes(evt.status)) {
            controller.enqueue(encoder.encode(`event: status\ndata: ${JSON.stringify(evt)}\n\n`))
            break
          }
          if (evt.type === 'stream_event') {
            let sseData: string
            if (evt.event === 'values') {
              // values 事件需要过滤消息
              const filteredMessages = filterInjectedMessages(evt.data.messages ?? [])
              sseData = `event: values\ndata: ${JSON.stringify({ ...evt.data, messages: filteredMessages })}\n\n`
            } else {
              sseData = `event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`
            }
            controller.enqueue(encoder.encode(sseData))
          }
          if (evt.type === 'custom_event') {
            // 必须发完整事件对象（含 name 字段），前端依赖 evt.name 判断事件类型
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

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' },
  })
})
