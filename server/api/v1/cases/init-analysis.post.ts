/**
 * 初始化分析 SSE 端点
 *
 * POST /api/v1/cases/init-analysis
 *
 * 创建或重连初始化分析会话，返回 SSE 流推送分析进度
 * - 新建：创建 type=2 session → 入队 AgentRun → 订阅 Redis 事件 → SSE
 * - 重连：发现活跃 session + run → 补发缺失事件 + 实时推送
 * - 恢复：收到 command.resume → 恢复已中断的工作流
 */

import { z } from 'zod'
import { v7 as uuidv7 } from 'uuid'
import { validateAndSortModules } from '~~/server/services/case/initAnalysis.service'
import { validateCaseAccessService } from '~~/server/services/case/case.service'
import { enqueueRunService, getActiveRunService, getLatestRunService } from '~~/server/services/agent/agentRun.service'
import { createAgentSseStream } from '~~/server/services/sse/agentSseStream'
import { AGENT_RUN_STATUS } from '#shared/types/agentRun'

const inputSchema = z.object({
    caseId: z.number().int().positive(),
    selectedModules: z.array(z.string()).min(1),
})

/**
 * 从 FetchStreamTransport 请求体中提取参数
 *
 * FetchStreamTransport 格式:
 * { input: {...}, config: { configurable: { thread_id } }, command: {...} }
 */
function extractParams(body: any) {
    const input = body?.input
    const config = body?.config
    const command = body?.command

    const threadId = config?.configurable?.thread_id as string | undefined

    return { input, threadId, command }
}

