/**
 * 用户端：获取启用 skill 的中文名映射表
 *
 * GET /api/v1/skills/labels
 *
 * 鉴权：登录态即可（不在 publicApiList，未登录由 02.auth 兜底返回 401）。
 *      该路由不在 admin/ 目录，不进 RBAC 细粒度授权流程。
 */

import { listEnabledSkillLabelsService } from '~~/server/services/agent-platform/skills/skillSync.service'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    try {
        const labels = await listEnabledSkillLabelsService()
        return resSuccess(event, '获取 skill 中文名映射成功', labels)
    } catch (err) {
        logger.error('[skills/labels] 获取失败', err)
        return resError(event, 500, '获取 skill 中文名映射失败')
    }
})
