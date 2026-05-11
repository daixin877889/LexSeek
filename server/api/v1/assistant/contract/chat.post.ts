/**
 * POST /api/v1/assistant/contract/chat
 *
 * 合同审查会话的 SSE 对话入口。逐行对齐 `assistant/document/chat.post.ts`，仅替换：
 *  - DAO: findDraftBySessionIdDAO → findContractReviewBySessionIdDAO
 *  - 错误文案：文书草稿 → 合同审查会话
 *  - caseId：draft.caseId → null（M4 独立页，无案件绑定）
 *
 * 6 分支（与 assistant / document 两域对齐）：
 *  1. 活跃 run=INTERRUPTED + 新消息 → 将旧 run 标完成（释放 partial unique index），入队携带 command
 *  2. 活跃 run=RUNNING + 新消息   → 429 拒绝
 *  3. 活跃 run（其他） → 复用 activeRun.id，重连 SSE 订阅
 *  4. 无活跃 run + 有消息/command → 入队新 run（P2002 竞态兜底）
 *  5. 无活跃 run + 无消息无 command + 有最新 run → 从最新 run 历史重放
 *  6. 无活跃 run + 无消息无 command + 无最新 run → 400
 *
 * **Feature: contract-review-m4**
 */

import {
    findActiveRunBySessionIdDAO,
    findLatestRunBySessionIdDAO,
    updateRunStatusDAO,
} from '~~/server/services/agent/agentRun.dao'
import { enqueueRunService } from '~~/server/services/agent/agentRun.service'
import { findContractReviewBySessionIdDAO } from '~~/server/services/assistant/contract/contractReview.dao'
import { createAgentSseStream } from '~~/server/services/sse/agentSseStream'
import {
    extractChatParams,
    shouldRejectMessage,
    isValidResumeCommand,
    getResumeCount,
    shouldRejectResume,
} from '~~/server/utils/chat-branch-utils'
import { AGENT_RUN_STATUS } from '#shared/types/agentRun'

export default defineEventHandler(async (event) => {
    // 1. 鉴权
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 2. 解析 FetchStreamTransport 协议请求体
    const raw = await readBody(event).catch(() => ({}))
    const { sessionId, message, command, thinking } = extractChatParams(raw ?? {})

    if (!sessionId) {
        return resError(event, 400, 'sessionId 不能为空')
    }
    if (message !== undefined && message.length > 10000) {
        return resError(event, 400, '输入内容过长，单次消息最大 10,000 字符')
    }

    // 3. 校验 session 归属
    const review = await findContractReviewBySessionIdDAO(sessionId)
    if (!review) {
        return resError(event, 404, '合同审查会话不存在')
    }
    if (review.userId !== user.id) {
        return resError(event, 403, '无权访问该合同审查')
    }

    // 4. 六分支路由（严格对齐 assistant/chat.post）
    const activeRun = await findActiveRunBySessionIdDAO(sessionId)
    let runId: string
    let latestRunStatus: string | undefined

    if (activeRun && command && activeRun.status === AGENT_RUN_STATUS.INTERRUPTED) {
        // 分支 1：INTERRUPTED + LangGraph resume command → resume 路径
        // 触发条件看 command（如选立场回传 stance），不能依赖 message。历史 bug：曾误用 message 触发
        // 导致前端选立场后落到分支 3 复用旧 runId 不消费 command，对话直接断流。对齐 cases/analysis/chat.post。
        if (!isValidResumeCommand(command)) {
            return resError(event, 400, '无效的 resume 命令')
        }
        const resumeCount = getResumeCount(activeRun.metadata)
        if (shouldRejectResume(resumeCount)) {
            return resError(event, 429, 'Resume 次数已达上限，请开启新会话')
        }
        // 先把旧 run 标完成以释放 (sessionId, status IN pending/running) partial unique index
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
            return resError(event, 429, '请等待当前生成完成')
        }
        // 分支 3：其他活跃状态 → 重连订阅
        runId = activeRun.id
    }
    else if (!message && !command) {
        // 分支 5/6：无活跃 run + 无消息无 command
        const latestRun = await findLatestRunBySessionIdDAO(sessionId)
        if (!latestRun) {
            return resError(event, 400, '消息不能为空')
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

    // 5. SSE 响应头
    setResponseHeaders(event, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    })

    // 6. 复用共享 SSE 流工厂
    const stream = createAgentSseStream({ runId, event, sessionId, latestRunStatus })
    return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream' },
    })
})
