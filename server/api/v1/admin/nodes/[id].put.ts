/**
 * 更新节点
 *
 * PUT /api/v1/admin/nodes/:id
 * Requirements: 15.3
 */

import { z } from 'zod'
import { NODE_TYPES } from '#shared/types/node'
import { updateNodeService } from '~~/server/services/node/node.service'

/** 路由参数验证 */
const paramsSchema = z.object({
    id: z.coerce.number().int().positive('ID必须是正整数'),
})

/** 请求体验证 */
const bodySchema = z.object({
    title: z.string()
        .max(100, '节点标题不能超过100个字符')
        .optional()
        .nullable(),
    description: z.string()
        .max(255, '节点描述不能超过255个字符')
        .optional()
        .nullable(),
    type: z.enum(NODE_TYPES, {
        error: `节点类型必须是 ${NODE_TYPES.map(type => `'${type}'`).join('、')}`,
    }).optional(),
    priority: z.number()
        .int('优先级必须是整数')
        .min(1, '优先级最小为1')
        .optional(),
    modelId: z.number()
        .int('模型ID必须是整数')
        .positive('模型ID必须是正整数')
        .optional(),
    tools: z.array(z.string()).optional(),
    groupId: z.number()
        .int('分组ID必须是整数')
        .positive('分组ID必须是正整数')
        .optional()
        .nullable(),
    status: z.number()
        .int('状态必须是整数')
        .min(0, '状态值无效')
        .max(1, '状态值无效')
        .optional(),
    outputSchema: z.record(z.string(), z.any()).optional().nullable(),
})

export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id')
    const paramsResult = paramsSchema.safeParse({ id })
    if (!paramsResult.success) {
        return resError(event, 400, '参数错误：' + paramsResult.error.issues[0]!.message)
    }

    const body = await readBody(event)
    const bodyResult = bodySchema.safeParse(body)
    if (!bodyResult.success) {
        return resError(event, 400, '参数错误：' + bodyResult.error.issues[0]!.message)
    }

    try {
        const node = await updateNodeService(paramsResult.data.id, bodyResult.data)
        return resSuccess(event, '更新节点成功', node)
    } catch (error: any) {
        // 处理业务逻辑错误
        if (error.message === '节点不存在') {
            return resError(event, 404, error.message)
        }
        if (error.message === '关联的模型不存在' || error.message === '关联的分组不存在') {
            return resError(event, 400, error.message)
        }
        logger.error('更新节点失败：', error)
        return resError(event, 500, '更新节点失败')
    }
})
