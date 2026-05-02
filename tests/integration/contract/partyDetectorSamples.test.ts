/**
 * partyDetector 真实 LLM 集成测试。
 *
 * 默认 skip。仅在 TEST_REAL_LLM=1 环境变量下启用，避免每次跑测试都调 LLM 烧 token。
 *
 * 跑法（PR 1 上线前手工验证）：
 *   TEST_REAL_LLM=1 npx vitest run tests/integration/contract/partyDetectorSamples.test.ts
 *
 * **Feature: contract-review-pre-1**
 * **Validates: spec §3.4 PR 1 验收**
 */
import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { detectParties } from '~~/server/agents/contract/docx/partyDetector'
import { parseContractDocx } from '~~/server/agents/contract/docx/parser'

const SAMPLES = ['labor', 'lease', 'sale', 'service', 'loan'] as const
const SAMPLE_DIR = join(__dirname, '../../../prisma/seeds/contract-samples')
const ENABLED = process.env.TEST_REAL_LLM === '1'

describe.skipIf(!ENABLED)('partyDetector 真实 LLM 集成（5 份合同样本）', () => {
    it.each(SAMPLES)('%s.docx → contractType 非空 + source=llm', async (name) => {
        const buf = await readFile(join(SAMPLE_DIR, `${name}.docx`))
        const { paragraphs } = await parseContractDocx(buf)
        const result = await detectParties(paragraphs)
        expect(result.partyA).not.toBeNull()
        expect(result.partyB).not.toBeNull()
        expect(result.contractType).not.toBeNull() // PRE-1 验收关键：不再为 null
        expect(result.source).toBe('llm')
    })
})
