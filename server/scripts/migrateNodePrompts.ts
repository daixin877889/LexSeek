/**
 * 一次性数据迁移：把 prompts.nodeId 单值关系搬到 node_prompts 多对多表。
 *
 * 用法：npx tsx server/scripts/migrateNodePrompts.ts
 *
 * 幂等：先按 (nodeId, promptId) 查 node_prompts 是否已存在，存在则跳过。
 * 可重复执行；为后续 Phase 6 删除 prompts.nodeId 字段做准备。
 */

import { prisma } from '~~/server/utils/db'
import { logger } from '#shared/utils/logger'

const DEFAULT_DISPLAY_ORDER = 100

export async function migrateNodePrompts(): Promise<void> {
    const allPrompts = await prisma.prompts.findMany({
        select: { id: true, nodeId: true },
    })

    logger.info(`[migrateNodePrompts] 待迁移 prompts: ${allPrompts.length} 条`)

    let created = 0
    let skipped = 0

    for (const p of allPrompts) {
        if (p.nodeId == null) continue

        const existing = await prisma.node_prompts.findUnique({
            where: { nodeId_promptId: { nodeId: p.nodeId, promptId: p.id } },
        })
        if (existing) {
            skipped++
            continue
        }

        await prisma.node_prompts.create({
            data: {
                nodeId: p.nodeId,
                promptId: p.id,
                displayOrder: DEFAULT_DISPLAY_ORDER,
            },
        })
        created++
    }

    logger.info(`[migrateNodePrompts] 完成：新增 ${created} 条，跳过 ${skipped} 条（已存在）`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
    migrateNodePrompts()
        .then(() => process.exit(0))
        .catch((err) => {
            logger.error('[migrateNodePrompts] 迁移失败', { err })
            process.exit(1)
        })
}
