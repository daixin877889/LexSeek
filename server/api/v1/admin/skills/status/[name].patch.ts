/**
 * 管理端：更新单个 skill 的启停状态
 *
 * PATCH /api/v1/admin/skills/status/:name
 * Body: { status: 0 | 1 }
 *
 * 成功后同时失效 NodeConfig 缓存和 FilesystemBackend 缓存，
 * 保证下次 createAgent 时使用最新配置。
 *
 * 鉴权：由 server/middleware/03.permission.ts 按 RBAC 权限表细粒度判定
 *      （任意被授予该 API 权限的管理类角色均可访问）。
 */

import { z } from 'zod'
import { updateSkillStatusDAO } from '~~/server/services/agent-platform/skills/skillSync.dao'
import { invalidateNodeConfigCache } from '~~/server/services/agent-platform/nodeConfig/loader'
import { invalidateBackendCache } from '~~/server/services/agent-platform/skills/filesystemBackendCache'
import { SkillStatus } from '#shared/types/skill'

const bodySchema = z.object({
    status: z.union([z.literal(0), z.literal(1)], {
        error: 'status 必须为 0（禁用）或 1（启用）',
    }),
})

export default defineEventHandler(async (event) => {
    const name = getRouterParam(event, 'name')
    if (!name) {
        return resError(event, 400, '缺少参数 name')
    }

    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0]!.message)
    }

    try {
        const skill = await updateSkillStatusDAO(name, result.data.status as SkillStatus)

        // 失效缓存，确保节点配置与 backend 使用最新状态
        invalidateNodeConfigCache()
        invalidateBackendCache()

        return resSuccess(event, result.data.status === 1 ? '已启用' : '已禁用', skill)
    } catch (err: any) {
        // Prisma P2025: 记录不存在
        if (err?.code === 'P2025') {
            return resError(event, 404, `skill "${name}" 不存在`)
        }
        logger.error('[admin/skills/status] 更新失败', err)
        return resError(event, 500, '更新 skill 状态失败')
    }
})
