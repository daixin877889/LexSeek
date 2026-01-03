/**
 * 切换权益状态
 *
 * PUT /api/v1/admin/benefits/:id/status
 */

import { z } from 'zod'

/** 请求体验证 */
const bodySchema = z.object({
    status: z.number().int().min(0).max(1),
})

export default defineEventHandler(async (event) => {
    // 获取路由参数
    const id = parseInt(getRouterParam(event, 'id') || '')
    if (isNaN(id)) {
        return resError(event, 400, '无效的权益ID')
    }

    // 验证请求体
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0].message)
    }

    const { status } = result.data

    try {
        // 检查权益是否存在
        const existing = await prisma.benefits.findFirst({
            where: { id, deletedAt: null },
        })
        if (!existing) {
            return resError(event, 404, '权益不存在')
        }

        // 更新状态
        await prisma.benefits.update({
            where: { id },
            data: {
                status,
                updatedAt: new Date(),
            },
        })

        return resSuccess(event, status === 1 ? '启用成功' : '禁用成功', { status })
    } catch (error) {
        logger.error('切换权益状态失败：', error)
        return resError(event, 500, '切换权益状态失败')
    }
})
