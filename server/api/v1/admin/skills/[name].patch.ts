/**
 * 管理端：编辑 skill 的中文名（customTitle）
 *
 * PATCH /api/v1/admin/skills/:name
 * Body: { customTitle: string | null }   // 空字符串等价 null（恢复代码默认）
 *
 * 鉴权：由 server/middleware/03.permission.ts 按 RBAC 权限表细粒度判定
 *      （任意被授予该 API 权限的管理类角色均可访问）。
 */

import { z } from 'zod'
import { updateSkillCustomTitleService } from '~~/server/services/agent-platform/skills/skillSync.service'

const bodySchema = z.object({
    customTitle: z.union([
        z.string().max(200, 'customTitle 长度不能超过 200'),
        z.null(),
    ]),
})

export default defineEventHandler(async (event) => {
    const name = getRouterParam(event, 'name')
    if (!name) {
        return resError(event, 400, '缺少参数 name')
    }

    const body = await readBody(event)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
        return resError(event, 400, '参数错误：' + parsed.error.issues[0]!.message)
    }

    try {
        const skill = await updateSkillCustomTitleService(name, parsed.data.customTitle)
        return resSuccess(event, '中文名已更新', skill)
    } catch (err: any) {
        if (err?.code === 'P2025') {
            return resError(event, 404, `skill "${name}" 不存在`)
        }
        logger.error('[admin/skills/:name PATCH] 失败', err)
        return resError(event, 500, '更新中文名失败')
    }
})
