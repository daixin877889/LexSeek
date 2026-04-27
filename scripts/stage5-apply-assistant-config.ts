/**
 * 阶段 5 一次性数据更新脚本：法律助手节点配置同步
 *
 * 两件事：
 *  1. 把 assistantMain (id=15) 的 tools 列升级为 ["search_law", "draft_document", "review_contract"]
 *  2. 给 assistantMain 关联 6 个 skill：docx / pptx / evidence-defense / litigation-visualization / minimax-pdf / minimax-xlsx
 *
 * 用法：
 *   bun run scripts/stage5-apply-assistant-config.ts
 *   DATABASE_URL='postgresql://daixin:daixin88@localhost:5432/ls_new_testing?schema=public&TimeZone=UTC' bun run scripts/stage5-apply-assistant-config.ts
 *
 * 幂等：
 *  - tools 列若已含目标 3 个工具则跳过
 *  - node_skills 复合主键保护重复 insert
 */

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '~~/generated/prisma/client'

const TARGET_TOOLS = ['search_law', 'draft_document', 'review_contract'] as const
const TARGET_SKILLS = [
    'docx',
    'pptx',
    'evidence-defense',
    'litigation-visualization',
    'minimax-pdf',
    'minimax-xlsx',
] as const

const pool = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
    options: '-c TimeZone=UTC',
})
const prisma = new PrismaClient({ adapter: pool })

async function main(): Promise<void> {
    console.log('===== 阶段 5 · 法律助手节点配置同步开始 =====')
    console.log(`[env] DATABASE_URL=${process.env.DATABASE_URL?.replace(/:[^@]+@/, ':***@')}`)

    const node = await prisma.nodes.findUnique({ where: { name: 'assistantMain' } })
    if (!node) {
        console.warn('[skip] 节点 assistantMain 不存在（DB 未 seed？）')
        return
    }

    // 1. tools 列升级（幂等）
    const currentTools = (node.tools ?? []) as string[]
    const missingTools = TARGET_TOOLS.filter(t => !currentTools.includes(t))
    if (missingTools.length === 0) {
        console.log(`[noop] assistantMain.tools 已包含目标 3 个工具：${currentTools.join(', ')}`)
    } else {
        const merged = [...new Set([...currentTools, ...TARGET_TOOLS])]
        await prisma.nodes.update({
            where: { id: node.id },
            data: { tools: merged, updatedAt: new Date() },
        })
        console.log(`[ok] assistantMain.tools 升级：${currentTools.join(', ')} → ${merged.join(', ')}`)
    }

    // 2. 6 个 skill 关联（幂等，复合主键 [nodeId, skillName] 保护）
    let createdCount = 0
    let skippedCount = 0
    for (const skillName of TARGET_SKILLS) {
        const skill = await prisma.skills.findUnique({ where: { name: skillName } })
        if (!skill) {
            console.warn(`[skip] skill "${skillName}" 不存在（先跑 POST /api/v1/admin/skills/resync 同步 .deepagents/skills/${skillName}/）`)
            continue
        }

        const existing = await prisma.node_skills.findUnique({
            where: { nodeId_skillName: { nodeId: node.id, skillName } },
        })
        if (existing) {
            skippedCount += 1
            continue
        }

        await prisma.node_skills.create({
            data: { nodeId: node.id, skillName, priority: 100 },
        })
        createdCount += 1
        console.log(`[ok] 创建关联：assistantMain (id=${node.id}) ↔ ${skillName} (priority=100)`)
    }

    console.log(`===== 阶段 5 · 同步完成（新增 ${createdCount} 条 / 跳过已存在 ${skippedCount} 条）=====`)
}

main()
    .catch((err) => {
        console.error('阶段 5 同步脚本失败：', err)
        process.exit(1)
    })
    .finally(() => prisma.$disconnect())
