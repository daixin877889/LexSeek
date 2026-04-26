/**
 * 管理端：手动触发 skill 重新扫描
 *
 * 适用场景：运维更新了 .deepagents/skills/ 下的内容（增/减/改），
 * 不希望重启服务即可让数据库元数据同步。
 *
 * 鉴权：依赖 server/middleware/03.permission.ts 的 super_admin 拦截
 *      （非 super_admin 访问 /api/v1/admin/** 直接 403）。
 *
 * 响应：成功返回 ScanResult；失败返回 500 + 错误信息。
 *
 * @see docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md §3.5.7
 */

import { scanAndSyncSkillsService } from '~~/server/services/agent-platform/skills/skillSync.service'

export default defineEventHandler(async (event) => {
    try {
        const result = await scanAndSyncSkillsService()
        logger.info('[admin/skills/resync] 手动触发扫描完成', {
            scanned: result.scanned.length,
            added: result.added.length,
            updated: result.updated.length,
            disabled: result.disabled.length,
            errors: result.errors.length,
        })
        return resSuccess(event, '扫描完成', result)
    } catch (err) {
        logger.error('[admin/skills/resync] 扫描失败', err)
        return resError(event, 500, `扫描失败：${(err as Error).message}`)
    }
})
