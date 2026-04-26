/**
 * 阶段 3 一次性数据更新脚本：把 search_law 工具配置应用到现有 DB。
 *
 * 用法：
 *   bun run scripts/stage3-apply-search-law.ts
 *   DATABASE_URL='postgresql://daixin:daixin88@localhost:5432/ls_new_testing?schema=public&TimeZone=UTC' bun run scripts/stage3-apply-search-law.ts
 *
 * 幂等：重复跑不会重复加 search_law；prompt 已含指令的不再追加。
 *
 * 触发的更新：
 *   1. nodes.tools 给 contractReviewMain 加 'search_law'（如果还没）
 *   2. 8 个 system prompt 末尾追加 search_law 工具使用指令（如果还没）
 *
 * 注意：本脚本只跑一次，跑完后将 search_law 配置纳入 seedData.sql 作为新建库的真理来源。
 */

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '~~/generated/prisma/client'

const pool = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
    options: '-c TimeZone=UTC',
})
const prisma = new PrismaClient({ adapter: pool })

const SEARCH_LAW_INSTRUCTION = `

## 法条引用（search_law 工具）

本节点已挂载 \`search_law\` 工具。当用户询问"哪条法律支撑这个结论"、"引用条款依据"、"对应法条"等需要法条出处的问题时，必须调用 \`search_law\` 工具检索具体法条全文，并将返回结果以「法律名称 + 条号 + 条文摘要」格式附在回答中作为依据。**禁止凭记忆背诵法条号**。
`

/** 已加过指令的检测锚点（与正文严格一致） */
const INSTRUCTION_MARKER = '本节点已挂载 `search_law` 工具'

const PROMPT_NODE_NAMES = [
    'summary',
    'chronicle',
    'claim',
    'trend',
    'cause',
    'defense',
    'evidence',
    'contractReviewMain',
]

async function addSearchLawToContractReviewMain(): Promise<void> {
    const node = await prisma.nodes.findUnique({ where: { name: 'contractReviewMain' } })
    if (!node) {
        console.warn('[skip] 节点 contractReviewMain 不存在（DB 未 seed？）')
        return
    }

    const tools = Array.isArray(node.tools) ? (node.tools as string[]) : []
    if (tools.includes('search_law')) {
        console.log('[noop] contractReviewMain 已含 search_law')
        return
    }

    const newTools = [...tools, 'search_law']
    await prisma.nodes.update({
        where: { id: node.id },
        data: { tools: newTools },
    })
    console.log(`[ok] contractReviewMain.tools: ${JSON.stringify(tools)} -> ${JSON.stringify(newTools)}`)
}

async function appendSearchLawInstructionToPrompts(): Promise<void> {
    for (const nodeName of PROMPT_NODE_NAMES) {
        const node = await prisma.nodes.findUnique({ where: { name: nodeName } })
        if (!node) {
            console.warn(`[skip] 节点 ${nodeName} 不存在`)
            continue
        }

        const activePrompt = await prisma.prompts.findFirst({
            where: {
                nodeId: node.id,
                type: 'system',
                status: 1,
                deletedAt: null,
            },
        })
        if (!activePrompt) {
            console.warn(`[skip] 节点 ${nodeName} 无 status=1 的 system prompt`)
            continue
        }

        if (activePrompt.content.includes(INSTRUCTION_MARKER)) {
            console.log(`[noop] ${nodeName}.system_prompt 已含指令`)
            continue
        }

        await prisma.prompts.update({
            where: { id: activePrompt.id },
            data: {
                content: activePrompt.content.trimEnd() + SEARCH_LAW_INSTRUCTION,
            },
        })
        console.log(`[ok] ${nodeName}.system_prompt 追加指令（prompt id=${activePrompt.id}）`)
    }
}

async function main(): Promise<void> {
    console.log('===== 阶段 3 · search_law 配置同步开始 =====')
    console.log(`[env] DATABASE_URL=${process.env.DATABASE_URL?.replace(/:[^@]+@/, ':***@')}`)
    await addSearchLawToContractReviewMain()
    await appendSearchLawInstructionToPrompts()
    console.log('===== 阶段 3 · search_law 配置同步结束 =====')
}

main()
    .catch((err) => {
        console.error('阶段 3 同步脚本失败：', err)
        process.exit(1)
    })
    .finally(() => prisma.$disconnect())
