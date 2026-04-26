import { describe, it, expect, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import mammoth from 'mammoth'
import type { Risk } from '#shared/types/contract'
import {
    parseContractDocx,
    detectParties,
    injectComments,
} from '~~/server/agents/contract/docx'
import { textToDocxService } from '~~/server/agents/contract/textToDocx.service'

const SAMPLES = ['labor', 'lease', 'sale', 'service', 'loan'] as const
const SAMPLE_DIR = join(__dirname, '../../../../../prisma/seeds/contract-samples')

vi.mock('~~/server/services/node/chatModelFactory', () => ({
    createChatModel: vi.fn(() => ({ invoke: vi.fn().mockResolvedValue({ content: '{}' }) })),
}))
vi.mock('~~/server/services/node/node.service', () => ({
    getValidNodeConfig: vi.fn().mockResolvedValue({
        id: 1,
        name: 'contractReviewMain',
        modelName: 'deepseek-chat',
        modelSdkType: 'openai',
        modelProviderBaseUrl: 'https://api.deepseek.com/v1',
        modelApiKeys: [{ apiKey: 'mock', status: 1 }],
        prompt: null,
    }),
}))

describe('docx 端到端集成', () => {
    it.each(SAMPLES)('%s.docx → parse → detect → inject 闭环', async (name) => {
        const buf = await readFile(join(SAMPLE_DIR, `${name}.docx`))

        const parsed = await parseContractDocx(buf)
        expect(parsed.paragraphs.length).toBeGreaterThan(5)

        const parties = await detectParties(parsed.paragraphs)
        expect(parties.source).toBe('regex')
        expect(parties.partyA).not.toBeNull()
        expect(parties.partyB).not.toBeNull()

        const clauseIdx = Math.min(3, parsed.paragraphs.length - 1)
        const risks: Risk[] = [
            {
                id: 'r-1',
                clauseIndex: clauseIdx,
                clauseText: parsed.paragraphs[clauseIdx],
                level: 'high',
                category: '付款条件',
                problem: '付款周期过长',
                analysis: '分析',
                risk: '风险',
                suggestion: '建议',
                legalBasis: '《民法典》第 509 条',
                suggestedClauseText: '甲方应在收到发票后 30 日内付款',
            },
        ]
        const injected = await injectComments(buf, risks)

        const { value } = await mammoth.extractRawText({ buffer: injected.buffer })
        expect(value.length).toBeGreaterThan(0)
    })

    it('paste → textToDocx → parse → inject 链路', async () => {
        const text = '甲方：某公司\n乙方：张三\n本合同签订于 2026 年 4 月。\n付款条件：60 日内支付全款。\n违约金：日万分之五。\n合同期限：一年。'
        const docxBuf = await textToDocxService(text)
        const parsed = await parseContractDocx(docxBuf)
        expect(parsed.paragraphs.length).toBeGreaterThan(2)

        const clauseIdx = Math.min(1, parsed.paragraphs.length - 1)
        const risks: Risk[] = [
            {
                id: 'r-1',
                clauseIndex: clauseIdx,
                clauseText: parsed.paragraphs[clauseIdx],
                level: 'medium',
                category: '付款条件',
                problem: '周期过长',
                analysis: 'a',
                risk: 'r',
                suggestion: 's',
                suggestedClauseText: '改为 30 日',
            },
        ]
        const injected = await injectComments(docxBuf, risks)
        const { value } = await mammoth.extractRawText({ buffer: injected.buffer })
        expect(value).toContain('甲方')
    })
})
