/**
 * 管理端：更新单个 skill 的启停状态
 *
 * PATCH /api/v1/admin/skills/status/:name
 * Body: { status: 0 | 1 }
 *
 * 启用前会校验 skill 目录与 SKILL.md 是否存在，缺失则拒绝启用并给中文提示。
 * 禁用永远允许。成功后失效 NodeConfig + FilesystemBackend 缓存。
 *
 * 鉴权：由 server/middleware/03.permission.ts 按 RBAC 权限表细粒度判定
 *      （任意被授予该 API 权限的管理类角色均可访问）。
 */

import { z } from 'zod'
import {
    setSkillStatusService,
    SkillFsMissingError,
} from '~~/server/services/agent-platform/skills/skillSync.service'
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
        const skill = await setSkillStatusService(name, result.data.status as SkillStatus)
        return resSuccess(event, result.data.status === 1 ? '已启用' : '已禁用', skill)
    } catch (err: any) {
        if (err instanceof SkillFsMissingError) {
            return resError(event, 400, err.message)
        }
        if (err?.code === 'P2025') {
            return resError(event, 404, `skill "${name}" 不存在`)
        }
        logger.error('[admin/skills/status] 更新失败', err)
        return resError(event, 500, '更新 skill 状态失败')
    }
})
