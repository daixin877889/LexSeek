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
import { enqueueRunService, getActiveRunService, getLatestRunService } from '~~/server/services/agent/agentRun.service'
import { updateRunStatusDAO } from '~~/server/services/agent/agentRun.dao'
import { replayEvents } from '~~/server/services/agent/agentEventBridge'
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

  if (activeRun && command && activeRun.status === AGENT_RUN_STATUS.INTERRUPTED) {
    // 有 interrupted run + 有 command → resume：将旧 run 标记完成，入队新 run
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
    if (message) {
      // 已有活跃 run + 有新消息 → 返回错误
      return resError(event, 429, '请等待当前分析完成')
    }
    // 已有活跃 run + 无新消息 → 重连订阅模式
    runId = activeRun.id
  }
  else {
    if (!message && !command) {
      // 无活跃 run + 无消息也无 command → 尝试从最新 run 历史重放（页面刷新后重连）
      const latestRun = await getLatestRunService(sessionId)
      if (latestRun) {
        runId = latestRun.id
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
        const missed = await replayEvents(runId)

        // 关键优化：只发最后一条 values 快照，避免数千条事件导致前端卡顿
        const lastValues = [...missed].reverse().find(e => e.type === 'stream_event' && e.event === 'values')
        if (lastValues) {
          controller.enqueue(encoder.encode(
            `event: ${lastValues.event}\ndata: ${JSON.stringify(lastValues.data)}\n\n`,
          ))
        }

        // 完成后立即关闭（SSE 连接不再需要）
        return
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
