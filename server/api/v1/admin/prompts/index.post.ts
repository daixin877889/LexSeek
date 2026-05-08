/**
 * 创建提示词
 *
 * POST /api/v1/admin/prompts
 * Requirements: 15.6
 */

import { z } from 'zod'
import { PROMPT_TYPES } from '#shared/types/node'
import { createPromptService } from '~~/server/services/node/prompt.service'

/** 请求体验证 */
const bodySchema = z.object({
    name: z.string({ message: '提示词名称不能为空' })
        .min(1, '提示词名称不能为空')
        .max(100, '提示词名称不能超过100个字符'),
    title: z.string()
        .max(100, '提示词标题不能超过100个字符')
        .optional()
        .nullable(),
    content: z.string({ message: '提示词内容不能为空' })
        .min(1, '提示词内容不能为空'),
    variables: z.array(z.string()).optional(),
    type: z.enum(PROMPT_TYPES, {
        message: `提示词类型必须是 ${PROMPT_TYPES.join('、')}`,
    }),
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

    try {
        const prompt = await createPromptService(result.data)
        return resSuccess(event, '创建提示词成功', prompt)
    } catch (error: any) {
        // 处理业务逻辑错误
        if (error.message === '关联的节点不存在') {
            return resError(event, 400, error.message)
        }
        logger.error('创建提示词失败：', error)
        return resError(event, 500, '创建提示词失败')
    }
})
