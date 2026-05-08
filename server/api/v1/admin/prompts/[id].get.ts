/**
 * 获取提示词详情
 *
 * GET /api/v1/admin/prompts/:id
 * Requirements: 15.5
 */

import { z } from 'zod'
import { getPromptByIdService } from '~~/server/services/node/prompt.service'

/** 路由参数验证 */
const paramsSchema = z.object({
    id: z.coerce.number().int().positive('ID必须是正整数'),
})

export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id')
    const paramsResult = paramsSchema.safeParse({ id })
    if (!paramsResult.success) {
        return resError(event, 400, '参数错误：' + paramsResult.error.issues[0]!.message)
    }

    try {
        const prompt = await getPromptByIdService(paramsResult.data.id) as any
        if (!prompt) {
            return resError(event, 404, '提示词不存在')
        }

        // ★ Phase 4：把 nodePrompts 关联表展开为 referencedByNodes 列表，隐藏内部字段
        const { nodePrompts, ...rest } = prompt
        const referencedByNodes = (nodePrompts ?? []).map((np: any) => ({
            id: np.node.id,
            name: np.node.name,
            title: np.node.title ?? null,
            displayOrder: np.displayOrder,
        }))

        return resSuccess(event, '获取提示词详情成功', {
            ...rest,
            referencedByCount: referencedByNodes.length,
            referencedByNodes,
        })
    } catch (error) {
        logger.error('获取提示词详情失败：', error)
        return resError(event, 500, '获取提示词详情失败')
    }
})
