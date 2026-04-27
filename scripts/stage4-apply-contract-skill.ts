/**
 * 阶段 4 一次性数据更新脚本：合同审查节点关联 docx skill
 *
 * 用法：
 *   bun run scripts/stage4-apply-contract-skill.ts
 *   DATABASE_URL='postgresql://daixin:daixin88@localhost:5432/ls_new_testing?schema=public&TimeZone=UTC' bun run scripts/stage4-apply-contract-skill.ts
 *
 * 幂等：重复跑不会重复 insert（@@id([nodeId, skillName]) 复合主键保护）
 */

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '~~/generated/prisma/client'

const pool = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
    options: '-c TimeZone=UTC',
})
const prisma = new PrismaClient({ adapter: pool })

async function main(): Promise<void> {
    console.log('===== 阶段 4 · 合同审查 docx skill 关联开始 =====')
    console.log(`[env] DATABASE_URL=${process.env.DATABASE_URL?.replace(/:[^@]+@/, ':***@')}`)

    const node = await prisma.nodes.findUnique({ where: { name: 'contractReviewMain' } })
    if (!node) {
        console.warn('[skip] 节点 contractReviewMain 不存在（DB 未 seed？）')
        return
    }

    const skill = await prisma.skills.findUnique({ where: { name: 'docx' } })
    if (!skill) {
        console.warn('[skip] skill "docx" 不存在（先跑 POST /api/v1/admin/skills/resync 同步 .deepagents/skills/docx/）')
        return
    }

    const existing = await prisma.node_skills.findUnique({
        where: { nodeId_skillName: { nodeId: node.id, skillName: 'docx' } },
    })
    if (existing) {
        console.log(`[noop] contractReviewMain (id=${node.id}) ↔ docx 关联已存在 (priority=${existing.priority})`)
        return
    }

    await prisma.node_skills.create({
        data: { nodeId: node.id, skillName: 'docx', priority: 100 },
    })
    console.log(`[ok] 创建关联：contractReviewMain (id=${node.id}) ↔ docx (priority=100)`)
}

main()
    .catch((err) => {
        console.error('阶段 4 同步脚本失败：', err)
        process.exit(1)
    })
    .finally(() => prisma.$disconnect())
