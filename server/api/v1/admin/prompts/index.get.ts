/**
 * 获取提示词列表
 *
 * GET /api/v1/admin/prompts
 * Requirements: 15.5
 */

import { z } from 'zod'
import { PROMPT_TYPES } from '#shared/types/node'
import type { PromptType } from '#shared/types/node'
import { getPromptsService } from '~~/server/services/node/prompt.service'

/** 查询参数验证 */
const querySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    nodeId: z.coerce.number().int().positive().optional(),
    type: z.enum(PROMPT_TYPES).optional(),
    status: z.coerce.number().int().min(0).max(1).optional(),
    keyword: z.string().optional(),
    orderBy: z.enum(['version', 'name', 'createdAt']).default('createdAt'),
    orderDir: z.enum(['asc', 'desc']).default('desc'),
})

export default defineEventHandler(async (event) => {
    const query = getQuery(event)
    const result = querySchema.safeParse(query)
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0]!!.message)
    }

    const { page, pageSize, nodeId, type, status, keyword, orderBy, orderDir } = result.data

    try {
        const data = await getPromptsService({
            page,
            pageSize,
            nodeId,
            type: type as PromptType | undefined,
            status,
            keyword,
            orderBy,
            orderDir,
        })

        // ★ Phase 4：将 _count.nodePrompts 暴露为 referencedByCount，隐藏内部 _count
        const items = data.list.map((p: any) => {
            const { _count, ...rest } = p
            return {
                ...rest,
                referencedByCount: _count?.nodePrompts ?? 0,
            }
        })

        return resSuccess(event, '获取提示词列表成功', {
            items,
            total: data.total,
            totalPages: Math.ceil(data.total / pageSize),
        })
    } catch (error) {
        logger.error('获取提示词列表失败：', error)
        return resError(event, 500, '获取提示词列表失败')
    }
})
