/**
 * 获取法律条文排序树
 *
 * GET /api/v1/admin/legal-articles/sort-tree
 *
 * 查询参数：
 * - legalId: 法律 ID（必填）
 * - parentPath: 父级路径（可选，用于懒加载子节点）
 * - parentType: 父级类型（可选）
 */

import { z } from 'zod'

// 查询参数验证
const querySchema = z.object({
    legalId: z.string().min(1, '法律 ID 不能为空'),
    parentPath: z.string().optional(),
    parentType: z.enum(['l1', 'l2', 'l3', 'l4']).optional(),
})

export default defineEventHandler(async (event) => {
    // 验证用户权限
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    try {
        // 获取并验证查询参数
        const query = getQuery(event)
        const validatedQuery = querySchema.parse(query)

        // 获取排序树
        const nodes = await getSortTreeService({
            legalId: validatedQuery.legalId,
            parentPath: validatedQuery.parentPath,
            parentType: validatedQuery.parentType as any,
        })

        return resSuccess(event, '获取成功', nodes)
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return resError(event, 400, error.issues[0]?.message || '参数验证失败')
        }
        logger.error('获取排序树失败:', error)
        return resError(event, 500, error.message || '获取排序树失败')
    }
})
