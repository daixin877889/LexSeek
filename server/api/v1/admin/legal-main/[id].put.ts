/**
 * 更新法律法规
 * PUT /api/v1/admin/legal-main/:id
 */
import { z } from 'zod'
import { LegalType } from '#shared/types/legal'

// 请求体验证
const bodySchema = z.object({
    name: z.string().min(1).max(200).optional(),
    code: z.string().min(1).max(100).optional(),
    type: z.nativeEnum(LegalType).optional(),
    category: z.string().max(100).nullable().optional(),
    content: z.string().min(1).optional(),
    issuingAuthority: z.string().max(200).nullable().optional(),
    documentNumber: z.string().max(100).nullable().optional(),
    publishDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).nullable().optional(),
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).nullable().optional(),
    invalidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).nullable().optional(),
})

export default defineEventHandler(async (event) => {
    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 获取路由参数
    const id = getRouterParam(event, 'id')
    if (!id) {
        return resError(event, 400, '无效的法律法规 ID')
    }

    // 解析请求体
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, result.error.issues[0]?.message || '参数错误')
    }

    // 检查是否有更新内容
    if (Object.keys(result.data).length === 0) {
        return resError(event, 400, '没有需要更新的内容')
    }

    try {
        // 调用服务层更新
        const legal = await updateLegalMainService(id, result.data)
        logger.info(`用户 ${user.id} 更新了法律法规: ${legal.name} (${legal.id})`)
        return resSuccess(event, '更新成功', legal)
    } catch (error) {
        const message = error instanceof Error ? error.message : '更新失败'
        // 根据错误类型返回不同状态码
        if (message.includes('不存在')) {
            return resError(event, 404, message)
        }
        return resError(event, 400, message)
    }
})