export default defineEventHandler(async (event) => {
    // 1. 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 2. 解析 FetchStreamTransport 协议请求体
    const body = await readBody(event)
    const { input, threadId, command } = extractParams(body)

    // 3. 分支：resume（恢复中断）vs 新建/重连
    if (command?.resume) {
        // 恢复已中断的分析
        const resumeCaseId = input?.caseId as number | undefined
        const session = resumeCaseId
            ? await prisma.caseSessions.findFirst({
                where: { caseId: resumeCaseId, type: 2, deletedAt: null },
                orderBy: { createdAt: 'desc' },
            })
            : threadId
                ? await prisma.caseSessions.findFirst({
                    where: { sessionId: threadId, type: 2, deletedAt: null },
                })
                : null

        if (!session) {
            return resError(event, 404, '分析会话不存在')
        }

        // 将 interrupted 的 run 标记为 completed，让 enqueueRunService 能创建新 run
        const activeRun = await getActiveRunService(session.sessionId)
        if (activeRun && activeRun.status === AGENT_RUN_STATUS.INTERRUPTED) {
            await prisma.agentRuns.update({
                where: { id: activeRun.id },
                data: { status: AGENT_RUN_STATUS.COMPLETED, completedAt: new Date() },
            })
        }

        const result = await enqueueRunService({
            sessionId: session.sessionId,
            threadId: session.sessionId,
            userId: user.id,
            caseId: session.caseId,
            input: { command: command.resume },
        })
        if ('error' in result) {
            return resError(event, 429, result.error)
        }

        return createSSEResponse(event, result.runId, session.sessionId)
    }

    // 4. 新建/重连逻辑
    // 纯重连场景：stream.submit(undefined) 时 input 为空，但有 threadId，从 checkpoint 恢复
    let caseId: number
    let selectedModules: string[]
    let reconnectedSessionId: string | undefined  // 实际使用的 session ID（可能与 threadId 不同）

    if (!input && threadId) {
        // 纯重连：从 session 恢复信息
        // 首先尝试查找 type=2 会话（初始化分析会话）
        let session = await prisma.caseSessions.findFirst({
            where: { sessionId: threadId, type: 2, deletedAt: null },
            select: { caseId: true, metadata: true, sessionId: true },
        })

        // 如果找不到 type=2 会话，尝试查找 type=1 会话（主会话），然后获取对应的 type=2 会话
        if (!session) {
            const type1Session = await prisma.caseSessions.findFirst({
                where: { sessionId: threadId, type: 1, deletedAt: null },
                select: { caseId: true },
            })
            if (type1Session) {
                // 查找该案件的 type=2 会话
                session = await prisma.caseSessions.findFirst({
                    where: { caseId: type1Session.caseId, type: 2, deletedAt: null },
                    select: { caseId: true, metadata: true, sessionId: true },
                    orderBy: { createdAt: 'desc' },
                })
            }
        }

        if (!session) {
            return resError(event, 404, '分析会话不存在')
        }
        // 类型守卫：case 域 session 的 caseId 应非空；放宽 schema 后需显式检查避免误入 assistant 域
        if (session.caseId == null) {
            return resError(event, 400, '无效的会话（非案件域）')
        }
        caseId = session.caseId
        // 从 metadata 中恢复 selectedModules（服务端权威来源）
        const metadata = session.metadata as { selectedModules?: string[] } | null
        selectedModules = metadata?.selectedModules ?? []
        reconnectedSessionId = session.sessionId
    } else {
        // 新执行：需要完整的 input
        const parsed = inputSchema.safeParse(input)
        if (!parsed.success) {
            return resError(event, 400, parsed.error.issues[0]?.message ?? '参数校验失败')
        }
        caseId = parsed.data.caseId
        const rawModules = parsed.data.selectedModules

        // 5. 验证模块名并排序
        try {
            selectedModules = validateAndSortModules(rawModules)
        } catch (err: any) {
            return resError(event, 400, err.message)
        }
    }

    // 6. 验证案件权限
    try {
        await validateCaseAccessService(caseId, user.id)
    } catch {
        return resError(event, 403, '案件不存在或无权访问')
    }

    // 7. 查找 session
    // 纯重连模式：通过 threadId 查找任意状态的 session（含已完成）
    // 新执行模式：优先使用 threadId 指定的 session（确保目标精确），fallback 到最新活跃 session
    let existingSession
    if (reconnectedSessionId) {
        existingSession = await prisma.caseSessions.findFirst({
            where: { sessionId: reconnectedSessionId, type: 2, deletedAt: null },
        })
        if (!existingSession) {
            return resError(event, 404, '分析会话不存在')
        }
    } else if (threadId) {
        // 新执行模式 + 有 threadId：优先匹配指定 session（不限状态，允许在已完成 session 上再次分析）
        existingSession = await prisma.caseSessions.findFirst({
            where: { sessionId: threadId, caseId, type: 2, deletedAt: null },
        })
        if (!existingSession) {
            // fallback：查找该案件最新的活跃 session
            existingSession = await prisma.caseSessions.findFirst({
                where: { caseId, type: 2, status: 1, deletedAt: null },
                orderBy: { createdAt: 'desc' },
            })
        }
    } else {
        existingSession = await prisma.caseSessions.findFirst({
            where: { caseId, type: 2, status: 1, deletedAt: null },
            orderBy: { createdAt: 'desc' },
        })
    }

    let runId: string
    let sessionId: string

    if (existingSession) {
        sessionId = existingSession.sessionId

        // 纯重连模式：只读 replay 最新 run，不创建任何新 run，不修改任何状态
        // 覆盖场景：completed（replay 快照）、in_progress（重连活跃流）、interrupted（回放中断数据）
        if (reconnectedSessionId) {
            const latestRun = await getLatestRunService(sessionId)
            if (!latestRun) {
                return resError(event, 404, '无可用的分析快照')
            }
            return createSSEResponse(event, latestRun.id, sessionId)
        }

        // 新执行模式：检查 session 是否有活跃 run，决定重连或创建新 run
        const activeRun = await getActiveRunService(sessionId)
        if (activeRun && activeRun.status !== AGENT_RUN_STATUS.INTERRUPTED) {
            // 有活跃 run（pending/running）→ 重连
            runId = activeRun.id
        } else {
            // 如果是 interrupted 的 run，先标记为 completed（非 resume 模式无法恢复）
            if (activeRun?.status === AGENT_RUN_STATUS.INTERRUPTED) {
                await prisma.agentRuns.update({
                    where: { id: activeRun.id },
                    data: { status: AGENT_RUN_STATUS.COMPLETED, completedAt: new Date() },
                })
            }
            // session 存在但 run 已结束
            // 检查请求的模块是否都已在 DB 中完成（COMPLETED + pointDeducted）
            const completedAnalyses = await prisma.caseAnalyses.findMany({
                where: { sessionId, status: 2, deletedAt: null },
                select: { analysisType: true, pointDeducted: true },
            })
            const allRequestedDone = selectedModules.every(m =>
                completedAnalyses.some(a => a.analysisType === m && a.pointDeducted),
            )

            if (allRequestedDone) {
                // 请求的模块全部完成 → replay 快照（createSSEResponse 内部只发最后一条 values）
                const lastRun = await prisma.agentRuns.findFirst({
                    where: { sessionId, status: AGENT_RUN_STATUS.COMPLETED },
                    orderBy: { createdAt: 'desc' },
                })
                if (lastRun) {
                    return createSSEResponse(event, lastRun.id, sessionId)
                }
            }

            // 有未完成模块 → 更新 session（metadata + 重置 status 为活跃）并创建新 run
            await prisma.caseSessions.update({
                where: { sessionId },
                data: { status: 1, metadata: { selectedModules } },
            })

            const result = await enqueueRunService({
                sessionId,
                threadId: sessionId,
                userId: user.id,
                caseId,
                input: { selectedModules },
            })
            if ('error' in result) {
                return resError(event, 429, result.error)
            }
            runId = result.runId
        }
    } else {
        // 8. 创建新 session + 入队 run（仅新执行模式走到这里）
        sessionId = uuidv7()
        await prisma.caseSessions.create({
            data: {
                sessionId, caseId, type: 2, status: 1,
                metadata: { selectedModules },
            },
        })

        const result = await enqueueRunService({
            sessionId,
            threadId: sessionId,
            userId: user.id,
            caseId,
            input: { selectedModules },
        })
        if ('error' in result) {
            return resError(event, 429, result.error)
        }
        runId = result.runId
    }

    return createSSEResponse(event, runId, sessionId)
})

