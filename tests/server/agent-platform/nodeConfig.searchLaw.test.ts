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

/**
 * 阶段 8 改造后的"提示词需含 search_law 引用"白名单：
 * - summary / claim / trend / cause / defense：方法手册版提示词明确指示调用 search_law
 * - chronicle（大事记）/ evidence（证据策略）：按产品设计不需要查法条，从断言列表移除
 *   （nodes 表 tools 仍配 search_law 作为兜底能力，但 prompt 不强制引导）
 * - contractReviewMain：合同审查未改造，仍用旧版 marker
 */
const NODES_REQUIRING_PROMPT_INSTRUCTION = [
    'summary',
    'claim',
    'trend',
    'cause',
    'defense',
    'contractReviewMain',
] as const

const PROMPT_NAME_MAP: Record<typeof NODES_REQUIRING_PROMPT_INSTRUCTION[number], string> = {
    summary: 'summary_system',
    claim: 'claim_system',
    trend: 'trend_system',
    cause: 'cause_system',
    defense: 'defense_system',
    contractReviewMain: 'contractReview_system',
}

/**
 * 阶段 8 改造后：7 个分析模块的 prompt 整段替换为方法手册版（提示词.md），
 * 不再含旧版 "本节点已挂载 `search_law` 工具" marker，但都明确指示调用
 * `search_law` 工具（如"法律时效检索 → 调用 search_law"、"法条引用强制通过工具"）。
 *
 * - 旧 marker 仍用于：contractReviewMain（合同审查未改造）
 * - 新指令验证：7 个分析模块 prompt 含 `search_law` 工具引用即可
 */
const LEGACY_INSTRUCTION_MARKER = '本节点已挂载 `search_law` 工具'
const SEARCH_LAW_TOOL_REF = 'search_law'

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

    it('6 个核心节点的 system prompt 都明确指示调用 search_law 工具', () => {
        // 7 个分析模块（stage 8 已切到方法手册版提示词，含 `search_law` 工具引用）
        // + 1 个 contractReviewMain（仍用旧 marker）
        for (const nodeName of NODES_REQUIRING_PROMPT_INSTRUCTION) {
            const promptName = PROMPT_NAME_MAP[nodeName]
            const block = extractPromptInsertBlock(promptName)
            expect(block, `seedData.sql 应含 prompt ${promptName} 的 INSERT`).not.toBeNull()

            if (nodeName === 'contractReviewMain') {
                // 合同审查仍用旧版 marker
                expect(
                    block!,
                    `prompt ${promptName}（节点 ${nodeName}）的 content 应含旧版 marker "${LEGACY_INSTRUCTION_MARKER}"`,
                ).toContain(LEGACY_INSTRUCTION_MARKER)
            } else {
                // 7 个分析模块：stage 8 切到方法手册版提示词，验证含 search_law 工具引用即可
                expect(
                    block!,
                    `prompt ${promptName}（节点 ${nodeName}）的 content 应含 search_law 工具引用`,
                ).toContain(SEARCH_LAW_TOOL_REF)
            }
        }
    })
})
