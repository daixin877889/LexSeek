/**
 * 管理端：批量更新节点 ↔ 提示词关联
 *
 * PATCH /api/v1/admin/nodes/:id/prompts
 *
 * 请求体：{ prompts: Array<{ promptId: number; displayOrder: number }> }
 *
 * 一锅端语义：以请求体为目标态，对 node_prompts 表做 diff 并在事务内同步
 *  - addedIds：当前未挂载、目标态有 → CREATE
 *  - removedIds：当前已挂载、目标态没有 → DELETE
 *  - reorderedIds：promptId 已挂载但 displayOrder 变化 → UPDATE displayOrder
 *
 * 完成后：写审计日志（logNodePromptLink）+ 失效 NodeConfig 缓存（按 nodeName）
 *
 * 鉴权：依赖 server/middleware/03.permission.ts RBAC 拦截
 *
 * @see docs/superpowers/plans/2026-05-06-prompts-multi-node-and-anti-jailbreak.md Phase 5
 */

import { z } from 'zod'
import { prisma } from '~~/server/utils/db'
import { logNodePromptLink } from '~~/server/services/rbac/auditLog.service'
import { invalidateNodeConfigCache } from '~~/server/services/agent-platform/nodeConfig/loader'

const paramsSchema = z.object({
    id: z.coerce.number().int().positive('节点 ID 必须是正整数'),
})

const bodySchema = z
    .object({
        prompts: z.array(
            z.object({
                promptId: z.number().int().positive('promptId 必须是正整数'),
                displayOrder: z.number().int().default(100),
            }),
        ),
    })
    .refine(
        (v) => new Set(v.prompts.map((p) => p.promptId)).size === v.prompts.length,
        { message: '同一 prompt 不能被重复添加' },
    )

export default defineEventHandler(async (event) => {
    const operatorId = event.context.auth?.user?.id
    if (!operatorId) {
        return resError(event, 401, '请先登录')
    }

    const rawId = getRouterParam(event, 'id')
    const paramsResult = paramsSchema.safeParse({ id: rawId })
    if (!paramsResult.success) {
        return resError(event, 400, '参数错误：' + paramsResult.error.issues[0]!.message)
    }
    const nodeId = paramsResult.data.id

    const bodyResult = await readValidatedBody(event, (payload) => bodySchema.safeParse(payload))
    if (!bodyResult.success) {
        return resError(event, 400, '参数错误：' + bodyResult.error.issues[0]!.message)
    }
    const desired = bodyResult.data.prompts

    // 取节点 name —— invalidateNodeConfigCache 接节点名而非 nodeId
    const node = await prisma.nodes.findUnique({
        where: { id: nodeId },
        select: { name: true },
    })
    if (!node) {
        return resError(event, 404, '节点不存在')
    }

    // 算 diff
    const current = await prisma.node_prompts.findMany({
        where: { nodeId },
        select: { promptId: true, displayOrder: true },
    })
    const currentMap = new Map(current.map((c) => [c.promptId, c.displayOrder]))
    const desiredMap = new Map(desired.map((d) => [d.promptId, d.displayOrder]))

    const addedIds: number[] = []
    const removedIds: number[] = []
    const reorderedIds: number[] = []

    for (const d of desired) {
        if (!currentMap.has(d.promptId)) {
            addedIds.push(d.promptId)
        } else if (currentMap.get(d.promptId) !== d.displayOrder) {
            reorderedIds.push(d.promptId)
        }
    }
    for (const c of current) {
        if (!desiredMap.has(c.promptId)) {
            removedIds.push(c.promptId)
        }
    }

    try {
        await prisma.$transaction(async (tx) => {
            if (removedIds.length > 0) {
                await tx.node_prompts.deleteMany({
                    where: { nodeId, promptId: { in: removedIds } },
                })
            }
            for (const id of addedIds) {
                await tx.node_prompts.create({
                    data: { nodeId, promptId: id, displayOrder: desiredMap.get(id)! },
                })
            }
            for (const id of reorderedIds) {
                await tx.node_prompts.update({
                    where: { nodeId_promptId: { nodeId, promptId: id } },
                    data: { displayOrder: desiredMap.get(id)! },
                })
            }
        })

        await logNodePromptLink(event, operatorId, nodeId, { addedIds, removedIds, reorderedIds })
        invalidateNodeConfigCache(node.name)

        logger.info(
            `[admin/nodes/prompts] 节点 ${node.name}(id=${nodeId}) 关联变更：+${addedIds.length} -${removedIds.length} ↕${reorderedIds.length}`,
        )

        return resSuccess(event, '已保存', {
            added: addedIds.length,
            removed: removedIds.length,
            reordered: reorderedIds.length,
        })
    } catch (error: any) {
        // 外键约束：promptId 不存在（仅识别 node_prompts 表的违例，不要把审计日志等其它 FK 误判）
        const fkConstraint = error?.meta?.driverAdapterError?.cause?.constraint?.index ?? ''
        if (
            error.code === 'P2003' &&
            (fkConstraint.startsWith('node_prompts_') || error?.meta?.modelName === 'node_prompts')
        ) {
            return resError(event, 400, '提示词不存在，请检查 promptId')
        }
        logger.error('[admin/nodes/prompts] 更新节点提示词关联失败：', error)
        return resError(event, 500, '更新节点提示词关联失败')
    }
})
