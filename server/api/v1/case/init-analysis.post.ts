/**
 * 初始化分析 SSE 端点
 *
 * POST /api/v1/case/init-analysis
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
import { enqueueRunService, getActiveRunService } from '~~/server/services/agent/agentRun.service'
import { replayEvents, createEventSubscription } from '~~/server/services/agent/agentEventBridge'
import { AGENT_RUN_STATUS } from '#shared/types/agentRun'

const inputSchema = z.object({
    caseId: z.number().int().positive(),
    selectedModules: z.array(z.string()).min(1),
})

/** 终结状态列表（对 SSE 连接而言，INTERRUPTED 也是终结——需关闭连接让客户端能 submit resume） */
const TERMINAL_STATUSES: readonly string[] = [
    AGENT_RUN_STATUS.COMPLETED,
    AGENT_RUN_STATUS.FAILED,
    AGENT_RUN_STATUS.CANCELLED,
    AGENT_RUN_STATUS.INTERRUPTED,
]

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

        return createSSEResponse(event, result.runId)
    }

    // 4. 新建/重连逻辑
    const parsed = inputSchema.safeParse(input)
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数校验失败')
    }

    const { caseId, selectedModules: rawModules } = parsed.data

    // 5. 验证模块名并排序
    let selectedModules: string[]
    try {
        selectedModules = validateAndSortModules(rawModules)
    } catch (err: any) {
        return resError(event, 400, err.message)
    }

    // 6. 验证案件权限
    try {
        await validateCaseAccessService(caseId, user.id)
    } catch {
        return resError(event, 403, '案件不存在或无权访问')
    }

    // 7. 检查是否有活跃的初始化分析 session（重连逻辑）
    const existingSession = await prisma.caseSessions.findFirst({
        where: { caseId, type: 2, status: 1, deletedAt: null },
        orderBy: { createdAt: 'desc' },
    })

    let runId: string
    let sessionId: string

    if (existingSession) {
        sessionId = existingSession.sessionId
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
                    return createSSEResponse(event, lastRun.id)
                }
            }

            // 有未完成模块 → 创建新 run
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
        // 8. 创建新 session + 入队 run
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

    return createSSEResponse(event, runId)
})

/**
 * 创建 SSE 响应流
 */
function createSSEResponse(event: any, runId: string) {
    setResponseHeaders(event, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    })

    const stream = new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder()
            const abortController = new AbortController()

            event.node.req.on('close', () => {
                abortController.abort()
            })

            const keepalive = setInterval(() => {
                try {
                    controller.enqueue(encoder.encode(': keepalive\n\n'))
                } catch {
                    // controller 已关闭时忽略
                }
            }, 15000)

            try {
                // 补发缺失事件（只发最后一条 values 快照，避免逐条 replay 数千条事件导致前端卡顿）
                const missed = await replayEvents(runId)
                const lastValues = [...missed].reverse()
                    .find(e => e.type === 'stream_event' && e.event === 'values')
                if (lastValues?.type === 'stream_event') {
                    controller.enqueue(encoder.encode(
                        `event: ${lastValues.event}\ndata: ${JSON.stringify(lastValues.data)}\n\n`,
                    ))
                }

                // 检查是否已结束
                const lastMissed = missed.at(-1)
                if (lastMissed?.type === 'status_change' && TERMINAL_STATUSES.includes(lastMissed.status)) {
                    // 发送终结状态事件
                    controller.enqueue(encoder.encode(
                        `event: status\ndata: ${JSON.stringify(lastMissed)}\n\n`,
                    ))
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
            } catch (err) {
                logger.error(`初始化分析 SSE 流异常: run=${runId}`, err)
            } finally {
                clearInterval(keepalive)
                abortController.abort()
                controller.close()
            }
        },
    })

    return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream' },
    })
}
