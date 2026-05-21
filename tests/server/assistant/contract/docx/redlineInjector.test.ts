import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
    parseOoxml,
    findAll,
    findFirst,
    walk,
    tagOf,
    getAttr,
    childrenOf,
    paragraphText,
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
const W_AUTHOR = '审查人'

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

describe('injectRedlineMarks 跨段 / 整段替换', () => {
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

    it('整段替换（quote 覆盖整段 textContent）：只装 w:del+w:ins，不动段落标记符', async () => {
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
        // 整段旧文字进 w:del、新文字进 w:ins
        expect(docXml).toContain('<w:delText xml:space="preserve">这一整段都是问题。</w:delText>')
        expect(docXml).toMatch(/<w:ins[^>]*>[\s\S]*建议改写后的整段。[\s\S]*<\/w:ins>/)
        // 段落标记符（pilcrow）保留——不得加 <w:pPr><w:rPr><w:del/></w:rPr></w:pPr>
        expect(docXml).not.toMatch(/<w:pPr><w:rPr><w:del[^/]*\/><\/w:rPr><\/w:pPr>/)
        // 整段替换只占 2 个 ID（del + ins）
        expect(result.nextIdAfter).toBe(2)
    })

    it('整段替换 quote：不加 deleted paragraph mark，下一段保持独立段落（修订版段落错乱回归）', async () => {
        // 正文段 + 标题段两段；对正文段做整段替换 redline。
        // bug：旧实现给正文段加 <w:pPr><w:rPr><w:del/></w:rPr></w:pPr>（删除段落标记符），
        // Word 据 ECMA-376 §17.13.5.15 会把本段与下一段合并显示 → 下一条款标题被吸进正文末尾。
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t xml:space="preserve">本条款内容存在严重问题。</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">第二条 工作内容与地点</w:t></w:r></w:p>
  </w:body>
</w:document>`
        const buffer = await buildFixtureBuffer(xml)
        const clauseText = '本条款内容存在严重问题。'
        const result = await injectRedlineMarks(buffer, [{
            id: 1,
            clauseText,
            clauseParagraphIndex: 0,
            problematicQuote: clauseText,
            quoteCharStart: 0,
            quoteCharEnd: clauseText.length,
            suggestedClauseText: '改写后的整段内容。',
        }], { reviewId: 999, idStart: 0 })

        expect(result.skippedRiskIds).toEqual([])
        const zip = await loadDocxZip(result.buffer)
        const docXml = await readTextFromZip(zip, 'word/document.xml')

        // 段落标记符（pilcrow ¶）不可被标记删除——否则 Word 会把本段与下一段合并显示
        expect(docXml).not.toMatch(/<w:pPr><w:rPr><w:del[^/]*\/><\/w:rPr><\/w:pPr>/)

        // body 仍是两个独立 <w:p>，标题段文字完整保留在自己的段落里
        const docAst = parseOoxml(docXml)
        const body = findFirst(docAst, 'w:body')!
        const paragraphs = childrenOf(body).filter(n => tagOf(n) === 'w:p')
        expect(paragraphs).toHaveLength(2)
        expect(paragraphText(paragraphs[1]!)).toBe('第二条 工作内容与地点')

        // 整段替换只占 2 个 ID（w:del + w:ins）
        expect(result.nextIdAfter).toBe(2)
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

    it('spec §5 redlineRefs.xml 身份证：zip 含 word/customXml/redlineRefs.xml 且内容完整', async () => {
        // 使用 fixture XML（与上方 buildFixtureBuffer 同模式）确保 paragraphs[0] 够长
        const original = await readFile(SAMPLE)
        const fixtureZip = await loadDocxZip(original)
        fixtureZip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">违约金按 0.05% 计算，逾期利率另行约定。</w:t></w:r></w:p>
  </w:body>
</w:document>`)
        const fixtureBuffer = await fixtureZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })

        const clauseText = '违约金按 0.05% 计算，逾期利率另行约定。'
        const result = await injectRedlineMarks(fixtureBuffer, [{
            id: 871,
            clauseText,
            clauseParagraphIndex: 0,
            problematicQuote: '0.05%',
            quoteCharStart: 5,
            quoteCharEnd: 10,
            suggestedClauseText: '修订建议内容',
        }], { reviewId: 871, idStart: 100, signature: '王明远' })

        expect(result.skippedRiskIds).toEqual([])
        expect(result.spansByRiskId.size).toBe(1)
        const zip = await loadDocxZip(result.buffer)

        const refsXml = await readTextFromZip(zip, 'word/customXml/redlineRefs.xml')
        expect(refsXml).toContain('reviewId="871"')
        for (const riskId of result.spansByRiskId.keys()) {
            expect(refsXml).toContain(`riskId="${riskId}"`)
        }
        expect(refsXml).toMatch(/paraIdxs="\d/)

        const ct = await readTextFromZip(zip, '[Content_Types].xml')
        expect(ct).toContain('PartName="/word/customXml/redlineRefs.xml"')
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

// ===== M13：跨 run 修订注入保留区间内的非 run 结构节点 =====

describe('applyRedlineToParagraph · M13 跨 run 保留非 run 结构节点', () => {
    async function buildFixtureBuffer(documentXml: string): Promise<Buffer> {
        const original = await readFile(SAMPLE)
        const zip = await loadDocxZip(original)
        zip.file('word/document.xml', documentXml)
        return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    }

    it('quote 跨 run 且区间内夹 bookmarkStart/End 时，配对标记不被丢弃', async () => {
        // 段落：run("违约金") + bookmarkStart + run("按月支付") + bookmarkEnd + run("逾期加收。")
        // quote 跨三个 run，bookmarkStart/End 落在 (startRunIdx, endRunIdx) 区间内。
        // 旧实现 .filter(tagOf==='w:r') 把它们删掉、splice 整段替换 → 配对标记悬空 → Word 报损坏。
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t xml:space="preserve">违约金</w:t></w:r><w:bookmarkStart w:id="50" w:name="bk1"/><w:r><w:t xml:space="preserve">按月支付</w:t></w:r><w:bookmarkEnd w:id="50"/><w:r><w:t xml:space="preserve">逾期加收。</w:t></w:r></w:p>
  </w:body>
</w:document>`
        const buffer = await buildFixtureBuffer(xml)
        const clauseText = '违约金按月支付逾期加收。'
        const result = await injectRedlineMarks(buffer, [{
            id: 1,
            clauseText,
            clauseParagraphIndex: 0,
            problematicQuote: '金按月支付逾',
            quoteCharStart: 2,
            quoteCharEnd: 8,
            suggestedClauseText: '修订内容',
        }], { reviewId: 999, idStart: 0 })

        expect(result.skippedRiskIds).toEqual([])
        const docXml = await readTextFromZip(await loadDocxZip(result.buffer), 'word/document.xml')
        const docAst = parseOoxml(docXml)
        // bookmarkStart / bookmarkEnd 都保留（配对完整，不悬空）
        expect(findAll(docAst, 'w:bookmarkStart').length).toBe(1)
        expect(findAll(docAst, 'w:bookmarkEnd').length).toBe(1)
        // 中间 run 文字仍进了 w:del
        expect(docXml).toContain('<w:delText')
        expect(docXml).toContain('按月支付')
    })
})

// ===== M15：导出前清理 base 残留的陈旧 redlineRefs.xml =====

/** 先成功注入一轮 redline，得到一个带 redlineRefs.xml 的 docx（模拟客户回传件） */
async function buildBufferWithRedlineRefs(): Promise<Buffer> {
    const original = await readFile(SAMPLE)
    const zip = await loadDocxZip(original)
    zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t xml:space="preserve">违约金按 0.05% 计算。</w:t></w:r></w:p></w:body>
</w:document>`)
    const seedBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    const r = await injectRedlineMarks(seedBuffer, [{
        id: 1, clauseText: '违约金按 0.05% 计算。', clauseParagraphIndex: 0,
        problematicQuote: '0.05%', quoteCharStart: 5, quoteCharEnd: 10,
        suggestedClauseText: '0.5%',
    }], { reviewId: 871, idStart: 100 })
    return Buffer.isBuffer(r.buffer) ? r.buffer : Buffer.from(r.buffer)
}

describe('injectRedlineMarks · M15 清理陈旧 redlineRefs.xml', () => {
    it('本轮无 redline 候选（risk 全被前置跳过）时，清理 base 残留的陈旧 redlineRefs.xml', async () => {
        const baseWithRefs = await buildBufferWithRedlineRefs()
        expect((await loadDocxZip(baseWithRefs)).file('word/customXml/redlineRefs.xml')).not.toBeNull()

        const result = await injectRedlineMarks(baseWithRefs, [
            makeRisk({ id: 2 }), // 无 quote → 前置跳过 → candidates 为空
        ], { reviewId: 871, idStart: 200 })
        expect(result.spansByRiskId.size).toBe(0)

        const zip = await loadDocxZip(result.buffer)
        expect(zip.file('word/customXml/redlineRefs.xml')).toBeNull()
        const ct = await readTextFromZip(zip, '[Content_Types].xml')
        expect(ct).not.toContain('PartName="/word/customXml/redlineRefs.xml"')
        const rels = await readTextFromZip(zip, 'word/_rels/document.xml.rels')
        expect(rels).not.toContain('Target="customXml/redlineRefs.xml"')
    })

    it('候选存在但全部定位失败（spans 为空）时，也清理陈旧 redlineRefs.xml', async () => {
        const baseWithRefs = await buildBufferWithRedlineRefs()
        const result = await injectRedlineMarks(baseWithRefs, [
            makeRisk({
                id: 3,
                clauseText: '与段落 textContent 完全不一致的条款文本',
                clauseParagraphIndex: 0,
                problematicQuote: '不一致',
                quoteCharStart: 0,
                quoteCharEnd: 3,
                suggestedClauseText: '改写',
            }),
        ], { reviewId: 871, idStart: 200 })
        expect(result.spansByRiskId.size).toBe(0)
        expect(result.skippedRiskIds).toEqual([3])
        expect((await loadDocxZip(result.buffer)).file('word/customXml/redlineRefs.xml')).toBeNull()
    })

})

describe('injectAnnotations · M15 purgeRedlineRefs', () => {
    function makeAnnotation(id: number): ContractAnnotationForExport {
        return {
            id,
            riskId: id,
            authorType: 'ai',
            authorName: 'AI',
            content: '审查意见',
            parentAnnotationId: null,
            anchorQuote: '违约金按 0.05% 计算。',
            anchorParagraphIndex: 0,
            wordCommentRef: null,
        }
    }

    it('purgeRedlineRefs=true（comment 模式导出）时清理 base 残留的陈旧 redlineRefs.xml', async () => {
        const baseWithRefs = await buildBufferWithRedlineRefs()
        const result = await injectAnnotations(baseWithRefs, [makeAnnotation(1)], 871, { purgeRedlineRefs: true })
        const zip = await loadDocxZip(result.buffer)
        expect(zip.file('word/customXml/redlineRefs.xml')).toBeNull()
        const ct = await readTextFromZip(zip, '[Content_Types].xml')
        expect(ct).not.toContain('PartName="/word/customXml/redlineRefs.xml"')
    })

    it('不传 purgeRedlineRefs 时保留 redlineRefs.xml（both 模式 redline 已注入，不可误删）', async () => {
        const baseWithRefs = await buildBufferWithRedlineRefs()
        const result = await injectAnnotations(baseWithRefs, [makeAnnotation(1)], 871, {})
        expect((await loadDocxZip(result.buffer)).file('word/customXml/redlineRefs.xml')).not.toBeNull()
    })
})
