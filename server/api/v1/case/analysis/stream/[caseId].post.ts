/**
 * SSE 流式分析
 *
 * POST /api/v1/case/analysis/stream/[caseId]
 *
 * 启动案件分析工作流，通过 SSE 实时返回分析过程和结果
 * 支持新建分析和恢复中断的分析
 *
 * Requirements: 1.3, 9.1, 9.3
 */

import { z } from 'zod'
import {
    getCaseByIdService,
    validateCaseAccessService,
    getLatestSessionService,
    createNewSessionService,
    getSessionByIdService,
    markSessionInterruptedService,
    markSessionFailedService,
} from '~~/server/services/case/case.service'
import { SessionStatus, SSEMessageType } from '#shared/types/case'
import { getMaterialsByCaseIdService } from '~~/server/services/material/material.service'
import {
    getCaseAnalysisWorkflow,
    createWorkflowConfig,
} from '~~/server/services/workflow/caseAnalysis.workflow'
import {
    createInitialState,
    type MaterialInfo,
} from '~~/server/services/workflow/state'
import {
    createSSEConnectionService,
    sendSSEMessageService,
    sendWorkflowStartEventService,
    sendWorkflowCompleteEventService,
    sendErrorEventService,
    sendParsedInterruptEventService,
    closeSSEConnectionService,
    sendSSEResponseService,
} from '~~/server/services/sse/sse.service'
import {
    processWorkflowResult,
    logInterruptEvent,
} from '~~/server/services/sse/adapter'
import { Command } from '@langchain/langgraph'

// 请求体验证
const streamAnalysisSchema = z.object({
    /** 指定会话 ID（可选，不指定则使用最新会话或创建新会话） */
    sessionId: z.string().optional(),
    /** 是否强制创建新会话 */
    forceNewSession: z.boolean().optional().default(false),
    /** 恢复数据（用于从中断点恢复） */
    resumeData: z.any().optional(),
})

