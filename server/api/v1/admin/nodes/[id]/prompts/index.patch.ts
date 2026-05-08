/**
 * 管理端：批量更新节点 ↔ 提示词关联
 *
 * PATCH /api/v1/admin/nodes/:id/prompts
 *
 * 请求体：{ prompts: Array<{ promptId: number; displayOrder: number }> }
 *
 * 阶段 F 改造：节点关联键由具体 promptId 改为业务身份 (name, type)。
 * body 仍接 promptId（前端选的是某个具体版本），后端解析出 (name, type) 后写入。
 * 这样新版本激活后，节点会自动跟随，无需"搬运"链接。
 *
 * 一锅端语义：以请求体为目标态，对 node_prompts 表做 diff 并在事务内同步
 *  - 添加：当前未挂载该 (name, type) 的目标 → CREATE
 *  - 删除：当前已挂载、目标态没有的 (name, type) → DELETE
 *  - 重排：(name, type) 已挂载但 displayOrder 变化 → UPDATE displayOrder
 *
 * 完成后：写审计日志（logNodePromptLink）+ 失效 NodeConfig 缓存（按 nodeName）
 *
 * 鉴权：依赖 server/middleware/03.permission.ts RBAC 拦截
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

    // 解析 desired 里的每个 promptId → (name, type) 业务身份
    const desiredPromptIds = desired.map(d => d.promptId)
    const promptRows = desiredPromptIds.length > 0
        ? await prisma.prompts.findMany({
            where: { id: { in: desiredPromptIds }, deletedAt: null },
            select: { id: true, name: true, type: true },
        })
        : []
    const idToIdentity = new Map(promptRows.map(p => [p.id, { name: p.name, type: p.type }]))
    // 检查是否有 promptId 找不到对应 prompt（说明前端传了不存在的或已删除的版本）
    const missingPromptIds = desiredPromptIds.filter(id => !idToIdentity.has(id))
    if (missingPromptIds.length > 0) {
        return resError(event, 400, `提示词不存在或已删除：promptId ${missingPromptIds.join(', ')}`)
    }
    // 检查 (name, type) 在 desired 内是否唯一（防止同一身份的不同版本被同时挂载）
    const desiredKeys = desired.map(d => {
        const identity = idToIdentity.get(d.promptId)!
        return { key: `${identity.name}::${identity.type}`, identity, displayOrder: d.displayOrder }
    })
    const seenKeys = new Set<string>()
    for (const dk of desiredKeys) {
        if (seenKeys.has(dk.key)) {
            return resError(event, 400, `同一业务身份的提示词不能被重复挂载：${dk.identity.name}/${dk.identity.type}`)
        }
        seenKeys.add(dk.key)
    }

    // 算 diff（基于 (nodeId, promptName, promptType) 三元组）
    const current = await prisma.node_prompts.findMany({
        where: { nodeId },
        select: { promptName: true, promptType: true, displayOrder: true },
    })
    const currentMap = new Map(
        current.map(c => [`${c.promptName}::${c.promptType}`, { name: c.promptName, type: c.promptType, displayOrder: c.displayOrder }]),
    )
    const desiredMap = new Map(
        desiredKeys.map(dk => [dk.key, { name: dk.identity.name, type: dk.identity.type, displayOrder: dk.displayOrder }]),
    )

    const added: { name: string; type: string; displayOrder: number }[] = []
    const removed: { name: string; type: string }[] = []
    const reordered: { name: string; type: string; displayOrder: number }[] = []

    for (const [key, d] of desiredMap) {
        const c = currentMap.get(key)
        if (!c) added.push(d)
        else if (c.displayOrder !== d.displayOrder) reordered.push(d)
    }
    for (const [key, c] of currentMap) {
        if (!desiredMap.has(key)) removed.push({ name: c.name, type: c.type })
    }

    try {
        await prisma.$transaction(async (tx) => {
            if (removed.length > 0) {
                await tx.node_prompts.deleteMany({
                    where: {
                        nodeId,
                        OR: removed.map(r => ({ promptName: r.name, promptType: r.type })),
                    },
                })
            }
            for (const a of added) {
                await tx.node_prompts.create({
                    data: { nodeId, promptName: a.name, promptType: a.type, displayOrder: a.displayOrder },
                })
            }
            for (const r of reordered) {
                await tx.node_prompts.update({
                    where: {
                        nodeId_promptName_promptType: {
                            nodeId,
                            promptName: r.name,
                            promptType: r.type,
                        },
                    },
                    data: { displayOrder: r.displayOrder },
                })
            }
        })

        await logNodePromptLink(event, operatorId, nodeId, { added, removed, reordered })
        invalidateNodeConfigCache(node.name)

        logger.info(
            `[admin/nodes/prompts] 节点 ${node.name}(id=${nodeId}) 关联变更：+${added.length} -${removed.length} ↕${reordered.length}`,
        )

        return resSuccess(event, '已保存', {
            added: added.length,
            removed: removed.length,
            reordered: reordered.length,
        })
    } catch (error: any) {
        logger.error('[admin/nodes/prompts] 更新节点提示词关联失败：', error)
        return resError(event, 500, '更新节点提示词关联失败')
    }
})
