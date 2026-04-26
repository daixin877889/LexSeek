/**
 * Skill Sync 启动钩子
 *
 * Nitro server 启动时扫描 .deepagents/skills/ 并入库。
 * 异常仅记录日志，不阻塞启动（按 §3.5.2 要求）。
 *
 * 此 plugin 加载顺序：默认按字母序，与 agent-worker.ts、cron-scheduler.ts 同级；
 * 若未来需要严格顺序，可改名加数字前缀。
 *
 * @see docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md §3.5.2
 */

import { scanAndSyncSkillsService } from '~~/server/services/agent-platform/skills/skillSync.service'

export default defineNitroPlugin(async () => {
    try {
        const result = await scanAndSyncSkillsService()
        logger.info('[skill-sync] 启动扫描完成', {
            scanned: result.scanned.length,
            added: result.added.length,
            updated: result.updated.length,
            disabled: result.disabled.length,
            errors: result.errors.length,
        })
        if (result.errors.length > 0) {
            logger.warn('[skill-sync] 启动扫描存在错误条目', { errors: result.errors })
        }
    } catch (err) {
        logger.error('[skill-sync] 启动扫描失败（不阻塞服务启动）', err)
    }
})