export default defineEventHandler(async (event) => {
    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 获取路由参数
    const caseIdStr = getRouterParam(event, 'caseId')
    if (!caseIdStr) {
        return resError(event, 400, '案件 ID 不能为空')
    }

    const caseId = parseInt(caseIdStr, 10)
    if (isNaN(caseId) || caseId <= 0) {
        return resError(event, 400, '案件 ID 格式无效')
    }

    // 解析请求体
    const body = await readBody(event)
    const result = streamAnalysisSchema.safeParse(body)

    if (!result.success) {
        return resError(event, 400, parseErrorMessage(result.error, '参数验证失败'))
    }

    const { sessionId: requestedSessionId, forceNewSession, resumeData } = result.data

    // 创建 SSE 连接
    const connection = await createSSEConnectionService(event, {
        heartbeatInterval: 30000,
        enableHeartbeat: true,
    })

    try {
        // 验证用户对案件的访问权限
        await validateCaseAccessService(caseId, user.id)

        // 获取案件详情
        const caseRecord = await getCaseByIdService(caseId, true)
        if (!caseRecord) {
            await sendErrorEventService(connection, '案件不存在')
            await closeSSEConnectionService(connection)
            return sendSSEResponseService(connection)
        }

        // 确定使用的会话
        let session
        let isNewSession = false
        let isResume = false

        if (requestedSessionId) {
            // 使用指定的会话
            session = await getSessionByIdService(requestedSessionId)
            if (!session) {
                await sendErrorEventService(connection, '会话不存在')
                await closeSSEConnectionService(connection)
                return sendSSEResponseService(connection)
            }
            // 检查会话是否属于该案件
            if (session.caseId !== caseId) {
                await sendErrorEventService(connection, '会话不属于该案件')
                await closeSSEConnectionService(connection)
                return sendSSEResponseService(connection)
            }
            // 检查是否需要恢复
            if (session.status === SessionStatus.INTERRUPTED || session.status === SessionStatus.FAILED) {
                isResume = true
            }
        } else if (forceNewSession) {
            // 强制创建新会话
            session = await createNewSessionService(caseId)
            isNewSession = true
        } else {
            // 获取最新会话
            session = await getLatestSessionService(caseId)
            if (!session) {
                // 没有会话，创建新会话
                session = await createNewSessionService(caseId)
                isNewSession = true
            } else if (session.status === SessionStatus.INTERRUPTED || session.status === SessionStatus.FAILED) {
                // 最新会话处于中断或失败状态，可以恢复
                isResume = true
            } else if (session.status === SessionStatus.COMPLETED) {
                // 最新会话已完成，创建新会话
                session = await createNewSessionService(caseId)
                isNewSession = true
            }
        }

        const sessionId = session.sessionId

        // 发送工作流开始事件
        await sendWorkflowStartEventService(connection, {
            caseId,
            sessionId,
            isNewSession,
            isResume,
        })

        // 获取工作流实例
        const workflow = await getCaseAnalysisWorkflow()
        const workflowConfig = createWorkflowConfig({ threadId: sessionId })

        let workflowResult

        if (isResume && resumeData !== undefined) {
            // 恢复工作流
            logger.info('恢复工作流执行', {
                sessionId,
                caseId,
                userId: user.id,
            })

            workflowResult = await workflow.invoke(
                new Command({ resume: resumeData }),
                workflowConfig
            )
        } else if (isNewSession || !isResume) {
            // 启动新工作流
            // 获取案件材料
            const materials = await getMaterialsByCaseIdService(caseId)
            const materialInfos: MaterialInfo[] = materials.map(m => ({
                id: m.id,
                name: m.name,
                type: m.type,
                content: m.content || '',
            }))

            // 创建初始状态
            const initialState = createInitialState({
                userId: user.id,
                caseId,
                sessionId,
                caseTypeId: caseRecord.caseTypeId,
                materials: materialInfos,
            })

            logger.info('启动新工作流', {
                sessionId,
                caseId,
                materialsCount: materialInfos.length,
                userId: user.id,
            })

            workflowResult = await workflow.invoke(initialState, workflowConfig)
        } else {
            // 获取当前状态（用于显示中断点信息）
            const currentState = await workflow.getState(workflowConfig)
            workflowResult = currentState.values
        }

        // 处理工作流结果
        const processed = processWorkflowResult(workflowResult as Record<string, unknown>)

        if (processed.isInterrupted && processed.interrupt) {
            // 工作流被中断，发送中断事件
            await markSessionInterruptedService(sessionId)

            logInterruptEvent(processed.interrupt, {
                sessionId,
                caseId,
            })

            await sendParsedInterruptEventService(connection, processed.interrupt)

            // 发送状态更新
            await sendSSEMessageService(connection, {
                type: SSEMessageType.INFO,
                message: '等待用户输入',
                data: {
                    event: 'workflow_interrupted',
                    currentPhase: processed.state.currentPhase,
                },
            })
        } else if (processed.state.error) {
            // 工作流出错
            await markSessionFailedService(sessionId)
            await sendErrorEventService(connection, processed.state.error as string)
        } else if (processed.state.isComplete) {
            // 工作流完成
            await sendWorkflowCompleteEventService(connection, {
                caseId,
                sessionId,
                analysisResults: (processed.state.analysisResults as any[])?.map(r => ({
                    nodeId: r.nodeId,
                    moduleName: r.moduleName,
                    moduleTitle: r.moduleTitle,
                    analyzedAt: r.analyzedAt,
                })),
            })
        } else {
            // 工作流正常进行中（可能是部分完成）
            await sendSSEMessageService(connection, {
                type: SSEMessageType.INFO,
                message: '工作流执行中',
                data: {
                    event: 'workflow_progress',
                    currentPhase: processed.state.currentPhase,
                    currentModuleIndex: processed.state.currentModuleIndex,
                    selectedModulesCount: (processed.state.selectedModules as string[])?.length ?? 0,
                },
            })
        }

        logger.info('工作流执行完成', {
            sessionId,
            caseId,
            isInterrupted: processed.isInterrupted,
            isComplete: processed.state.isComplete,
            error: processed.state.error,
            userId: user.id,
        })

        // 关闭连接
        await closeSSEConnectionService(connection)
        return sendSSEResponseService(connection)
    } catch (error: any) {
        logger.error('流式分析失败', {
            caseId,
            userId: user.id,
            error: error.message,
            stack: error.stack,
        })

        await sendErrorEventService(connection, error.message || '分析失败')
        await closeSSEConnectionService(connection)
        return sendSSEResponseService(connection)
    }
})
