/**
 * 授权会员级别访问节点
 *
 * POST /api/v1/admin/access/grant
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
        return resError(event, 400, '参数错误：' + result.error.issues[0].message)
    }

    const { levelId, nodeId } = result.data

    try {
        const access = await grantAccessService(levelId, nodeId)
        return resSuccess(event, '授权成功', access)
    } catch (error: any) {
        // 处理业务逻辑错误
        if (error.message === '会员级别不存在') {
            return resError(event, 404, error.message)
        }
        if (error.message === '节点不存在') {
            return resError(event, 404, error.message)
        }
        if (error.message === '该权限已存在') {
            return resError(event, 409, error.message)
        }
        logger.error('授权失败：', error)
        return resError(event, 500, '授权失败')
    }
})