/**
 * 创建 SSE 响应流
 *
 * 复用 createAgentSseStream（与 case chat / assistant chat / contract chat 共用），
 * 启用两个针对 7 模块大流量场景的优化：
 * - useShortCircuit: 终态 run 跳过 ~2000 条 / 几 MB 的 Redis Stream XRANGE
 * - replayMode='last-values-only': 重连时只发最后一条 values 快照，避免逐条 replay 让前端卡顿
 *
 * 透传 agentRuns.error 给 shortCircuitError，让 failed 状态下前端能展示具体错误而非泛化文案。
 */
async function createSSEResponse(event: any, runId: string, sessionId?: string) {
    setResponseHeaders(event, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    })

    // 短路命中时复用 status / error，未命中由 createAgentSseStream 走 replay/订阅路径——
    // 多查一次 status/threadId/error 字段开销可忽略。
    const runRecord = await prisma.agentRuns.findUnique({
        where: { id: runId },
        select: { status: true, threadId: true, error: true },
    })
    const resolvedSessionId = sessionId ?? runRecord?.threadId ?? ''

    const stream = createAgentSseStream({
        runId,
        event,
        sessionId: resolvedSessionId,
        latestRunStatus: runRecord?.status,
        useShortCircuit: true,
        replayMode: 'last-values-only',
        shortCircuitError: runRecord?.error,
    })

    return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream' },
    })
}
