/**
 * 批量更新法律条文排序
 *
 * POST /api/v1/admin/legal-articles/batch-sort
 *
 * 请求体：
 * - legalId: 法律 ID
 * - items: 排序项列表 [{ id, order }]
 */

import { z } from 'zod'
import { batchSortArticlesService } from '~~/server/services/legal/legalArticles.service'

// 请求体验证
const bodySchema = z.object({
    legalId: z.string({ message: '法律 ID 不能为空' }).min(1, '法律 ID 不能为空'),
    items: z.array(z.object({
        id: z.string({ message: '条文 ID 不能为空' }).min(1, '条文 ID 不能为空'),
        order: z.number({ message: '排序序号必须是数字' }).int('排序序号必须是整数'),
    })).min(1, '排序项不能为空'),
})

export default defineEventHandler(async (event) => {
    // 验证用户权限
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    try {
        // 获取并验证请求体
        const body = await readBody(event)
        const validatedBody = bodySchema.parse(body)

        // 批量更新排序
        const count = await batchSortArticlesService(validatedBody)

        return resSuccess(event, `已更新 ${count} 条条文的排序`, { count })
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return resError(event, 400, error.issues[0]?.message || '参数验证失败')
        }
        logger.error('批量更新排序失败:', error)
        return resError(event, 500, error.message || '批量更新排序失败')
    }
})
