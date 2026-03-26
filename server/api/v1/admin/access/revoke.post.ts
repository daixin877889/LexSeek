/**
 * 撤销会员级别节点权限
 *
 * POST /api/v1/admin/access/revoke
 * Requirements: 15.10
 */

import { z } from 'zod'

/** 请求体验证 */
const bodySchema = z.object({
    levelId: z.number({ message: '会员级别ID不能为空' })
        .int('会员级别ID必须是整数')
        .positive('会员级别ID必须是正整数'),
    nodeId: z.number({ message: '节点ID不能为空' })
        .int('节点ID必须是整数')
        .positive('节点ID必须是正整数'),
})

export default defineEventHandler(async (event) => {
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0]!!.message)
    }

    const { levelId, nodeId } = result.data

    try {
        await revokeAccessService(levelId, nodeId)
        return resSuccess(event, '撤销权限成功', null)
    } catch (error: any) {
        // 处理业务逻辑错误
        if (error.message === '权限记录不存在') {
            return resError(event, 404, error.message)
        }
        logger.error('撤销权限失败：', error)
        return resError(event, 500, '撤销权限失败')
    }
})
