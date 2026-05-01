/**
 * 获取分析模块的版本列表
 *
 * GET /api/v1/cases/analysis/versions/[caseId]?analysisType=summary
 *
 * 按 caseId + analysisType 查询已完成的分析版本，按版本号降序
 */

import { validateCaseAccessService } from '~~/server/services/case/case.service'
import { AnalysisStatus } from '~~/server/services/case/analysis.dao'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    const caseIdStr = getRouterParam(event, 'caseId')
    if (!caseIdStr) {
        return resError(event, 400, '案件 ID 不能为空')
    }

    const caseId = parseInt(caseIdStr, 10)
    if (isNaN(caseId) || caseId <= 0) {
        return resError(event, 400, '案件 ID 无效')
    }

    // 验证案件访问权限（无权时抛出错误）
    await validateCaseAccessService(caseId, user.id)

    const query = getQuery(event)
    const analysisType = query.analysisType as string
    if (!analysisType) {
        return resError(event, 400, 'analysisType 不能为空')
    }

    const versions = await prisma.caseAnalyses.findMany({
        where: {
            caseId,
            analysisType,
            status: AnalysisStatus.COMPLETED,
            deletedAt: null,
        },
        select: {
            id: true,
            version: true,
            isActive: true,
            analysisResult: true,
            createdAt: true,
        },
        orderBy: { version: 'desc' },
    })

    return resSuccess(event, '获取版本列表成功', versions)
})
