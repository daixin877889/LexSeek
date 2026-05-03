import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
    parseOoxml,
    findAll,
} from '~~/server/agents/contract/docx/xmlAst'
import {
    loadDocxZip,
    readTextFromZip,
} from '~~/server/agents/contract/docx/zipRewriter'
import {
    injectRedlineMarks,
    type RedlineRisk,
} from '~~/server/agents/contract/docx/redlineInjector'

const SAMPLE = join(__dirname, '../../../../../prisma/seeds/contract-samples/labor.docx')
const W_AUTHOR = 'LexSeek AI'

function makeRisk(overrides: Partial<RedlineRisk> & { id: number }): RedlineRisk {
    return {
        clauseText: '',
        clauseParagraphIndex: 0,
        problematicQuote: null,
        quoteCharStart: null,
        quoteCharEnd: null,
        suggestedClauseText: null,
        ...overrides,
    }
}

describe('injectRedlineMarks', () => {
    it('quote=null 的 risk 全跳过且不修改 docx', async () => {
        const original = await readFile(SAMPLE)
        const result = await injectRedlineMarks(original, [
            makeRisk({ id: 1 }),
        ], { reviewId: 999, idStart: 0 })
        expect(result.skippedRiskIds).toEqual([1])
        expect(result.nextIdAfter).toBe(0)
        // 原始 buffer 内容相同（不必字节相等，但段落数应一致）
        const zip = await loadDocxZip(result.buffer)
        const docXml = await readTextFromZip(zip, 'word/document.xml')
        expect(docXml).not.toContain('<w:ins ')
        expect(docXml).not.toContain('<w:del ')
    })

    it('suggestedClauseText 为空的 risk 跳过', async () => {
        const original = await readFile(SAMPLE)
        const result = await injectRedlineMarks(original, [
            makeRisk({
                id: 2,
                problematicQuote: 'foo',
                quoteCharStart: 0,
                quoteCharEnd: 3,
                clauseText: 'foo bar',
                suggestedClauseText: null,
            }),
        ], { reviewId: 999, idStart: 0 })
        expect(result.skippedRiskIds).toEqual([2])
    })

    it('clauseParagraphIndex=null 的 risk 跳过', async () => {
        const original = await readFile(SAMPLE)
        const result = await injectRedlineMarks(original, [
            makeRisk({
                id: 3,
                problematicQuote: 'foo',
                quoteCharStart: 0,
                quoteCharEnd: 3,
                clauseText: 'foo bar',
                clauseParagraphIndex: null,
                suggestedClauseText: 'baz',
            }),
        ], { reviewId: 999, idStart: 0 })
        expect(result.skippedRiskIds).toEqual([3])
    })
})

describe('injectRedlineMarks 装配（同段 quote）', () => {
    /** 自测试用 fixture：单段、单 run 的最小 docx XML */
    const FIXTURE_XML_SINGLE_RUN = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">违约金按 0.05% 计算。</w:t></w:r></w:p>
  </w:body>
</w:document>`

    /**
     * 用最小 fixture XML 替换 labor.docx 的 word/document.xml，做单元测试。
     * 跑产物时 OOXML 其余 part 沿用 labor.docx（避免重新构造完整 docx 文件）。
     */
    async function buildFixtureBuffer(documentXml: string): Promise<Buffer> {
        const original = await readFile(SAMPLE)
        const zip = await loadDocxZip(original)
        zip.file('word/document.xml', documentXml)
        return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    }

    it('单 run 内的 quote：拆 run 三段，保留 rPr 副本，生成 w:del + w:ins', async () => {
        const buffer = await buildFixtureBuffer(FIXTURE_XML_SINGLE_RUN)
        const result = await injectRedlineMarks(buffer, [{
            id: 1,
            clauseText: '违约金按 0.05% 计算。',
            clauseParagraphIndex: 0,
            problematicQuote: '0.05%',
            quoteCharStart: 5,
            quoteCharEnd: 10,
            suggestedClauseText: '0.5%',
        }], { reviewId: 999, idStart: 100 })

        expect(result.skippedRiskIds).toEqual([])
        expect(result.nextIdAfter).toBe(102)

        const zip = await loadDocxZip(result.buffer)
        const docXml = await readTextFromZip(zip, 'word/document.xml')
        expect(docXml).toContain('<w:del w:id="100"')
        expect(docXml).toContain(`w:author="${W_AUTHOR}"`)
        expect(docXml).toContain('<w:ins w:id="101"')
        expect(docXml).toContain('<w:delText xml:space="preserve">0.05%</w:delText>')
        // ins 内 suggestedClauseText 保留 xml:space="preserve"
        expect(docXml).toMatch(/<w:t xml:space="preserve">0\.5%<\/w:t>/)
        // 删除前后段保持原 <w:t>（违约金按 + 计算。）
        expect(docXml).toContain('<w:t xml:space="preserve">违约金按 </w:t>')
        expect(docXml).toContain('<w:t xml:space="preserve"> 计算。</w:t>')
        // 三段都保留原 <w:b/> 粗体 rPr 副本
        const docAst = parseOoxml(docXml)
        const rPrElems = findAll(docAst, 'w:rPr')
        // 至少 4 处：原前段、del 内、ins 内、原后段（具体数视实现而定，≥3）
        expect(rPrElems.length).toBeGreaterThanOrEqual(3)
    })

    it('跨多 run 的 quote：起止 run 各拆，中间 run 全 wrap，所有 run 保留 rPr 副本', async () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">违约金</w:t></w:r><w:r><w:t xml:space="preserve">按月底支付,逾期每日加收 </w:t></w:r><w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t xml:space="preserve">0.05%</w:t></w:r><w:r><w:t xml:space="preserve"> 滞纳金。</w:t></w:r></w:p>
  </w:body>
</w:document>`
        const buffer = await buildFixtureBuffer(xml)
        // clauseText 与段落 textContent 严格一致（不替换中文逗号）
        const clauseText = '违约金按月底支付,逾期每日加收 0.05% 滞纳金。'
        const result = await injectRedlineMarks(buffer, [{
            id: 1,
            clauseText,
            clauseParagraphIndex: 0,
            problematicQuote: '0.05%',
            quoteCharStart: clauseText.indexOf('0.05%'),
            quoteCharEnd: clauseText.indexOf('0.05%') + 5,
            suggestedClauseText: '0.5%',
        }], { reviewId: 999, idStart: 0 })

        expect(result.skippedRiskIds).toEqual([])
        const zip = await loadDocxZip(result.buffer)
        const docXml = await readTextFromZip(zip, 'word/document.xml')
        expect(docXml).toContain('<w:delText xml:space="preserve">0.05%</w:delText>')
        // 红色 run rPr 在 del 内仍保留
        expect(docXml).toMatch(/<w:rPr><w:color w:val="FF0000"\/><\/w:rPr>[\s\S]*<w:delText/)
        // ins 文本是 0.5%，继承 quote 起始 run 的红色 rPr
        expect(docXml).toMatch(/<w:ins[^>]*><w:r><w:rPr><w:color w:val="FF0000"\/><\/w:rPr><w:t xml:space="preserve">0\.5%<\/w:t><\/w:r><\/w:ins>/)
    })

    it('w:author 固定 LexSeek AI / w:date 含 Z 时区', async () => {
        const buffer = await buildFixtureBuffer(FIXTURE_XML_SINGLE_RUN)
        const result = await injectRedlineMarks(buffer, [{
            id: 1,
            clauseText: '违约金按 0.05% 计算。',
            clauseParagraphIndex: 0,
            problematicQuote: '0.05%',
            quoteCharStart: 5,
            quoteCharEnd: 10,
            suggestedClauseText: '0.5%',
        }], { reviewId: 999, idStart: 0 })
        const zip = await loadDocxZip(result.buffer)
        const docXml = await readTextFromZip(zip, 'word/document.xml')
        expect(docXml).toContain(`w:author="${W_AUTHOR}"`)
        expect(docXml).toMatch(/w:date="\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z"/)
    })
})

