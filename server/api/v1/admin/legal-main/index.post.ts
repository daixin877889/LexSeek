/**
 * 创建法律法规
 * POST /api/v1/admin/legal-main
 */
import { z } from 'zod'
import { LegalType } from '#shared/types/legal'

// 请求体验证
const bodySchema = z.object({
    name: z.string().min(1, '法律名称不能为空').max(200, '法律名称不能超过200字'),
    code: z.string().min(1, '法律代码不能为空').max(100, '法律代码不能超过100字'),
    type: z.nativeEnum(LegalType, { message: '无效的法律类型' }),
    category: z.string({ message: '分类必须是字符串' }).max(100, '分类不能超过100字').optional(),
    content: z.string().min(1, '法律内容不能为空'),
    issuingAuthority: z.string().max(200).optional(),
    documentNumber: z.string({ message: '文号必须是字符串' }).max(100, '文号不能超过100字').optional(),
    publishDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '发布日期格式错误').optional(),
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '生效日期格式错误').optional(),
    invalidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '失效日期格式错误').optional(),
})

export default defineEventHandler(async (event) => {
    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 解析请求体
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, result.error.issues[0]?.message || '参数错误')
    }

    try {
        // 调用服务层创建
        const legal = await createLegalMainService(result.data)
        logger.info(`用户 ${user.id} 创建了法律法规: ${legal.name} (${legal.id})`)
        return resSuccess(event, '创建成功', legal)
    } catch (error) {
        const message = error instanceof Error ? error.message : '创建失败'
        return resError(event, 400, message)
    }
})
