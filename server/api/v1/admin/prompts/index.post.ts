/**
 * 创建提示词
 *
 * POST /api/v1/admin/prompts
 *
 * 设计约束（防误用）：
 * - 版本号由 service 内部按 (name, type) 维度自动顺延（见 generateNextVersion），
 *   外部**不允许**传 version；前端误传任何值都会被忽略。
 * - 新建提示词 status 恒为 0（未生效）；如需"创建即激活"由调用方再调一次
 *   PUT /api/v1/admin/prompts/activate/:id（同 (name, type) 互斥事务确保唯一 active）。
 */

import { z } from 'zod'
import { PROMPT_TYPES } from '#shared/types/node'
import { createPromptService } from '~~/server/services/node/prompt.service'
import { logPromptCreate } from '~~/server/services/rbac/auditLog.service'

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
})

export default defineEventHandler(async (event) => {
    const operatorId = event.context.auth?.user?.id
    if (!operatorId) {
        return resError(event, 401, '请先登录')
    }

    const result = await readValidatedBody(event, (payload) => bodySchema.safeParse(payload))
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0]!.message)
    }
    const body = result.data

    try {
        const created = await createPromptService({
            name: body.name,
            title: body.title ?? null,
            content: body.content,
            variables: body.variables,
            type: body.type,
            nodeId: 0, // CreatePromptInput 类型签名遗留字段，service / DAO 内部已不再写入 DB
        })

        await logPromptCreate(event, operatorId, created.id, {
            name: created.name,
            type: created.type,
            version: created.version,
        })

        return resSuccess(event, '创建提示词成功', created)
    } catch (error) {
        logger.error('创建提示词失败：', error)
        return resError(event, 500, '创建提示词失败')
    }
})
