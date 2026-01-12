/**
 * 获取案件分析历史版本
 *
 * GET /api/v1/cases/[caseId]/history
 *
 * 获取指定案件的分析历史，按节点分组，每个节点包含所有版本
 * Requirements: 9.6, 9.7
 */

import {
    getCaseByIdService,
    validateCaseAccessService,
} from '~~/server/services/case/case.service'
import { getCaseAnalysisHistoryService } from '~~/server/services/case/analysis.service'

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

        // 获取案件详情
        const caseRecord = await getCaseByIdService(caseId, false)
        if (!caseRecord) {
            return resError(event, 404, '案件不存在')
        }

        // 获取分析历史
        const history = await getCaseAnalysisHistoryService(caseId)

        logger.info('获取案件分析历史成功', {
            caseId,
            userId: user.id,
            nodeCount: history.length,
        })

        return resSuccess(event, '获取分析历史成功', {
            caseId,
            caseTitle: caseRecord.title,
            history,
        })
    } catch (error: any) {
        logger.error('获取案件分析历史失败', {
            caseId,
            userId: user.id,
            error: error.message,
        })

        // 处理权限错误
        if (error.message === '无权访问该案件') {
            return resError(event, 403, error.message)
        }

        return resError(event, 500, error.message || '获取分析历史失败')
    }
})
