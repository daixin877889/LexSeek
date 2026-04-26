/**
 * 阶段 3 节点配置防回退测试。
 *
 * 策略：直接读 prisma/seeds/seedData.sql 文本，
 * 锁定 search_law 工具与提示词指令的 seed 状态。
 * seedData.sql 是项目"种子数据规范"明确的唯一真理源，
 * 测试库 ls_new_testing 按需 seed，不在本测试断言范围。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const SEED_PATH = resolve(__dirname, '../../../prisma/seeds/seedData.sql')

const NODES_REQUIRING_SEARCH_LAW = [
    'caseMain',
    'assistantMain',
    'documentMain',
    'contractReviewMain',
    'summary',
    'chronicle',
    'claim',
    'trend',
    'cause',
    'defense',
    'evidence',
] as const

const NODES_REQUIRING_PROMPT_INSTRUCTION = [
    'summary',
    'chronicle',
    'claim',
    'trend',
    'cause',
    'defense',
    'evidence',
    'contractReviewMain',
] as const

const PROMPT_NAME_MAP: Record<typeof NODES_REQUIRING_PROMPT_INSTRUCTION[number], string> = {
    summary: 'summary_system',
    chronicle: 'chronicle_system',
    claim: 'claim_system',
    trend: 'trend_system',
    cause: 'cause_system',
    defense: 'defense_system',
    evidence: 'evidence_system',
    contractReviewMain: 'contractReview_system',
}

const INSTRUCTION_MARKER = '本节点已挂载 `search_law` 工具'

let seedSql: string
let seedLines: string[]

beforeAll(async () => {
    seedSql = await readFile(SEED_PATH, 'utf-8')
    seedLines = seedSql.split('\n')
})

/**
 * 在 seedData.sql 里精确定位指定 nodeName 的 nodes 表 INSERT 行。
 * nodes 表的 INSERT 都是单行格式（见 seedData.sql:1067-1080），
 * 模式：INSERT INTO "public"."nodes" ... '<nodeName>' ...
 */
function findNodeInsertLine(nodeName: string): string | null {
    const prefix = 'INSERT INTO "public"."nodes"'
    for (const line of seedLines) {
        if (!line.startsWith(prefix)) continue
        // 用 `'<nodeName>'` 作为唯一锚点（VALUES 列表里的 name 列），
        // 不会与其他表（如 point_consumption_items）冲突。
        if (line.includes(`'${nodeName}',`)) return line
    }
    return null
}

/**
 * 提取指定 prompt name 对应的 INSERT 完整文本（跨多行直到下一条 INSERT）。
 * prompts 表的 INSERT 是多行的（content 含真实换行），无法用单行匹配。
 */
function extractPromptInsertBlock(promptName: string): string | null {
    const startMarker = `INSERT INTO "public"."prompts"`
    const promptAnchor = `'${promptName}',`
    const startIdx = seedLines.findIndex(
        (line) => line.startsWith(startMarker) && line.includes(promptAnchor),
    )
    if (startIdx === -1) return null

    // 从下一行起找到下一个 INSERT 起点（任意表）作为 block 终点
    const lines: string[] = [seedLines[startIdx]!]
    for (let i = startIdx + 1; i < seedLines.length; i++) {
        const line = seedLines[i]!
        if (line.startsWith('INSERT INTO ')) break
        lines.push(line)
    }
    return lines.join('\n')
}

describe('阶段 3 · search_law 节点配置覆盖（seedData.sql 锁定）', () => {
    it('11 个节点的 nodes INSERT 都包含 search_law', () => {
        for (const nodeName of NODES_REQUIRING_SEARCH_LAW) {
            const insertLine = findNodeInsertLine(nodeName)
            expect(insertLine, `seedData.sql 应含节点 ${nodeName} 的 nodes INSERT`).not.toBeNull()
            expect(
                insertLine!,
                `节点 ${nodeName} 的 tools 应含 search_law；当前行=${insertLine!.slice(0, 200)}...`,
            ).toContain('"search_law"')
        }
    })

    it('8 个节点的 system prompt 都含 search_law 指令 marker', () => {
        // 全文 marker 应恰好出现 8 次
        const markerCount = (seedSql.match(/本节点已挂载 `search_law` 工具/g) || []).length
        expect(markerCount, `seedData.sql 中 marker 应恰好出现 8 次（实际 ${markerCount}）`).toBe(8)

        // 每个目标 prompt 的 INSERT block 都应含 marker
        for (const nodeName of NODES_REQUIRING_PROMPT_INSTRUCTION) {
            const promptName = PROMPT_NAME_MAP[nodeName]
            const block = extractPromptInsertBlock(promptName)
            expect(block, `seedData.sql 应含 prompt ${promptName} 的 INSERT`).not.toBeNull()
            expect(
                block!,
                `prompt ${promptName}（节点 ${nodeName}）的 content 应含 marker "${INSTRUCTION_MARKER}"`,
            ).toContain(INSTRUCTION_MARKER)
        }
    })
})
