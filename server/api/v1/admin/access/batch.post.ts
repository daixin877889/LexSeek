/**
 * 批量更新会员级别的节点权限
 *
 * POST /api/v1/admin/access/batch
 * Requirements: 15.11
 *
 * 完全替换指定会员级别的节点权限列表
 */

import { z } from 'zod'

/** 请求体验证 */
const bodySchema = z.object({
    levelId: z.number({ message: '会员级别ID不能为空' })
        .int('会员级别ID必须是整数')
        .positive('会员级别ID必须是正整数'),
    nodeIds: z.array(
        z.number()
            .int('节点ID必须是整数')
            .positive('节点ID必须是正整数')
    ).default([]),
})

export default defineEventHandler(async (event) => {
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0].message)
    }

    const { levelId, nodeIds } = result.data

    try {
        await batchUpdateAccessService(levelId, nodeIds)
        return resSuccess(event, '批量更新权限成功', null)
    } catch (error: any) {
        // 处理业务逻辑错误
        if (error.message === '会员级别不存在') {
            return resError(event, 404, error.message)
        }
        if (error.message.includes('节点') && error.message.includes('不存在')) {
            return resError(event, 404, error.message)
        }
        logger.error('批量更新权限失败：', error)
        return resError(event, 500, '批量更新权限失败')
    }
})
