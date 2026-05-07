/**
 * 一次性数据迁移（已废弃）：把 prompts.nodeId 单值关系搬到 node_prompts 多对多表。
 *
 * Phase 6 改造后 prompts.nodeId 字段已从 schema 中删除，本脚本失去执行依据，
 * 仅保留为占位以避免引入端的导入断裂；运行时打印日志后即返回。
 *
 * 历史用法：npx tsx server/scripts/migrateNodePrompts.ts
 */

import { logger } from '#shared/utils/logger'

/**
 * 已废弃：prompts.nodeId 字段已删，节点关联现统一通过 node_prompts 表维护。
 * 留作占位避免历史引用断裂；执行时打印警告并立即返回。
 */
export async function migrateNodePrompts(): Promise<void> {
    logger.warn(
        '[migrateNodePrompts] 脚本已废弃：prompts.nodeId 字段已删除，' +
        '节点提示词关联现统一通过 node_prompts 表维护。无需执行。',
    )
}

if (import.meta.url === `file://${process.argv[1]}`) {
    migrateNodePrompts()
        .then(() => process.exit(0))
        .catch((err) => {
            logger.error('[migrateNodePrompts] 异常', { err })
            process.exit(1)
        })
}
