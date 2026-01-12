/**
 * 获取用户案件列表
 *
 * GET /api/v1/cases
 *
 * 获取当前用户的案件列表，支持分页和状态筛选
 * Requirements: 9.1
 */

import { z } from 'zod'
import { getUserCasesService } from '~~/server/services/case/case.service'

// 查询参数验证
const querySchema = z.object({
    /** 页码 */
    page: z.coerce.number().int().positive().optional().default(1),
    /** 每页数量 */
    pageSize: z.coerce.number().int().positive().max(100).optional().default(10),
    /** 案件状态：1-进行中，2-已完成，3-已关闭 */
    status: z.coerce.number().int().min(1).max(3).optional(),
    /** 案件类型 ID */
    caseTypeId: z.coerce.number().int().positive().optional(),
    /** 搜索关键词（标题） */
    keyword: z.string().optional(),
    /** 排序字段 */
    orderBy: z.enum(['createdAt', 'updatedAt']).optional().default('createdAt'),
    /** 排序方向 */
    orderDir: z.enum(['asc', 'desc']).optional().default('desc'),
})

export default defineEventHandler(async (event) => {
    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 解析查询参数
    const query = getQuery(event)
    const result = querySchema.safeParse(query)

    if (!result.success) {
        return resError(event, 400, parseErrorMessage(result.error, '参数验证失败'))
    }

    const { page, pageSize, status, caseTypeId, keyword, orderBy, orderDir } = result.data

    try {
        // 获取用户案件列表
        const { list, total } = await getUserCasesService(user.id, {
            page,
            pageSize,
            status,
            caseTypeId,
            keyword,
            orderBy,
            orderDir,
        })

        // 格式化返回数据
        const items = list.map(c => ({
            id: c.id,
            title: c.title,
            content: c.content ? c.content.substring(0, 200) : null, // 截取前 200 字符
            caseTypeId: c.caseTypeId,
            status: c.status,
            isDemo: c.isDemo,
            createdAt: c.createdAt,
            updatedAt: c.updatedAt,
            caseType: c.caseType ? {
                id: c.caseType.id,
                name: c.caseType.name,
            } : null,
            // 最新会话信息
            latestSession: c.caseSessions && c.caseSessions.length > 0 ? {
                sessionId: c.caseSessions[0].sessionId,
                status: c.caseSessions[0].status,
                createdAt: c.caseSessions[0].createdAt,
            } : null,
        }))

        logger.info('获取用户案件列表成功', {
            userId: user.id,
            total,
            page,
            pageSize,
        })

        return resSuccess(event, '获取案件列表成功', {
            items,
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize),
        })
    } catch (error: any) {
        logger.error('获取用户案件列表失败', {
            userId: user.id,
            error: error.message,
        })
        return resError(event, 500, error.message || '获取案件列表失败')
    }
})
