import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import mammoth from 'mammoth'
import type { Risk } from '#shared/types/contract'
import { injectComments } from '~~/server/services/assistant/contract/docx/commentInjector'
import { loadDocxZip, readTextFromZip } from '~~/server/services/assistant/contract/docx/zipRewriter'
import { parseContractDocx } from '~~/server/services/assistant/contract/docx/parser'

const SAMPLE = join(__dirname, '../../../../../prisma/seeds/contract-samples/labor.docx')

function makeRisk(index: number, overrides: Partial<Risk> = {}): Risk {
    return {
        id: `r-${index}`,
        clauseIndex: index,
        clauseText: `条款原文 ${index}`,
        level: 'high',
        category: '付款条件',
        problem: '付款周期过长',
        analysis: '条款约定"收到发票后 60 日内付款"，对乙方不利',
        risk: '甲方可能恶意拖延',
        suggestion: '改为 30 日内',
        legalBasis: '《民法典》第 509 条',
        suggestedClauseText: '甲方应在收到发票后 30 日内付款',
        ...overrides,
    }
}

describe('injectComments', () => {
    it('空 risks 数组时产出 .docx 与原文等效（不新增 comments.xml）', async () => {
        const original = await readFile(SAMPLE)
        const { buffer: buf } = await injectComments(original, [])
        const zip = await loadDocxZip(buf)
        expect(zip.file('word/comments.xml')).toBeNull()
        const { value } = await mammoth.extractRawText({ buffer: buf })
        expect(value.length).toBeGreaterThan(0)
    })

    it('注入 3 条批注 → comments.xml 存在且含 3 个 w:comment', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        const risks = [makeRisk(1), makeRisk(2), makeRisk(3)].filter(
            (r) => r.clauseIndex < paragraphs.length,
        )
        const { buffer: buf } = await injectComments(original, risks)
        const zip = await loadDocxZip(buf)
        const comments = await readTextFromZip(zip, 'word/comments.xml')
        const matches = comments.match(/<w:comment\s/g) ?? []
        expect(matches.length).toBe(risks.length)
    })

    it('批注 id 从 0 连续递增，无冲突', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        const risks = [makeRisk(1), makeRisk(2), makeRisk(3)].filter(
            (r) => r.clauseIndex < paragraphs.length,
        )
        const { buffer: buf } = await injectComments(original, risks)
        const zip = await loadDocxZip(buf)
        const comments = await readTextFromZip(zip, 'word/comments.xml')
        expect(comments).toContain('w:id="0"')
        expect(comments).toContain('w:id="1"')
        expect(comments).toContain('w:id="2"')
        expect(comments).not.toContain('w:id="3"')
    })

    it('对同一 docx 重复执行两次 injectComments，两次输出的 id 均从 0 开始（spec §10.3 硬要求）', async () => {
        const original = await readFile(SAMPLE)
        const { buffer: buf1 } = await injectComments(original, [makeRisk(2)])
        const zip1 = await loadDocxZip(buf1)
        const comments1 = await readTextFromZip(zip1, 'word/comments.xml')
        expect(comments1).toContain('w:id="0"')
        expect(comments1).not.toContain('w:id="1"')

        const { buffer: buf2 } = await injectComments(original, [makeRisk(1), makeRisk(2)])
        const zip2 = await loadDocxZip(buf2)
        const comments2 = await readTextFromZip(zip2, 'word/comments.xml')
        expect(comments2).toContain('w:id="0"')
        expect(comments2).toContain('w:id="1"')
        expect(comments2).not.toContain('w:id="2"')
    })

    it('document.xml 含 commentRangeStart / commentRangeEnd / commentReference', async () => {
        const original = await readFile(SAMPLE)
        const risks = [makeRisk(2)]
        const { buffer: buf } = await injectComments(original, risks)
        const zip = await loadDocxZip(buf)
        const doc = await readTextFromZip(zip, 'word/document.xml')
        expect(doc).toContain('<w:commentRangeStart w:id="0"')
        expect(doc).toContain('<w:commentRangeEnd w:id="0"')
        expect(doc).toContain('<w:commentReference w:id="0"')
    })

    it('[Content_Types].xml 含 comments Override', async () => {
        const original = await readFile(SAMPLE)
        const { buffer: buf } = await injectComments(original, [makeRisk(2)])
        const zip = await loadDocxZip(buf)
        const types = await readTextFromZip(zip, '[Content_Types].xml')
        expect(types).toContain('PartName="/word/comments.xml"')
        expect(types).toContain(
            'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml',
        )
    })

    it('word/_rels/document.xml.rels 含 comments Relationship', async () => {
        const original = await readFile(SAMPLE)
        const { buffer: buf } = await injectComments(original, [makeRisk(2)])
        const zip = await loadDocxZip(buf)
        const rels = await readTextFromZip(zip, 'word/_rels/document.xml.rels')
        expect(rels).toContain('Target="comments.xml"')
        expect(rels).toContain(
            'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments',
        )
    })

    it('批注文本含五模块结构（高风险 + category + 法律依据 + 条款分析 + 法律风险 + 修改建议）', async () => {
        const original = await readFile(SAMPLE)
        const { buffer: buf } = await injectComments(original, [makeRisk(2)])
        const zip = await loadDocxZip(buf)
        const comments = await readTextFromZip(zip, 'word/comments.xml')
        expect(comments).toContain('[高风险] 付款条件')
        expect(comments).toContain('【法律依据】')
        expect(comments).toContain('【条款分析】')
        expect(comments).toContain('【法律风险】')
        expect(comments).toContain('【修改建议】')
    })

    it('legalBasis 为空时省略【法律依据】段', async () => {
        const original = await readFile(SAMPLE)
        const risk = makeRisk(2, { legalBasis: undefined })
        const { buffer: buf } = await injectComments(original, [risk])
        const zip = await loadDocxZip(buf)
        const comments = await readTextFromZip(zip, 'word/comments.xml')
        expect(comments).not.toContain('【法律依据】')
        expect(comments).toContain('【条款分析】')
    })

    it.each([
        ['high', '高风险'],
        ['medium', '中风险'],
        ['low', '低风险'],
    ] as const)('level %s 映射为 %s', async (level, label) => {
        const original = await readFile(SAMPLE)
        const { buffer: buf } = await injectComments(original, [makeRisk(2, { level })])
        const zip = await loadDocxZip(buf)
        const comments = await readTextFromZip(zip, 'word/comments.xml')
        expect(comments).toContain(`[${label}]`)
    })

    it('批注数 ≥ 20 时 .docx 结构仍合法（unzip 能重打开）', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        const maxIndex = Math.min(paragraphs.length - 1, 25)
        const risks = Array.from({ length: 22 }, (_, i) => makeRisk(Math.min(i + 1, maxIndex)))
        const { buffer: buf } = await injectComments(original, risks)
        const zip = await loadDocxZip(buf)
        expect(zip.file('word/comments.xml')).not.toBeNull()
        const { value } = await mammoth.extractRawText({ buffer: buf })
        expect(value.length).toBeGreaterThan(0)
    })

    it('批注含中文 / 英文 / 数字 / 括号 / 引号 时正常转义', async () => {
        const original = await readFile(SAMPLE)
        const risk = makeRisk(2, {
            problem: '条款 "A" 与 <B> 冲突 & 数字 123',
            analysis: '引号 "双引号" 与 \'单引号\'，括号（中文）(英文)',
        })
        const { buffer: buf } = await injectComments(original, [risk])
        const zip = await loadDocxZip(buf)
        const comments = await readTextFromZip(zip, 'word/comments.xml')
        expect(comments).toContain('&quot;A&quot;')
        expect(comments).toContain('&lt;B&gt;')
        expect(comments).toContain('&amp;')
        expect(comments).toContain('123')
        expect(comments).toContain('（中文）')
    })

    it('clauseIndex 越界时跳过该批注（spec §13 R4 缓释策略）', async () => {
        const original = await readFile(SAMPLE)
        const risks = [makeRisk(1), makeRisk(99999), makeRisk(2)]
        const { buffer: buf } = await injectComments(original, risks)
        const zip = await loadDocxZip(buf)
        const comments = await readTextFromZip(zip, 'word/comments.xml')
        const matches = comments.match(/<w:comment\s/g) ?? []
        expect(matches.length).toBe(2)
    })
})
