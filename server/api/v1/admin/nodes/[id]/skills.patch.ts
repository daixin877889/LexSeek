/**
 * 管理端：更新节点关联的 Skills
 *
 * PATCH /api/v1/admin/nodes/:id/skills
 *
 * 请求体 { skills: Array<{ skillName: string, priority?: number }> }
 * 事务内 deleteMany + createMany 替换全量关联，完成后失效 NodeConfig 缓存和 backend 缓存。
 *
 * 鉴权：依赖 server/middleware/03.permission.ts 的 super_admin 拦截
 *
 * @see docs/superpowers/plans/2026-04-26-ai-unify-stage-2-factory-and-vertical.md Task 20
 */

import { z } from 'zod'
import { getNodeByIdService } from '~~/server/services/node/node.service'
import { invalidateNodeConfigCache } from '~~/server/services/agent-platform/nodeConfig/loader'
import { invalidateBackendCache } from '~~/server/services/agent-platform/skills/filesystemBackendCache'

const paramsSchema = z.object({
    id: z.coerce.number().int().positive('节点 ID 必须是正整数'),
})

const bodySchema = z.object({
    skills: z.array(
        z.object({
            skillName: z.string().min(1, 'skillName 不能为空'),
            priority: z.number().int().optional(),
        }),
    ),
})

export default defineEventHandler(async (event) => {
    // 验证路由参数
    const rawId = getRouterParam(event, 'id')
    const paramsResult = paramsSchema.safeParse({ id: rawId })
    if (!paramsResult.success) {
        return resError(event, 400, '参数错误：' + paramsResult.error.issues[0]!.message)
    }
    const nodeId = paramsResult.data.id

    // 验证请求体
    const body = await readBody(event)
    const bodyResult = bodySchema.safeParse(body)
    if (!bodyResult.success) {
        return resError(event, 400, '参数错误：' + bodyResult.error.issues[0]!.message)
    }
    const { skills } = bodyResult.data

    // 确认节点存在
    const node = await getNodeByIdService(nodeId)
    if (!node) {
        return resError(event, 404, '节点不存在')
    }

    try {
        // 事务内替换关联：先清空旧关联，再批量写入新关联
        await prisma.$transaction(async (tx) => {
            await tx.node_skills.deleteMany({ where: { nodeId } })
            if (skills.length > 0) {
                await tx.node_skills.createMany({
                    data: skills.map(s => ({
                        nodeId,
                        skillName: s.skillName,
                        priority: s.priority ?? 100,
                    })),
                })
            }
        })

        // 失效该节点的 NodeConfig 缓存 + FilesystemBackend 缓存
        invalidateNodeConfigCache(node.name)
        invalidateBackendCache()

        logger.info(`[admin/nodes/skills] 节点 ${node.name}(id=${nodeId}) 关联 skills 更新：${skills.length} 条`)
        return resSuccess(event, '更新节点 skills 关联成功', { nodeId, skills })
    } catch (error: any) {
        // 外键约束：skillName 不存在于 skills 表
        if (error.code === 'P2003' || error.message?.includes('Foreign key constraint')) {
            return resError(event, 400, 'Skill 不存在，请先同步 skills')
        }
        logger.error('[admin/nodes/skills] 更新节点 skills 关联失败：', error)
        return resError(event, 500, '更新节点 skills 关联失败')
    }
})
