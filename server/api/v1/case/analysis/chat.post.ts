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
 */

import { findCaseBySessionIdService } from '~~/server/services/case/caseSession.service'
import { enqueueRunService, getActiveRunService } from '~~/server/services/agent/agentRun.service'
import { replayEvents, createEventSubscription } from '~~/server/services/agent/agentEventBridge'
import { AGENT_RUN_STATUS } from '#shared/types/agentRun'

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

/** 终结状态列表 */
const TERMINAL_STATUSES: readonly string[] = [
  AGENT_RUN_STATUS.COMPLETED,
  AGENT_RUN_STATUS.FAILED,
  AGENT_RUN_STATUS.CANCELLED,
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

  if (activeRun) {
    if (message) {
      // 已有活跃 run + 有新消息 → 返回错误
      return resError(event, 429, '请等待当前分析完成')
    }
    // 已有活跃 run + 无新消息 → 重连订阅模式
    runId = activeRun.id
  }
  else {
    if (!message && !command) {
      // 无活跃 run + 无消息也无 command → 返回错误
      return resError(event, 400, '消息不能为空')
    }
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
        const missed = await replayEvents(runId)
        for (const evt of missed) {
          const sseData = evt.type === 'stream_event'
            ? `event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`
            : `event: status\ndata: ${JSON.stringify(evt)}\n\n`
          controller.enqueue(encoder.encode(sseData))
        }

        // 检查是否已经结束（补发的最后一个事件可能是终结状态）
        const lastMissed = missed.at(-1)
        if (lastMissed?.type === 'status_change' && TERMINAL_STATUSES.includes(lastMissed.status)) {
          return
        }

        // 订阅实时事件
        for await (const evt of createEventSubscription(runId, abortController.signal)) {
          if (evt.type === 'status_change' && TERMINAL_STATUSES.includes(evt.status)) {
            controller.enqueue(encoder.encode(`event: status\ndata: ${JSON.stringify(evt)}\n\n`))
            break
          }
          if (evt.type === 'stream_event') {
            controller.enqueue(encoder.encode(
              `event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`,
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
