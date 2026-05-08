/**
 * 一次性数据迁移：把 node_prompts 的关联从 promptId（具体版本号）改为业务身份 (promptName, promptType)。
 *
 * 阶段 F 架构改造的中间步骤：
 *  1. 第一步迁移已添加 promptName / promptType 可空字段（保留 promptId）
 *  2. 本脚本读取每条 node_prompts 的 promptId → 查 prompts 拿 (name, type) → 写回
 *  3. 第二步迁移再删除 promptId 并把新字段改 NOT NULL
 *
 * 用法：npx tsx -r dotenv/config server/scripts/migrateNodePromptsToLogical.ts dotenv_config_path=.env
 *
 * 幂等：跳过已填充 promptName + promptType 的记录。
 */

import { prisma } from '~~/server/utils/db'
import { logger } from '#shared/utils/logger'

export async function migrateNodePromptsToLogical(): Promise<void> {
    // 在中间过渡 schema 下（promptId 仍存在但可空 + promptName/promptType 也可空），
    // 用 prisma 客户端读所有 node_prompts；不存在 promptId 字段的环境（已完成第二步迁移）
    // 用 raw SQL 兜底回退，避免类型错误。
    const rows = await prisma.$queryRawUnsafe<
        { id: number; node_id: number; prompt_id: number | null; prompt_name: string | null; prompt_type: string | null }[]
    >(
        `SELECT id, node_id, prompt_id, prompt_name, prompt_type FROM node_prompts`,
    )

    logger.info(`[migrateNodePromptsToLogical] 待检查 node_prompts: ${rows.length} 条`)
    let updated = 0
    let skipped = 0
    let orphaned = 0

    for (const row of rows) {
        if (row.prompt_name && row.prompt_type) {
            skipped++
            continue
        }
        if (row.prompt_id == null) {
            logger.warn(`[migrateNodePromptsToLogical] link #${row.id} 的 prompt_id 为 NULL，无法回填业务身份，跳过`)
            orphaned++
            continue
        }
        const prompt = await prisma.prompts.findUnique({
            where: { id: row.prompt_id },
            select: { name: true, type: true },
        })
        if (!prompt) {
            logger.warn(`[migrateNodePromptsToLogical] prompt #${row.prompt_id} 不存在，无法回填 link #${row.id}`)
            orphaned++
            continue
        }
        await prisma.$executeRawUnsafe(
            `UPDATE node_prompts SET prompt_name = $1, prompt_type = $2 WHERE id = $3`,
            prompt.name,
            prompt.type,
            row.id,
        )
        updated++
    }

    logger.info(
        `[migrateNodePromptsToLogical] 字段回填完成：更新 ${updated} 条，跳过 ${skipped} 条（已填充），孤儿 ${orphaned} 条（prompt_id 缺失或指向不存在的 prompt）`,
    )

    // 第二步：去重 (nodeId, promptName, promptType) 的多余链接
    // 一个节点同时挂载同 (name, type) 多个具体版本（因 prompts.id 不同），在阶段 F 改造后会变成
    // 业务身份重复 → 第二步迁移加唯一约束会失败。规则：保留最小 id 的那条，删除其余。
    const dupes = await prisma.$queryRawUnsafe<
        { node_id: number; prompt_name: string; prompt_type: string; ids: number[] }[]
    >(
        `SELECT node_id, prompt_name, prompt_type, ARRAY_AGG(id ORDER BY id) AS ids
         FROM node_prompts
         WHERE prompt_name IS NOT NULL AND prompt_type IS NOT NULL
         GROUP BY node_id, prompt_name, prompt_type
         HAVING COUNT(*) > 1`,
    )
    let removedDupes = 0
    for (const dupe of dupes) {
        const [keep, ...drop] = dupe.ids
        if (drop.length === 0) continue
        logger.warn(
            `[migrateNodePromptsToLogical] 检测到重复链接：node ${dupe.node_id} (${dupe.prompt_name}, ${dupe.prompt_type})；保留 link #${keep}，删除 ${drop.join(', ')}`,
        )
        await prisma.$executeRawUnsafe(
            `DELETE FROM node_prompts WHERE id IN (${drop.join(', ')})`,
        )
        removedDupes += drop.length
    }
    logger.info(
        `[migrateNodePromptsToLogical] 去重完成：删除 ${removedDupes} 条多余链接（共 ${dupes.length} 个 (nodeId, name, type) 三元组冲突）`,
    )
}

if (import.meta.url === `file://${process.argv[1]}`) {
    migrateNodePromptsToLogical()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error('[migrateNodePromptsToLogical] 异常', err)
            process.exit(1)
        })
}
