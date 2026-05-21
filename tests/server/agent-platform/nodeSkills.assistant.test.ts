/**
 * 阶段 5 · 通用问答节点配置防回退测试
 *
 * 锁定 prisma/seeds/seedData.sql 两件事:
 *   1. assistantMain (id=15) 的 tools 数组包含核心工具(2026-05-05 重构后:
 *      search_law / review_contract / recommend_template / save_document_draft / update_document_draft)
 *   2. node_skills 表关联 assistantMain (id=15) 到核心 skill(含 legal-document-writer)
 *
 * 不连 DB(与 stage 4 nodeSkills.contract.test.ts 同口径)。
 *
 * @see docs/superpowers/specs/2026-05-05-document-agent-tool-refactor-design.md
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
    'legal-document-writer', // 2026-05-05 新增,documentMain 同款 skill
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

    it('assistantMain 的 tools 数组包含 recommend_template', () => {
        const re = /\(15,\s*'assistantMain'[\s\S]*?"recommend_template"/
        expect(seedSql).toMatch(re)
    })

    it('assistantMain 的 tools 数组包含 save_document_draft', () => {
        const re = /\(15,\s*'assistantMain'[\s\S]*?"save_document_draft"/
        expect(seedSql).toMatch(re)
    })

    it('assistantMain 的 tools 数组包含 update_document_draft', () => {
        const re = /\(15,\s*'assistantMain'[\s\S]*?"update_document_draft"/
        expect(seedSql).toMatch(re)
    })

    it('assistantMain 的 tools 数组包含 review_contract', () => {
        const re = /\(15,\s*'assistantMain'[\s\S]*?"review_contract"/
        expect(seedSql).toMatch(re)
    })

    it('assistantMain 的 tools 数组不再包含 draft_document(已废弃)', () => {
        const re = /\(15,\s*'assistantMain'[\s\S]*?"draft_document"[\s\S]*?\)/
        expect(seedSql).not.toMatch(re)
    })
})

describe('阶段 5 · assistantMain ↔ skill 关联（seedData 锁定）', () => {
    for (const skill of TARGET_SKILLS) {
        it(`seedData 含 node_skills INSERT 关联 assistantMain (id=15) 到 ${skill}`, () => {
            // 匹配 (15, '<skill>', ...) 出现在 node_skills INSERT 块内
            const re = new RegExp(
                `INSERT INTO "public"\\."node_skills"[\\s\\S]*?\\(\\s*15\\s*,\\s*'${skill}'`,
            )
            expect(seedSql).toMatch(re)
        })
    }
})
