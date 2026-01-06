/**
 * 更新节点分组
 *
 * PUT /api/v1/admin/node-groups/[id]
 * Requirements: 14.7
 */

import { z } from 'zod'

/** 请求体验证 */
const bodySchema = z.object({
    name: z.string()
        .min(1, '分组名称不能为空')
        .max(100, '分组名称不能超过100个字符')
        .optional(),
    description: z.string()
        .max(255, '分组描述不能超过255个字符')
        .optional()
        .nullable(),
    priority: z.number()
        .int('优先级必须是整数')
        .min(1, '优先级最小为1')
        .optional(),
})

export default defineEventHandler(async (event) => {
    // 获取路由参数
    const id = getRouterParam(event, 'id')
    if (!id || isNaN(Number(id))) {
        return resError(event, 400, '无效的分组ID')
    }

    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0].message)
    }

    // 检查是否有更新内容
    if (Object.keys(result.data).length === 0) {
        return resError(event, 400, '没有需要更新的内容')
    }

    try {
        const group = await updateNodeGroupService(Number(id), result.data)
        return resSuccess(event, '更新节点分组成功', group)
    } catch (error: any) {
        // 处理业务逻辑错误
        if (error.message === '节点分组不存在') {
            return resError(event, 404, error.message)
        }
        logger.error('更新节点分组失败：', error)
        return resError(event, 500, '更新节点分组失败')
    }
})
