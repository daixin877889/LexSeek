/**
 * 获取工作流状态
 *
 * GET /api/v1/case/state/[sessionId]
 *
 * 获取指定会话的工作流当前状态
 * Requirements: 9.1
 */

import {
    getCaseBySessionIdService,
    validateCaseAccessService,
    getSessionByIdService,
} from '~~/server/services/case/case.service'
import { getWorkflowState } from '~~/server/services/workflow/caseAnalysis.workflow'
import type { CaseAnalysisState } from '~~/server/services/workflow/state'

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

        // 获取工作流状态
        const workflowState = await getWorkflowState({ threadId: sessionId })

        // 如果工作流状态不存在，返回会话基本信息
        if (!workflowState) {
            return resSuccess(event, '获取状态成功', {
                sessionId,
                caseId: caseRecord.id,
                sessionStatus: session.status,
                workflowState: null,
                message: '工作流尚未启动或状态已清理',
            })
        }

        // 构建返回数据（过滤敏感信息）
        const stateResponse = buildStateResponse(workflowState)

        logger.info('获取工作流状态成功', {
            sessionId,
            caseId: caseRecord.id,
            currentPhase: workflowState.currentPhase,
            userId: user.id,
        })

        return resSuccess(event, '获取状态成功', {
            sessionId,
            caseId: caseRecord.id,
            sessionStatus: session.status,
            workflowState: stateResponse,
        })
    } catch (error: any) {
        logger.error('获取工作流状态失败', {
            sessionId,
            userId: user.id,
            error: error.message,
        })
        return resError(event, 500, error.message || '获取工作流状态失败')
    }
})

/**
 * 构建状态响应数据
 * 过滤敏感信息，只返回前端需要的数据
 */
function buildStateResponse(state: CaseAnalysisState) {
    return {
        // 工作流控制
        currentPhase: state.currentPhase,
        isComplete: state.isComplete,
        error: state.error,

        // 案情信息检查状态
        caseInfoSufficient: state.caseInfoSufficient,
        caseInfoCheckResult: state.caseInfoCheckResult,

        // 基本信息
        title: state.title,
        plaintiff: state.plaintiff,
        defendant: state.defendant,
        caseTypeName: state.caseTypeName,
        summary: state.summary,
        basicInfoConfirmed: state.basicInfoConfirmed,

        // 模块选择
        availableModules: state.availableModules?.map(m => ({
            nodeId: m.nodeId,
            name: m.name,
            title: m.title,
            type: m.type,
            pointCost: m.pointCost,
            discount: m.discount,
            hasAccess: m.hasAccess,
        })),
        selectedModules: state.selectedModules,

        // 分析任务
        currentModuleIndex: state.currentModuleIndex,
        analysisResults: state.analysisResults?.map(r => ({
            nodeId: r.nodeId,
            moduleName: r.moduleName,
            moduleTitle: r.moduleTitle,
            analyzedAt: r.analyzedAt,
            // 不返回完整内容，只返回是否有结果
            hasContent: !!r.content,
        })),
        lastExecutedModule: state.lastExecutedModule,
        lastExecutedTitle: state.lastExecutedTitle,

        // 材料信息（只返回基本信息）
        materialsCount: state.materials?.length ?? 0,
    }
}
