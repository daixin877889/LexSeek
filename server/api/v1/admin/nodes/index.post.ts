/**
 * 创建节点
 *
 * POST /api/v1/admin/nodes
 *
 * 阶段 G：支持事务化一次创建节点 + 关联提示词
 *  - body 可选 prompts 数组（每项 { promptId, displayOrder? }）
 *  - 在同一个 prisma 事务内创建节点 + 写 node_prompts 关联
 *  - 任一环节失败整体回滚（节点不创建、关联不写入）
 *  - 关联键按 阶段 F 约定写 (promptName, promptType) 业务身份
 *
 * Requirements: 15.2
 */

import { z } from 'zod'
import { NODE_TYPES } from '#shared/types/node'
import { prisma } from '~~/server/utils/db'
import { createNodeService } from '~~/server/services/node/node.service'
import { logNodePromptLink } from '~~/server/services/rbac/auditLog.service'
import { invalidateNodeConfigCache } from '~~/server/services/agent-platform/nodeConfig/loader'

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
    /**
     * 阶段 G：可选关联提示词列表
     *  - 每项指定一个 prompt 版本（promptId）和 displayOrder
     *  - 后端按业务身份 (name, type) 写 node_prompts，与 PATCH /admin/nodes/:id/prompts 保持一致
     */
    prompts: z
        .array(
            z.object({
                promptId: z.number().int().positive('promptId 必须是正整数'),
                displayOrder: z.number().int().default(100),
            }),
        )
        .optional()
        .refine(
            (arr) => !arr || new Set(arr.map((p) => p.promptId)).size === arr.length,
            { message: '同一 prompt 不能被重复添加' },
        ),
})

export default defineEventHandler(async (event) => {
    const operatorId = event.context.auth?.user?.id
    if (!operatorId) {
        return resError(event, 401, '请先登录')
    }

    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0]!.message)
    }

    const { prompts: promptsInput, ...nodeData } = result.data

    try {
        const txResult = await prisma.$transaction(async (tx) => {
            // 1. 创建节点本体（与原有 createNodeService 行为一致）
            const node = await createNodeService(nodeData, tx)

            // 2. 处理可选的关联提示词
            let added: { name: string; type: string; displayOrder: number }[] = []
            if (promptsInput && promptsInput.length > 0) {
                const promptIds = promptsInput.map((p) => p.promptId)
                const promptRows = await tx.prompts.findMany({
                    where: { id: { in: promptIds }, deletedAt: null },
                    select: { id: true, name: true, type: true, status: true },
                })
                const idToRow = new Map(promptRows.map((p) => [p.id, p]))

                // 校验：所有 promptId 必须存在
                const missing = promptIds.filter((id) => !idToRow.has(id))
                if (missing.length > 0) {
                    throw new Error(`提示词不存在或已删除：promptId ${missing.join(', ')}`)
                }
                // 校验：所选 prompt 必须激活（status=1），否则节点上线即失活
                const inactive = promptRows.filter((p) => p.status !== 1)
                if (inactive.length > 0) {
                    throw new Error(
                        `所选提示词必须为激活状态（status=1），当前未激活：${inactive
                            .map((p) => `${p.name}/${p.type}`)
                            .join(', ')}`,
                    )
                }
                // 校验：(name, type) 在 desired 内必须唯一
                const desiredKeys = promptsInput.map((p) => {
                    const row = idToRow.get(p.promptId)!
                    return { key: `${row.name}::${row.type}`, name: row.name, type: row.type, displayOrder: p.displayOrder }
                })
                const seen = new Set<string>()
                for (const dk of desiredKeys) {
                    if (seen.has(dk.key)) {
                        throw new Error(`同一业务身份的提示词不能被重复挂载：${dk.name}/${dk.type}`)
                    }
                    seen.add(dk.key)
                }

                // 写 node_prompts —— createMany 一次性插入即可
                await tx.node_prompts.createMany({
                    data: desiredKeys.map((dk) => ({
                        nodeId: node.id,
                        promptName: dk.name,
                        promptType: dk.type,
                        displayOrder: dk.displayOrder,
                    })),
                })

                added = desiredKeys.map((dk) => ({ name: dk.name, type: dk.type, displayOrder: dk.displayOrder }))

                // 审计日志（创建关联）— 走同事务确保失败一起回滚
                await logNodePromptLink(event, operatorId, node.id, { added, removed: [], reordered: [] }, tx)
            }

            return { node, addedCount: added.length }
        })

        // 事务成功后失效该节点的 NodeConfig 缓存（首创理论上无缓存，但保持与 PATCH 一致）
        invalidateNodeConfigCache(txResult.node.name)

        logger.info(
            `[admin/nodes] 创建节点 ${txResult.node.name}(id=${txResult.node.id}) 成功，关联提示词 ${txResult.addedCount} 条`,
        )

        return resSuccess(event, '创建节点成功', {
            ...txResult.node,
            attachedPromptCount: txResult.addedCount,
        })
    } catch (error: any) {
        // 业务校验错误（事务内 throw 的 Error）
        if (error?.message === '节点名称已存在') {
            return resError(event, 409, error.message)
        }
        if (error?.message === '关联的模型不存在' || error?.message === '关联的分组不存在') {
            return resError(event, 400, error.message)
        }
        if (typeof error?.message === 'string' && error.message.startsWith('提示词不存在或已删除')) {
            return resError(event, 400, error.message)
        }
        if (typeof error?.message === 'string' && error.message.startsWith('所选提示词必须为激活状态')) {
            return resError(event, 400, error.message)
        }
        if (typeof error?.message === 'string' && error.message.startsWith('同一业务身份的提示词不能被重复挂载')) {
            return resError(event, 400, error.message)
        }
        logger.error('创建节点失败：', error)
        return resError(event, 500, '创建节点失败')
    }
})