describe('injectRedlineMarks 跨段 / 整段删除', () => {
    async function buildFixtureBuffer(documentXml: string): Promise<Buffer> {
        const original = await readFile(SAMPLE)
        const zip = await loadDocxZip(original)
        zip.file('word/document.xml', documentXml)
        return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    }

    it('quote 跨多段：起始段 + 中间段 + 结尾段都装 w:del，结尾段后插 w:ins', async () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t xml:space="preserve">第一行内容</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">第二行内容</w:t></w:r></w:p>
  </w:body>
</w:document>`
        const buffer = await buildFixtureBuffer(xml)
        // clauseText = "第一行内容\n第二行内容" (11 字符)
        // quote = "内容\n第二" (offset 3..8)
        const result = await injectRedlineMarks(buffer, [{
            id: 1,
            clauseText: '第一行内容\n第二行内容',
            clauseParagraphIndex: 0,
            problematicQuote: '内容\n第二',
            quoteCharStart: 3,
            quoteCharEnd: 8,
            suggestedClauseText: 'XYZ',
        }], { reviewId: 999, idStart: 0 })

        expect(result.skippedRiskIds).toEqual([])
        const zip = await loadDocxZip(result.buffer)
        const docXml = await readTextFromZip(zip, 'word/document.xml')
        // 第一段含 w:del 包裹 "内容"
        expect(docXml).toMatch(/<w:del[^>]*><w:r>(<w:rPr\/>)?<w:delText xml:space="preserve">内容<\/w:delText><\/w:r><\/w:del>/)
        // 第二段含 w:del 包裹 "第二" + 后面跟 w:ins "XYZ"
        expect(docXml).toMatch(/<w:delText xml:space="preserve">第二<\/w:delText>[\s\S]*<w:ins[^>]*>[\s\S]*XYZ/)
        // ID 顺序：每段 1 个 del + 全 redline 共 1 个 ins → 共 3 ID
        expect(result.nextIdAfter).toBe(3)
    })

    it('整段删除（quote 覆盖整段 textContent）：段落 pPr/rPr/del 同步加上', async () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t xml:space="preserve">这一整段都是问题。</w:t></w:r></w:p>
  </w:body>
</w:document>`
        const buffer = await buildFixtureBuffer(xml)
        const clauseText = '这一整段都是问题。'
        const result = await injectRedlineMarks(buffer, [{
            id: 1,
            clauseText,
            clauseParagraphIndex: 0,
            problematicQuote: clauseText,
            quoteCharStart: 0,
            quoteCharEnd: clauseText.length,
            suggestedClauseText: '建议改写后的整段。',
        }], { reviewId: 999, idStart: 0 })

        expect(result.skippedRiskIds).toEqual([])
        const zip = await loadDocxZip(result.buffer)
        const docXml = await readTextFromZip(zip, 'word/document.xml')
        // 段落 pPr/rPr/del 加上
        expect(docXml).toMatch(/<w:pPr><w:rPr><w:del[^/]*\/><\/w:rPr><\/w:pPr>/)
        // 占用 3 个 ID（del + ins + pPr/del）
        expect(result.nextIdAfter).toBe(3)
    })
})
