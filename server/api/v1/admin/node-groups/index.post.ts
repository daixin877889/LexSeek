/**
 * 创建节点分组
 *
 * POST /api/v1/admin/node-groups
 * Requirements: 14.6
 */

import { z } from 'zod'

/** 请求体验证 */
const bodySchema = z.object({
    name: z.string({ required_error: '分组名称不能为空' })
        .min(1, '分组名称不能为空')
        .max(100, '分组名称不能超过100个字符'),
    description: z.string()
        .max(255, '分组描述不能超过255个字符')
        .optional()
        .nullable(),
    priority: z.number()
        .int('优先级必须是整数')
        .min(1, '优先级最小为1')
        .default(100),
})

export default defineEventHandler(async (event) => {
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0].message)
    }

    try {
        const group = await createNodeGroupService(result.data)
        return resSuccess(event, '创建节点分组成功', group)
    } catch (error: any) {
        logger.error('创建节点分组失败：', error)
        return resError(event, 500, '创建节点分组失败')
    }
})
