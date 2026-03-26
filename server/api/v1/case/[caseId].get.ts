/**
 * 获取案件信息
 *
 * GET /api/v1/case/[caseId]
 *
 * 获取指定案件的详细信息，包括案件类型和会话列表
 * Requirements: 9.1
 */

import {
    getCaseByIdService,
    validateCaseAccessService,
} from '~~/server/services/case/case.service'
import { getSessionAnalysesService } from '~~/server/services/case/analysis.service'

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

    try {
        // 验证用户对案件的访问权限
        await validateCaseAccessService(caseId, user.id)

        // 获取案件详情（包含关联数据）
        const caseRecord = await getCaseByIdService(caseId, true)
        if (!caseRecord) {
            return resError(event, 404, '案件不存在')
        }

        // 获取最新会话的分析结果
        let latestAnalyses: any[] = []
        if (caseRecord.caseSessions && caseRecord.caseSessions.length > 0) {
            const latestSession = caseRecord.caseSessions[0]! // 已按创建时间降序排列
            const analyses = await getSessionAnalysesService(latestSession.sessionId)
            latestAnalyses = analyses.map(a => ({
                id: a.id,
                nodeId: a.nodeId,
                analysisType: a.analysisType,
                version: a.version,
                status: a.status,
                createdAt: a.createdAt,
                node: a.node ? {
                    name: a.node.name,
                    title: a.node.title,
                    type: a.node.type,
                } : null,
            }))
        }

        logger.info('获取案件信息成功', {
            caseId,
            userId: user.id,
        })

        return resSuccess(event, '获取案件信息成功', {
            id: caseRecord.id,
            title: caseRecord.title,
            content: caseRecord.content,
            caseTypeId: caseRecord.caseTypeId,
            plaintiff: caseRecord.plaintiff,
            defendant: caseRecord.defendant,
            status: caseRecord.status,
            isDemo: caseRecord.isDemo,
            createdAt: caseRecord.createdAt,
            updatedAt: caseRecord.updatedAt,
            caseType: caseRecord.caseType ? {
                id: caseRecord.caseType.id,
                name: caseRecord.caseType.name,
                description: caseRecord.caseType.description,
            } : null,
            sessions: caseRecord.caseSessions?.map(s => ({
                id: s.id,
                sessionId: s.sessionId,
                status: s.status,
                createdAt: s.createdAt,
            })) ?? [],
            latestAnalyses,
        })
    } catch (error: any) {
        logger.error('获取案件信息失败', {
            caseId,
            userId: user.id,
            error: error.message,
        })

        // 处理权限错误
        if (error.message === '无权访问该案件') {
            return resError(event, 403, error.message)
        }

        return resError(event, 500, error.message || '获取案件信息失败')
    }
})
