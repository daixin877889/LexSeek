/**
 * 切换分析结果的激活版本
 *
 * POST /api/v1/cases/analysis/versions/activate/[analysisId]
 *
 * 将指定版本设为激活，同模块其他版本自动取消激活
 */

import { switchActiveVersionService } from '~~/server/services/case/analysis.service'
import { validateCaseAccessService } from '~~/server/services/case/case.service'
import { findAnalysisByIdDao } from '~~/server/services/case/analysis.dao'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    const analysisIdStr = getRouterParam(event, 'analysisId')
    if (!analysisIdStr) {
        return resError(event, 400, '分析 ID 不能为空')
    }

    const analysisId = parseInt(analysisIdStr, 10)
    if (isNaN(analysisId) || analysisId <= 0) {
        return resError(event, 400, '分析 ID 无效')
    }

    // 验证分析记录存在
    const analysis = await findAnalysisByIdDao(analysisId, false)
    if (!analysis) {
        return resError(event, 404, '分析记录不存在')
    }

    // 验证案件访问权限（无权时抛出错误）
    await validateCaseAccessService(analysis.caseId, user.id)

    try {
        const updated = await switchActiveVersionService(analysisId)
        return resSuccess(event, '版本切换成功', {
            id: updated.id,
            version: updated.version,
            isActive: updated.isActive,
        })
    } catch (error: any) {
        return resError(event, 400, error.message || '版本切换失败')
    }
})
