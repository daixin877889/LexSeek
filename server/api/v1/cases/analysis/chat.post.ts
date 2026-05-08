/**
 * 统一对话 API 端点
 *
 * POST /api/v1/cases/analysis/chat
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
import { createAgentSseStream } from '~~/server/services/sse/agentSseStream'
import { scheduleConsolidation } from '~~/server/services/memory/consolidator.service'
import { AGENT_RUN_STATUS } from '#shared/types/agentRun'
import {
  shouldRejectMessage,
  isValidResumeCommand,
  shouldRejectResume,
  getResumeCount,
  extractChatParams,
} from '~~/server/utils/chat-branch-utils'

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
  const { sessionId, message, command, thinking } = extractChatParams(body)

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
    // 幂等性保护：检查 resume 次数
    const resumeCount = getResumeCount(activeRun.metadata)
    if (shouldRejectResume(resumeCount)) {
      return resError(event, 429, 'Resume 次数已达上限，请开启新会话')
    }
    // 有 interrupted run + 有合法 command → resume：将旧 run 标记完成，入队新 run
    await updateRunStatusDAO(activeRun.id, AGENT_RUN_STATUS.COMPLETED, {
      completedAt: new Date(),
      metadata: { ...(activeRun.metadata as any || {}), resumeCount: resumeCount + 1 },
    })
    const result = await enqueueRunService({
      sessionId,
      threadId: sessionId,
      userId: user.id,
      caseId: caseInfo.id,
      input: { message, command, thinking },
    })
    if ('error' in result) {
      return resError(event, 429, result.error)
    }
    runId = result.runId
    scheduleConsolidation({ caseId: caseInfo.id, sessionId })
      .catch((e: any) => logger.warn('scheduleConsolidation 失败', { sessionId, error: e }))
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
        input: { message, command, thinking },
      })
      if ('error' in result) {
        return resError(event, 429, result.error)
      }
      runId = result.runId
      scheduleConsolidation({ caseId: caseInfo.id, sessionId })
        .catch((e: any) => logger.warn('scheduleConsolidation 失败', { sessionId, error: e }))
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
  const stream = createAgentSseStream({ runId, event, sessionId, latestRunStatus })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' },
  })
})
