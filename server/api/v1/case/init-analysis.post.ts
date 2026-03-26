/**
 * 初始化分析 SSE 端点
 *
 * POST /api/v1/case/init-analysis
 *
 * 创建或重连初始化分析会话，返回 SSE 流推送分析进度
 * - 新建：创建 type=2 session → 入队 AgentRun → 订阅 Redis 事件 → SSE
 * - 重连：发现活跃 session + run → 补发缺失事件 + 实时推送
 */

import { z } from 'zod'
import { v7 as uuidv7 } from 'uuid'
import { validateAndSortModules, loadCompletedResultsService } from '~~/server/services/case/initAnalysis.service'
import { enqueueRunService, getActiveRunService } from '~~/server/services/agent/agentRun.service'
import { replayEvents, createEventSubscription } from '~~/server/services/agent/agentEventBridge'
import { AGENT_RUN_STATUS } from '#shared/types/agentRun'

const schema = z.object({
    caseId: z.number().int().positive(),
    selectedModules: z.array(z.string()).min(1),
})

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

    // 2. 解析请求体（FetchStreamTransport 格式：{ input: {...}, config: { configurable: { thread_id } } }）
    const body = await readBody(event)
    const params = body?.input ?? body
    const parsed = schema.safeParse(params)
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数校验失败')
    }

    const { caseId, selectedModules: rawModules } = parsed.data

    // 3. 验证模块名并排序
    let selectedModules: string[]
    try {
        selectedModules = validateAndSortModules(rawModules)
    } catch (err: any) {
        return resError(event, 400, err.message)
    }

    // 4. 验证案件权限
    try {
        await validateCaseAccessService(caseId, user.id)
    } catch {
        return resError(event, 403, '案件不存在或无权访问')
    }

    // 5. 积分/会员校验由工作流内部 interrupt 处理，此处不拦截
    //    工作流 executeModuleNode 中会检查会员状态和积分余额
    //    不足时通过 LangGraph interrupt() 中断，前端展示购买卡片

    // 6. 检查是否有活跃的初始化分析 session（重连逻辑）
    const existingSession = await prisma.caseSessions.findFirst({
        where: { caseId, type: 2, status: 1, deletedAt: null },
        orderBy: { createdAt: 'desc' },
    })

    let runId: string
    let sessionId: string

    if (existingSession) {
        sessionId = existingSession.sessionId
        const activeRun = await getActiveRunService(sessionId)
        if (activeRun) {
            runId = activeRun.id
        } else {
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
        // 创建新 session + 入队 run
        sessionId = uuidv7()
        await prisma.caseSessions.create({
            data: { sessionId, caseId, type: 2, status: 1 },
        })

        // 加载已有结果（重试场景）
        const completedResults = await loadCompletedResultsService(caseId)

        const result = await enqueueRunService({
            sessionId,
            threadId: sessionId,
            userId: user.id,
            caseId,
            input: { selectedModules, completedResults },
        })
        if ('error' in result) {
            return resError(event, 429, result.error)
        }
        runId = result.runId
    }

    // 7. 设置 SSE 响应头
    setResponseHeaders(event, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    })

    // 8. 创建 SSE 流
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
                // 补发缺失事件（重连场景）
                const missed = await replayEvents(runId)
                for (const evt of missed) {
                    const sseData = evt.type === 'stream_event'
                        ? `event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`
                        : `event: status\ndata: ${JSON.stringify(evt)}\n\n`
                    controller.enqueue(encoder.encode(sseData))
                }

                // 检查是否已经结束
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
})
