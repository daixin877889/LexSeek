/**
 * 恢复工作流
 *
 * POST /api/v1/case/resume/[sessionId]
 *
 * 使用 Command(resume=...) 恢复中断的工作流执行
 * Requirements: 1.3, 9.3
 */

import { z } from 'zod'
import {
    getCaseBySessionIdService,
    validateCaseAccessService,
    getSessionByIdService,
    resumeSessionService,
} from '~~/server/services/case/case.service'
import { SessionStatus, InterruptType } from '#shared/types/case'
import { resumeCaseAnalysis } from '~~/server/services/workflow/caseAnalysis.workflow'
import {
    validateResumeData,
    formatResumeData,
    processWorkflowResult,
    logResumeEvent,
} from '~~/server/services/sse/adapter'

// 请求体验证
const resumeWorkflowSchema = z.object({
    /** 中断类型 */
    interruptType: z.nativeEnum(InterruptType, { message: '无效的中断类型' }),
    /** 用户输入数据 */
    userInput: z.any(),
})

export default defineEventHandler(async (event) => {
    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 获取路由参数
    const sessionId = getRouterParam(event, 'sessionId')
    if (!sessionId) {
        return resError(event, 400, '会话 ID 不能为空')
    }

    // 解析请求体
    const body = await readBody(event)
    const result = resumeWorkflowSchema.safeParse(body)

    if (!result.success) {
        return resError(event, 400, parseErrorMessage(result.error, '参数验证失败'))
    }

    const { interruptType, userInput } = result.data

    try {
        // 获取会话信息
        const session = await getSessionByIdService(sessionId)
        if (!session) {
            return resError(event, 404, '会话不存在')
        }

        // 获取案件信息并验证权限
        const caseRecord = await getCaseBySessionIdService(sessionId)
        if (!caseRecord) {
            return resError(event, 404, '案件不存在')
        }

        await validateCaseAccessService(caseRecord.id, user.id)

        // 检查会话状态是否可恢复
        if (session.status !== SessionStatus.INTERRUPTED && session.status !== SessionStatus.FAILED) {
            return resError(event, 400, '当前会话状态不支持恢复')
        }

        // 验证恢复数据格式
        const validation = validateResumeData(interruptType, userInput)
        if (!validation.valid) {
            return resError(event, 400, validation.error || '恢复数据格式无效')
        }

        // 格式化恢复数据
        const formattedData = formatResumeData(interruptType, userInput)

        // 更新会话状态为进行中
        await resumeSessionService(sessionId)

        // 记录恢复事件
        logResumeEvent(interruptType, {
            sessionId,
            caseId: caseRecord.id,
        })

        // 恢复工作流执行
        const workflowResult = await resumeCaseAnalysis(formattedData, {
            threadId: sessionId,
        })

        // 处理工作流结果
        const processed = processWorkflowResult(workflowResult as Record<string, unknown>)

        logger.info('工作流恢复成功', {
            sessionId,
            caseId: caseRecord.id,
            interruptType,
            isInterrupted: processed.isInterrupted,
            userId: user.id,
        })

        return resSuccess(event, '工作流恢复成功', {
            sessionId,
            caseId: caseRecord.id,
            isInterrupted: processed.isInterrupted,
            interrupt: processed.interrupt,
            state: {
                currentPhase: processed.state.currentPhase,
                isComplete: processed.state.isComplete,
                error: processed.state.error,
            },
        })
    } catch (error: any) {
        logger.error('恢复工作流失败', {
            sessionId,
            interruptType,
            userId: user.id,
            error: error.message,
        })
        return resError(event, 500, error.message || '恢复工作流失败')
    }
})
