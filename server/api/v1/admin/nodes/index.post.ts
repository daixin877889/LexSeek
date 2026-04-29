/**
 * 创建节点
 *
 * POST /api/v1/admin/nodes
 * Requirements: 15.2
 */

import { z } from 'zod'
import { NODE_TYPES } from '#shared/types/node'
import { createNodeService } from '~~/server/services/node/node.service'

/** 请求体验证 */
const bodySchema = z.object({
    name: z.string({ error: '节点名称不能为空' })
        .min(1, '节点名称不能为空')
        .max(100, '节点名称不能超过100个字符'),
    title: z.string()
        .max(100, '节点标题不能超过100个字符')
        .optional()
        .nullable(),
    description: z.string()
        .max(255, '节点描述不能超过255个字符')
        .optional()
        .nullable(),
    type: z.enum(NODE_TYPES, {
        error: `节点类型必须是 ${NODE_TYPES.join('、')}`,
    }),
    priority: z.number()
        .int('优先级必须是整数')
        .min(1, '优先级最小为1')
        .default(100),
    modelId: z.number({ error: '模型ID不能为空' })
        .int('模型ID必须是整数')
        .positive('模型ID必须是正整数'),
    tools: z.array(z.string()).optional().default([]),
    groupId: z.number()
        .int('分组ID必须是整数')
        .positive('分组ID必须是正整数')
        .optional()
        .nullable(),
    status: z.number()
        .int('状态必须是整数')
        .min(0, '状态值无效')
        .max(1, '状态值无效')
        .default(1),
    outputSchema: z.record(z.string(), z.any()).optional().nullable(),
    thinkingEnabled: z.boolean()
        .optional()
        .default(false),
})

export default defineEventHandler(async (event) => {
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0]!!.message)
    }

    try {
        const node = await createNodeService(result.data)
        return resSuccess(event, '创建节点成功', node)
    } catch (error: any) {
        // 处理业务逻辑错误
        if (error.message === '节点名称已存在') {
            return resError(event, 409, error.message)
        }
        if (error.message === '关联的模型不存在' || error.message === '关联的分组不存在') {
            return resError(event, 400, error.message)
        }
        logger.error('创建节点失败：', error)
        return resError(event, 500, '创建节点失败')
    }
})
