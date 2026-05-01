/**
 * 初始化分析 Session 创建（补充分析入口）
 *
 * POST /api/v1/cases/analysis/init-session
 *
 * 为指定案件创建 type=2 的初始化分析 session，不启动分析。
 * 创建后前端跳转到 init-analysis 页面，用户选择模块后开始分析。
 */
import { z } from 'zod'
import { createSessionDAO } from '~~/server/services/case/session.dao'
import { validateCaseAccessService } from '~~/server/services/case/case.service'

const bodySchema = z.object({
    caseId: z.number().int().positive(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const body = await readBody(event)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
    }

    const { caseId } = parsed.data

    // 验证案件权限
    try {
        await validateCaseAccessService(caseId, user.id)
    } catch {
        return resError(event, 403, '案件不存在或无权访问')
    }

    const result = await createSessionDAO({
        caseId,
        userId: user.id,
        type: 2,
        metadata: {},
    })
    if (!result) return resError(event, 404, '案件不存在')

    return resSuccess(event, '创建成功', {
        sessionId: result.sessionId,
        isNew: result.isNew,
    })
})
