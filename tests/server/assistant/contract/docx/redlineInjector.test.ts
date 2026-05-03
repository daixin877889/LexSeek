import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
    parseOoxml,
    findAll,
    walk,
    tagOf,
    getAttr,
    findMaxSharedId,
} from '~~/server/agents/contract/docx/xmlAst'
import {
    loadDocxZip,
    readTextFromZip,
} from '~~/server/agents/contract/docx/zipRewriter'
import {
    injectRedlineMarks,
    type RedlineRisk,
} from '~~/server/agents/contract/docx/redlineInjector'
import { injectAnnotations, type ContractAnnotationForExport } from '~~/server/agents/contract/docx/commentInjector'
import { parseContractDocx } from '~~/server/agents/contract/docx/parser'

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

// ===== Task 17 集成测试：spec §8.5 验证项 =====

describe('injectRedlineMarks · 完整 docx round-trip + spec §8.5 验证项', () => {
    it('spec §8.5 ①：mammoth 解析含 ins/del 的输出 → 不抛错且 raw text 含 ins 内容', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        const firstPara = paragraphs[0]!
        if (firstPara.length < 6) return // 样本过短就跳

        const result = await injectRedlineMarks(original, [{
            id: 1,
            clauseText: firstPara,
            clauseParagraphIndex: 0,
            problematicQuote: firstPara.slice(0, 5),
            quoteCharStart: 0,
            quoteCharEnd: 5,
            suggestedClauseText: 'XYZ',
        }], { reviewId: 999, idStart: 0 })
        expect(result.skippedRiskIds).toEqual([])

        const mammoth = await import('mammoth')
        const parsed = await mammoth.extractRawText({ buffer: result.buffer })
        // mammoth 会渲染 w:ins 内容（XYZ 必出现）；w:del 渲染策略不同 mammoth 版本
        // 不一致，本测试仅验证 round-trip 不抛错 + ins 内容能被解析到
        expect(parsed.value).toContain('XYZ')
    })

    it('spec §8.5 ④：both 模式串联 redlineInjector + commentInjector → 全部 w:id 跨标签唯一', async () => {
        // 真实跑两个 injector 串联，不用 mock；验证 w:id 池协调正确
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        if (paragraphs.length < 3) return

        // 准备 3 条 risk 落到不同段落（quote 取每段前 5 字符）
        const risks: RedlineRisk[] = [0, 1, 2].map(i => ({
            id: i + 1,
            clauseText: paragraphs[i]!,
            clauseParagraphIndex: i,
            problematicQuote: paragraphs[i]!.slice(0, Math.min(5, paragraphs[i]!.length)),
            quoteCharStart: 0,
            quoteCharEnd: Math.min(5, paragraphs[i]!.length),
            suggestedClauseText: `改写${i}`,
        }))
        const annotations: ContractAnnotationForExport[] = risks.map(r => ({
            id: r.id,
            riskId: r.id,
            authorType: 'ai',
            authorName: 'AI',
            content: '审查意见',
            parentAnnotationId: null,
            wordCommentRef: null,
            anchorQuote: r.clauseText,
            anchorParagraphIndex: r.clauseParagraphIndex!,
        }))

        const docAst0 = parseOoxml(await readTextFromZip(await loadDocxZip(original), 'word/document.xml'))
        const idStart = findMaxSharedId(docAst0) + 1

        const redlineResult = await injectRedlineMarks(original, risks, { reviewId: 999, idStart })
        const commentResult = await injectAnnotations(redlineResult.buffer, annotations, 999, {
            idStart: redlineResult.nextIdAfter,
            wrapTargetByRiskId: redlineResult.spansByRiskId,
        })

        // 抽取最终 docx 的 document.xml
        const finalAst = parseOoxml(await readTextFromZip(await loadDocxZip(commentResult.buffer), 'word/document.xml'))

        // OOXML w:id 池语义：ins/del/bookmark 各自代表"独立实例"，必须全局唯一；
        // commentRangeStart/End/Reference 三标签共享同一个 id（指向同一个 comment），
        // 这是 OOXML 标准设计，不算"撞车"。
        // 真正撞车 = ins/del/bookmark 的 id 与 commentReference id 重合（同一池）。
        const instanceTags = new Set(['w:bookmarkStart', 'w:ins', 'w:del'])
        const instanceIds: number[] = []
        const commentIds: number[] = []
        walk(finalAst, (n) => {
            const t = tagOf(n)
            const idStr = getAttr(n, 'w:id')
            if (!t || !idStr) return
            const id = parseInt(idStr, 10)
            if (!Number.isFinite(id)) return
            if (instanceTags.has(t)) instanceIds.push(id)
            else if (t === 'w:commentReference') commentIds.push(id)
        })
        expect(instanceIds.length).toBeGreaterThan(0)
        expect(commentIds.length).toBeGreaterThan(0)
        // 实例标签内部各自唯一
        expect(new Set(instanceIds).size).toBe(instanceIds.length)
        // comment id 内部唯一
        expect(new Set(commentIds).size).toBe(commentIds.length)
        // ins/del/bookmark 与 comment 之间无交集（spec §8.5 ④ 撞车语义）
        const inter = instanceIds.filter(id => commentIds.includes(id))
        expect(inter).toEqual([])
    })

    it('spec §8.5 ⑤ 端到端：含控制字符的 suggestedClauseText 经 stripIllegalXmlChars 后产物 XML 不含 0x00-0x08/0x0B/0x0C/0x0E-0x1F', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        if (paragraphs.length === 0 || paragraphs[0]!.length < 6) return

        // 构造含 0x08 0x1B 0x07 等非法字符的 suggestedClauseText
        const dirty = 'A'
            + String.fromCharCode(0x08) + 'B'
            + String.fromCharCode(0x1B) + 'C'
            + String.fromCharCode(0x07) + 'D'

        const result = await injectRedlineMarks(original, [{
            id: 1,
            clauseText: paragraphs[0]!,
            clauseParagraphIndex: 0,
            problematicQuote: paragraphs[0]!.slice(0, 5),
            quoteCharStart: 0,
            quoteCharEnd: 5,
            suggestedClauseText: dirty,
        }], { reviewId: 999, idStart: 0 })

        const docXml = await readTextFromZip(await loadDocxZip(result.buffer), 'word/document.xml')

        // 装填后 XML 必须不含任何 XML 1.0 禁用字符（U+0000-U+0008/U+000B/U+000C/U+000E-U+001F/U+FFFE/U+FFFF）
        // eslint-disable-next-line no-control-regex
        const ILLEGAL = /[ --￾￿]/
        expect(docXml).not.toMatch(ILLEGAL)
        // 但合法部分仍然出现
        expect(docXml).toContain('ABCD')
    })
})
