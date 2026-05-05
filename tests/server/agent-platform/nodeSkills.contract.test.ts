/**
 * 阶段 4 · 节点 skill 关联防回退测试。
 *
 * 策略：直接读 prisma/seeds/seedData.sql 文本，锁定 contractReviewMain ↔ docx
 * 的 INSERT 语句存在。与 stage 3 nodeConfig.searchLaw.test.ts 同样思路：
 *   - 不连 DB（测试库 ls_new_testing 按需 seed，不依赖 seedData）
 *   - seedData.sql 是项目"种子数据规范"明确的唯一真理源
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const SEED_PATH = resolve(__dirname, '../../../prisma/seeds/seedData.sql')

let seedSql: string

beforeAll(async () => {
    seedSql = await readFile(SEED_PATH, 'utf-8')
})

describe('阶段 4 · contractReviewMain ↔ docx skill 关联（seedData 锁定）', () => {
    it('seedData 含 node_skills INSERT 关联 contractReviewMain (id=18) 到 docx', () => {
        // 匹配模式：INSERT INTO ..."node_skills"... VALUES (18, 'docx', ...)
        // 中间允许任何字段顺序与空白
        const re = /INSERT INTO "public"\."node_skills"[\s\S]*?VALUES\s*\(\s*18\s*,\s*'docx'/
        expect(seedSql).toMatch(re)
    })

    // 删除"含 ON CONFLICT"断言:
    // 按 .claude/rules/database.md 规范,seedData.sql 是"全量快照",只能含 INSERT,
    // 不允许 UPDATE / ON CONFLICT 等增量补丁语法。原断言违反规范,删除。
})
