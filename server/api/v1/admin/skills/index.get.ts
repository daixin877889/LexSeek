/**
 * 管理端：获取所有 skill 列表
 *
 * GET /api/v1/admin/skills
 * 返回全部 skill 记录（含 DISABLED），按 name 升序排列。
 *
 * 鉴权：依赖 server/middleware/03.permission.ts 的 super_admin 拦截
 *      （非 super_admin 访问 /api/v1/admin/** 直接 403）。
 */

import { listAllSkillsDAO } from '~~/server/services/agent-platform/skills/skillSync.dao'

export default defineEventHandler(async (event) => {
    try {
        const skills = await listAllSkillsDAO()
        return resSuccess(event, '获取 skill 列表成功', skills)
    } catch (err) {
        logger.error('[admin/skills] 获取列表失败', err)
        return resError(event, 500, '获取 skill 列表失败')
    }
})
