/**
 * 创建提示词
 *
 * POST /api/v1/admin/prompts
 *
 * Phase 4 改造：
 * - 提示词与节点解耦（多对多关联表 node_prompts），创建时不再要求 nodeId
 * - 接入审计日志 logPromptCreate
 */

import { z } from 'zod'
import { PROMPT_TYPES } from '#shared/types/node'
import { logPromptCreate } from '~~/server/services/rbac/auditLog.service'
import { prisma } from '~~/server/utils/db'

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
    version: z.string({ message: '版本号不能为空' })
        .min(1, '版本号不能为空')
        .max(100, '版本号不能超过100个字符'),
    status: z.number().int().min(0).max(1).default(0),
})

/**
 * 从内容中提取 {{varName}} 形式的变量名
 */
const extractVariables = (content: string): string[] => {
    const regex = /\{\{(\w+)\}\}/g
    const variables: string[] = []
    let match
    while ((match = regex.exec(content)) !== null) {
        if (!variables.includes(match[1]!)) {
            variables.push(match[1]!)
        }
    }
    return variables
}

export default defineEventHandler(async (event) => {
    const operatorId = event.context.auth?.user?.id
    if (!operatorId) {
        return resError(event, 401, '请先登录')
    }

    // 项目惯例：readValidatedBody 用箭头函数包装 zod 调用
    const result = await readValidatedBody(event, (payload) => bodySchema.safeParse(payload))
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0]!.message)
    }
    const body = result.data

    try {
        const variables = body.variables ?? extractVariables(body.content)
        const created = await prisma.prompts.create({
            data: {
                name: body.name,
                title: body.title ?? null,
                content: body.content,
                variables,
                version: body.version,
                type: body.type,
                status: body.status,
                // ★ 不传 nodeId（schema 已 nullable，节点关联走 node_prompts 表）
            },
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
