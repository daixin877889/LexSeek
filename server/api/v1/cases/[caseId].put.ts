/**
 * 更新案件基本信息
 *
 * PUT /api/v1/cases/[caseId]
 *
 * 调 updateCaseService 真正写库。owner-only 由 validateCaseAccessService 保证。
 *
 * 历史：M2 重构时把 saveCaseInfoService 写库逻辑注释掉了，handler 直接 return 成功，
 * 导致"编辑信息"在生产是假修改（前端用编辑数据本地刷新 caseInfo 看似生效，
 * 刷新页面就丢）。本次重写接回 updateCaseService 全字段持久化。
 */
import { z } from 'zod'
import {
    validateCaseAccessService,
    updateCaseService,
} from '~~/server/services/case/case.service'
import type { UpdateCaseInput } from '#shared/types/case'
import { CaseStance } from '#shared/types/case'

const bodySchema = z.object({
    title: z.string().trim().min(1).max(500).optional(),
    content: z.string().max(10000).optional(),
    status: z.number().int().positive().optional(),
    plaintiff: z.array(z.string().trim().min(1)).optional(),
    defendant: z.array(z.string().trim().min(1)).optional(),
    courtName: z.string().trim().max(200).optional(),
    firstInstanceCaseNo: z.string().trim().max(100).optional(),
    firstInstanceJudge: z.string().trim().max(100).optional(),
    secondInstanceCaseNo: z.string().trim().max(100).optional(),
    secondInstanceJudge: z.string().trim().max(100).optional(),
    stance: z.nativeEnum(CaseStance).optional(),
}).refine(
    data => Object.keys(data).length > 0,
    { message: '至少需要提供一个更新字段' },
)

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const caseIdStr = getRouterParam(event, 'caseId')
    const caseId = Number.parseInt(caseIdStr || '', 10)
    if (Number.isNaN(caseId) || caseId <= 0) return resError(event, 400, '无效的案件 ID')

    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) return resError(event, 400, result.error.issues[0]?.message ?? '参数校验失败')

    const updates = result.data
    if (updates.plaintiff) updates.plaintiff = [...new Set(updates.plaintiff)]
    if (updates.defendant) updates.defendant = [...new Set(updates.defendant)]

    try {
        await validateCaseAccessService(caseId, user.id)
        // zod parsed object 的运行时 shape 与 UpdateCaseInput 一致；用 satisfies
        // 收紧类型（types.md 禁 `as any`），编译期会校验所有字段对齐。
        await updateCaseService(caseId, updates satisfies UpdateCaseInput)
        return resSuccess(event, '更新成功', { id: caseId })
    }
    catch (error: any) {
        logger.error('更新案件基本信息失败', { caseId, error: error.message })
        if (error.message === '案件不存在') return resError(event, 404, error.message)
        if (error.message === '无权访问该案件') return resError(event, 403, error.message)
        if (error.message === '案件已归档，不可编辑') return resError(event, 403, error.message)
        return resError(event, 500, '更新失败')
    }
})
