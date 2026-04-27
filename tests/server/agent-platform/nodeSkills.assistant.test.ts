/**
 * 阶段 5 · 法律助手节点配置防回退测试
 *
 * 锁定 prisma/seeds/seedData.sql 三件事：
 *   1. assistantMain (id=15) 的 tools 数组包含 search_law / draft_document / review_contract
 *   2. node_skills 表关联 assistantMain (id=15) 到 6 个 skill（一次性 INSERT）
 *   3. 该 INSERT 含 ON CONFLICT 子句保证幂等
 *
 * 不连 DB（与 stage 4 nodeSkills.contract.test.ts 同口径）。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const SEED_PATH = resolve(__dirname, '../../../prisma/seeds/seedData.sql')

const TARGET_SKILLS = [
    'docx',
    'pptx',
    'evidence-defense',
    'litigation-visualization',
    'minimax-pdf',
    'minimax-xlsx',
] as const

let seedSql: string

beforeAll(async () => {
    seedSql = await readFile(SEED_PATH, 'utf-8')
})

describe('阶段 5 · assistantMain 节点 tools 升级（seedData 锁定）', () => {
    it('seedData 中 assistantMain (id=15) 的 INSERT 含 search_law', () => {
        const re = /INSERT INTO "public"\."nodes"[\s\S]*?\(15,\s*'assistantMain'[\s\S]*?'\["search_law"[^\]]*\]'/
        expect(seedSql).toMatch(re)
    })

    it('assistantMain 的 tools 数组包含 draft_document', () => {
        const re = /\(15,\s*'assistantMain'[\s\S]*?"draft_document"/
        expect(seedSql).toMatch(re)
    })

    it('assistantMain 的 tools 数组包含 review_contract', () => {
        const re = /\(15,\s*'assistantMain'[\s\S]*?"review_contract"/
        expect(seedSql).toMatch(re)
    })
})

describe('阶段 5 · assistantMain ↔ 6 skill 关联（seedData 锁定）', () => {
    for (const skill of TARGET_SKILLS) {
        it(`seedData 含 node_skills INSERT 关联 assistantMain (id=15) 到 ${skill}`, () => {
            // 匹配 (15, '<skill>', ...) 出现在 node_skills INSERT 块内
            const re = new RegExp(
                `INSERT INTO "public"\\."node_skills"[\\s\\S]*?\\(\\s*15\\s*,\\s*'${skill}'`,
            )
            expect(seedSql).toMatch(re)
        })
    }

    it('阶段 5 节点 ↔ skills 关联段含 ON CONFLICT 子句保证幂等', () => {
        // 阶段 5 是一次性多行 INSERT 后跟一个 ON CONFLICT；至少要有一处
        // node_skills INSERT 命中 (15, '<目标 skill>') + 紧随其后的 ON CONFLICT。
        const re = /\(\s*15\s*,\s*'docx'[\s\S]*?ON CONFLICT[\s\S]*?DO NOTHING/
        expect(seedSql).toMatch(re)
    })
})
