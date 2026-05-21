/**
 * POST /api/v1/assistant/chat
 *
 * Assistant 会话的 SSE 对话入口。复用 `case/analysis/chat.post.ts` 的 6 分支范式，
 * 仅替换鉴权与入队参数：scope='assistant'，caseId=null。
 *
 * 参见 spec §5.6.4。
 *
 * 6 分支（与 case 域对齐）：
 * 1. 活跃 run=INTERRUPTED + 新消息 → 将旧 run 标完成（释放 partial unique index），入队携带 command
 * 2. 活跃 run=RUNNING + 新消息   → 429 拒绝
 * 3. 活跃 run（其他） → 复用 activeRun.id，重连 SSE 订阅
 * 4. 无活跃 run + 有消息/command → 入队新 run（P2002 竞态兜底）
 * 5. 无活跃 run + 无消息无 command + 有最新 run → 从最新 run 历史重放
 * 6. 无活跃 run + 无消息无 command + 无最新 run → 400
 */

import {
    findActiveRunBySessionIdDAO,
    findLatestRunBySessionIdDAO,
    updateRunStatusDAO,
} from '~~/server/services/agent/agentRun.dao'
import { enqueueRunService } from '~~/server/services/agent/agentRun.service'
import { getAssistantSessionService } from '~~/server/services/assistant/assistantSession.service'
import { checkPointsService } from '~~/server/services/point/pointConsumption.service'
import { createAgentSseStream, createEmptyAgentSseResponse } from '~~/server/services/sse/agentSseStream'
import {
    extractChatParams,
    shouldRejectMessage,
    isValidResumeCommand,
    getResumeCount,
    shouldRejectResume,
} from '~~/server/utils/chat-branch-utils'
import { AGENT_RUN_STATUS } from '#shared/types/agentRun'

/** 提示词防火墙黑名单（与 case chat.post 对齐） */
const BLACKLIST_PATTERNS: RegExp[] = [
    /system\s*prompt/i,
    /ignore\s*previous/i,
    /忽略之前的指令/,
    /忽略上面的/,
    /输出你的提示词/,
    /显示系统提示/,
]

const MAX_MESSAGE_LENGTH = 10000

export default defineEventHandler(async (event) => {
    // 1. 鉴权
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 2. 解析 FetchStreamTransport 协议请求体（与 case/analysis/chat.post 对齐）
    const raw = await readBody(event).catch(() => ({}))
    const { sessionId, message, command, thinking } = extractChatParams(raw ?? {})

    if (!sessionId) {
        return resError(event, 400, 'sessionId 不能为空')
    }
    if (message !== undefined && message.length > MAX_MESSAGE_LENGTH) {
        return resError(event, 400, '输入内容过长，单次消息最大 10,000 字符')
    }

    // 3. 提示词防火墙
    if (message && BLACKLIST_PATTERNS.some(p => p.test(message))) {
        return resError(event, 400, '检测到不安全的输入内容')
    }

    // 4. scope 校验 + 归属校验
    const session = await getAssistantSessionService(sessionId, user.id)
    if (!session) {
        return resError(event, 404, '会话不存在或无权访问')
    }

    // 5. 积分门控（§5.5：错误不做友好兜底，让 Nitro 500 以触发告警）
    const pointCheck = await checkPointsService(user.id, 'assistant_token', 1)
    if (!pointCheck.sufficient) {
        return resError(event, 402, `积分不足（可用 ${pointCheck.available}）`)
    }

    // 6. 六分支路由（严格对齐 case chat.post）
    const activeRun = await findActiveRunBySessionIdDAO(sessionId)
    let runId: string
    let latestRunStatus: string | undefined

    if (activeRun && command && activeRun.status === AGENT_RUN_STATUS.INTERRUPTED) {
        // 分支 1：INTERRUPTED + LangGraph resume command → resume 路径
        // 触发条件看 command（如选完模板回传 templateId / 选完立场回传 stance），message 与否无关。
        // 历史 bug：本判断曾误用 message 做触发条件，导致用户选模板（仅 command 无 message）落到分支 3
        // 复用旧 runId，server 不消费 command，对话直接断流。修复对齐 case/analysis/chat.post.ts。
        if (!isValidResumeCommand(command)) {
            return resError(event, 400, '无效的 resume 命令')
        }
        const resumeCount = getResumeCount(activeRun.metadata)
        if (shouldRejectResume(resumeCount)) {
            return resError(event, 429, 'Resume 次数已达上限，请开启新会话')
        }
        // 先把旧 run 标完成以释放 (sessionId, status IN pending/running) partial unique index，
        // 否则 enqueueRunService 内的 findActiveRunBySessionIdDAO 会拦截返回旧 runId 吞掉 resume。
        await updateRunStatusDAO(activeRun.id, AGENT_RUN_STATUS.COMPLETED, {
            completedAt: new Date(),
            metadata: { ...((activeRun.metadata as any) || {}), resumeCount: resumeCount + 1 },
        })
        const result = await enqueueRunService({
            sessionId,
            threadId: sessionId,
            userId: user.id,
            caseId: null,
            input: { message, command, thinking },
        })
        if ('error' in result) {
            return resError(event, 429, result.error)
        }
        runId = result.runId
    }
    else if (activeRun) {
        // 分支 2：RUNNING + 新消息 → 429
        if (shouldRejectMessage(activeRun.status, !!message)) {
            return resError(event, 429, '请等待当前分析完成')
        }
        // 分支 3：其他活跃状态（PENDING / INTERRUPTED 无消息等）→ 重连订阅
        runId = activeRun.id
    }
    else if (!message && !command) {
        // 分支 5/6：无活跃 run + 无消息无 command
        const latestRun = await findLatestRunBySessionIdDAO(sessionId)
        if (!latestRun) {
            // 分支 6：会话从未运行过，前端 loadHistory()（submit(undefined)）拉历史时
            // 无历史可回放——属正常状态而非错误，不报 400。
            return createEmptyAgentSseResponse(event)
        }
        runId = latestRun.id
        latestRunStatus = latestRun.status
    }
    else {
        // 分支 4：无活跃 run + 有消息或 command → 入队新 run
        try {
            const result = await enqueueRunService({
                sessionId,
                threadId: sessionId,
                userId: user.id,
                caseId: null,
                input: { message, command, thinking },
            })
            if ('error' in result) {
                return resError(event, 429, result.error)
            }
            runId = result.runId
        }
        catch (err: any) {
            // P2002 竞态兜底：并发双发时另一个请求抢先建了 active run
            if (err?.code === 'P2002') {
                const raceActive = await findActiveRunBySessionIdDAO(sessionId)
                if (raceActive) {
                    runId = raceActive.id
                }
                else {
                    throw err
                }
            }
            else {
                throw err
            }
        }
    }

    // 7. SSE 响应头
    setResponseHeaders(event, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    })

    // 8. 复用共享 SSE 流工厂
    const stream = createAgentSseStream({ runId, event, sessionId, latestRunStatus })
    return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream' },
    })
})
