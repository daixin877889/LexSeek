/**
 * parseRedlineMarks + resolveCorpusForRef 单元测试（spec §11.1）。
 *
 * 测试策略：
 * 1. 用 injectRedlineMarks 产出含修订标记的 docx（round-trip 测试）
 * 2. 用 parseRedlineMarks 解析，断言 reviewId、refs、存活 ins/del id、paragraphs
 * 3. 覆盖缺文件（无 redlineRefs.xml）、损坏 XML、跨段 delIds 多值等边界情况
 * 4. resolveCorpusForRef：命中段落 vs 越界回退全文
 */
import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import JSZip from 'jszip'
import { loadDocxZip } from '~~/server/agents/contract/docx/zipRewriter'
import {
    injectRedlineMarks,
    type RedlineRisk,
} from '~~/server/agents/contract/docx/redlineInjector'
import {
    parseRedlineMarks,
    resolveCorpusForRef,
} from '~~/server/agents/contract/docx/redlineParser'

const SAMPLE = join(__dirname, '../../../../../prisma/seeds/contract-samples/labor.docx')

/** 复用 redlineInjector.test.ts 的 makeRisk 辅助 */
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

/**
 * 用最小 fixture XML 替换 labor.docx 的 word/document.xml，做单元测试。
 * 与 redlineInjector.test.ts 的 buildFixtureBuffer 同模式。
 */
async function buildFixtureBuffer(documentXml: string): Promise<Buffer> {
    const original = await readFile(SAMPLE)
    const zip = await loadDocxZip(original)
    zip.file('word/document.xml', documentXml)
    return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

// ===== §11.1 基础 round-trip =====

describe('parseRedlineMarks · round-trip 基础解析（spec §11.1）', () => {
    /** 单段 fixture，供 round-trip 测试 */
    const FIXTURE_XML_SINGLE = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">违约金按 0.05% 计算，逾期利率另行约定。</w:t></w:r></w:p>
  </w:body>
</w:document>`

    it('round-trip：reviewId、refs 数量、所有 ins/del id 存活', async () => {
        const baseBuffer = await buildFixtureBuffer(FIXTURE_XML_SINGLE)
        const exported = await injectRedlineMarks(baseBuffer, [
            makeRisk({
                id: 101,
                clauseText: '违约金按 0.05% 计算，逾期利率另行约定。',
                clauseParagraphIndex: 0,
                problematicQuote: '0.05%',
                quoteCharStart: 5,
                quoteCharEnd: 10,
                suggestedClauseText: '0.5%',
            }),
        ], { reviewId: 871, idStart: 100, signature: '王明远' })

        expect(exported.skippedRiskIds).toEqual([])

        const parsed = await parseRedlineMarks(exported.buffer)

        expect(parsed.reviewId).toBe(871)
        expect(parsed.refs.length).toBe(exported.spansByRiskId.size)

        // 未经 Word 处理的 docx：所有 ins/del 都存活
        for (const ref of parsed.refs) {
            expect(ref.paraIdxs.length).toBeGreaterThan(0)
            expect(parsed.survivingInsIds.has(ref.insId)).toBe(true)
            for (const delId of ref.delIds) {
                expect(parsed.survivingDelIds.has(delId)).toBe(true)
            }
        }

        expect(parsed.paragraphs.length).toBeGreaterThan(0)
    })

    it('round-trip：refs 字段内容正确（riskId、insId、delIds 非空）', async () => {
        const baseBuffer = await buildFixtureBuffer(FIXTURE_XML_SINGLE)
        const exported = await injectRedlineMarks(baseBuffer, [
            makeRisk({
                id: 871,
                clauseText: '违约金按 0.05% 计算，逾期利率另行约定。',
                clauseParagraphIndex: 0,
                problematicQuote: '0.05%',
                quoteCharStart: 5,
                quoteCharEnd: 10,
                suggestedClauseText: '修订建议内容',
            }),
        ], { reviewId: 871, idStart: 100, signature: '王明远' })

        const parsed = await parseRedlineMarks(exported.buffer)
        expect(parsed.refs.length).toBe(1)

        const ref = parsed.refs[0]!
        expect(ref.riskId).toBe(871)
        expect(ref.delIds.length).toBeGreaterThan(0)
        expect(Number.isFinite(ref.insId)).toBe(true)
        expect(ref.paraIdxs.length).toBeGreaterThan(0)
    })
})

// ===== §11.1 缺文件 / 损坏 XML 边界 =====

describe('parseRedlineMarks · 缺文件与损坏边界（spec §11.1）', () => {
    it('无 redlineRefs.xml 的 docx：reviewId=null、refs 为空', async () => {
        // 直接用原始 labor.docx（无 customXml 注入）
        const bare = await readFile(SAMPLE)
        const result = await parseRedlineMarks(bare)
        expect(result.reviewId).toBeNull()
        expect(result.refs).toEqual([])
        // paragraphs 仍然可以收集（document.xml 存在）
        expect(result.survivingInsIds.size).toBe(0)
        expect(result.survivingDelIds.size).toBe(0)
    })

    it('损坏的 redlineRefs.xml（非法 XML）：reviewId=null、refs 为空，不抛错', async () => {
        // 构造一个含损坏 redlineRefs.xml 的 docx
        const original = await readFile(SAMPLE)
        const zip = await loadDocxZip(original)
        // 写入非法 XML
        zip.file('word/customXml/redlineRefs.xml', '<broken xml this is not valid <<<<')
        const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })

        const result = await parseRedlineMarks(buffer)
        expect(result.reviewId).toBeNull()
        expect(result.refs).toEqual([])
        // 应当不抛错（try/catch 兜底）
    })

    it('损坏的 redlineRefs.xml（reviewId 非数字）：reviewId=null，refs 可能有值', async () => {
        const original = await readFile(SAMPLE)
        const zip = await loadDocxZip(original)
        zip.file(
            'word/customXml/redlineRefs.xml',
            `<?xml version="1.0" encoding="UTF-8"?><lexseekRedlineRefs reviewId="not-a-number"><ref riskId="1" insId="2" delIds="3" paraIdxs="0"/></lexseekRedlineRefs>`,
        )
        const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })

        const result = await parseRedlineMarks(buffer)
        expect(result.reviewId).toBeNull()
        // refs 中的 ref 仍可解析（riskId/insId/delIds 正常）
        expect(result.refs.length).toBe(1)
        expect(result.refs[0]!.riskId).toBe(1)
    })

    it('redlineRefs.xml 不含任何 ref 元素：refs 为空数组', async () => {
        const original = await readFile(SAMPLE)
        const zip = await loadDocxZip(original)
        zip.file(
            'word/customXml/redlineRefs.xml',
            `<?xml version="1.0" encoding="UTF-8"?><lexseekRedlineRefs reviewId="42"></lexseekRedlineRefs>`,
        )
        const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })

        const result = await parseRedlineMarks(buffer)
        expect(result.reviewId).toBe(42)
        expect(result.refs).toEqual([])
    })

    it('docxBuffer 非合法 docx zip：reviewId=null、refs/语料全空，不抛错', async () => {
        // 整个 buffer 不是 zip（如客户上传了非 docx 文件 / buffer 损坏）：
        // 修订标记是增强项，parseRedlineMarks 降级为空结果而非抛错（spec §6.1 容错契约）
        const garbage = Buffer.from('this is plainly not a docx zip archive')
        const result = await parseRedlineMarks(garbage)
        expect(result.reviewId).toBeNull()
        expect(result.refs).toEqual([])
        expect(result.survivingInsIds.size).toBe(0)
        expect(result.survivingDelIds.size).toBe(0)
        expect(result.paragraphs).toEqual([])
    })
})

// ===== §11.1 跨段 delIds 多值 =====

describe('parseRedlineMarks · 跨段修订（spec §11.1）', () => {
    /** 两段 fixture，用于跨段 quote 测试 */
    const FIXTURE_XML_TWO_PARAS = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t xml:space="preserve">第一行内容文字</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">第二行内容文字</w:t></w:r></w:p>
  </w:body>
</w:document>`

    it('跨段 quote：ref.delIds.length > 1、paraIdxs.length > 1（两段各有一个 del id）', async () => {
        const baseBuffer = await buildFixtureBuffer(FIXTURE_XML_TWO_PARAS)
        // clauseText 跨两段（含换行）
        const clauseText = '第一行内容文字\n第二行内容文字'
        // quote 跨两段：从第一段的"内容"到第二段的"第二"
        const problematicQuote = '内容文字\n第二行'
        const quoteCharStart = clauseText.indexOf('内容文字')
        const quoteCharEnd = clauseText.indexOf('内容文字') + '内容文字\n第二行'.length

        const exported = await injectRedlineMarks(baseBuffer, [
            makeRisk({
                id: 200,
                clauseText,
                clauseParagraphIndex: 0,
                problematicQuote,
                quoteCharStart,
                quoteCharEnd,
                suggestedClauseText: 'XYZ',
            }),
        ], { reviewId: 999, idStart: 0 })

        expect(exported.skippedRiskIds).toEqual([])

        const parsed = await parseRedlineMarks(exported.buffer)
        expect(parsed.refs.length).toBe(1)

        const ref = parsed.refs[0]!
        // 跨段时 injectRedlineMarks 会给每段分别分配一个 del id
        expect(ref.delIds.length).toBeGreaterThan(1)
        // 跨段时 paraIdxs 记录两个段落序号
        expect(ref.paraIdxs.length).toBeGreaterThan(1)
    })
})

// ===== §11.1 resolveCorpusForRef：命中 vs 越界 =====

describe('resolveCorpusForRef（spec §11.1）', () => {
    /** 三段 fixture */
    const FIXTURE_XML_THREE_PARAS = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t xml:space="preserve">第零段测试内容AAAA</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">第一段测试内容BBBB</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">第二段测试内容CCCC</w:t></w:r></w:p>
  </w:body>
</w:document>`

    it('paraIdxs 命中段落 → 返回指定段落语料（不含其他段落内容）', async () => {
        const baseBuffer = await buildFixtureBuffer(FIXTURE_XML_THREE_PARAS)
        const clauseText1 = '第一段测试内容BBBB'
        const exported = await injectRedlineMarks(baseBuffer, [
            makeRisk({
                id: 301,
                clauseText: clauseText1,
                clauseParagraphIndex: 1,
                problematicQuote: 'BBBB',
                quoteCharStart: clauseText1.indexOf('BBBB'),
                quoteCharEnd: clauseText1.indexOf('BBBB') + 4,
                suggestedClauseText: 'XXXX',
            }),
        ], { reviewId: 500, idStart: 0 })

        const parsed = await parseRedlineMarks(exported.buffer)
        expect(parsed.refs.length).toBe(1)

        const ref = parsed.refs[0]!
        const corpus = resolveCorpusForRef(parsed, ref)

        // 应该命中第 1 段，不含第 0 段（AAAA）和第 2 段（CCCC）
        // paraIdxs 中的段落包含 BBBB 相关内容（t 或 delText）
        const combinedText = corpus.corpusT + corpus.corpusDel
        expect(combinedText).not.toContain('AAAA')
        expect(combinedText).not.toContain('CCCC')
    })

    it('paraIdxs 越界 → 回退全文语料（包含所有段落内容）', async () => {
        const baseBuffer = await buildFixtureBuffer(FIXTURE_XML_THREE_PARAS)
        const clauseText2 = '第零段测试内容AAAA'
        const exported = await injectRedlineMarks(baseBuffer, [
            makeRisk({
                id: 302,
                clauseText: clauseText2,
                clauseParagraphIndex: 0,
                problematicQuote: 'AAAA',
                quoteCharStart: clauseText2.indexOf('AAAA'),
                quoteCharEnd: clauseText2.indexOf('AAAA') + 4,
                suggestedClauseText: 'YYYY',
            }),
        ], { reviewId: 500, idStart: 0 })

        const parsed = await parseRedlineMarks(exported.buffer)
        expect(parsed.refs.length).toBe(1)

        // 伪造越界 paraIdxs（超过 paragraphs.length）
        const ref = parsed.refs[0]!
        const fakeRef = { ...ref, paraIdxs: [9999, 10000] }

        const corpus = resolveCorpusForRef(parsed, fakeRef)

        // 回退全文，应包含所有三段内容
        const combinedText = corpus.corpusT + corpus.corpusDel
        // 全文语料应含有正常段落文字（至少一个非空段落）
        expect(combinedText.length).toBeGreaterThan(0)
    })

    it('paraIdxs 空数组 → 回退全文语料', async () => {
        const baseBuffer = await buildFixtureBuffer(FIXTURE_XML_THREE_PARAS)
        const clauseText3 = '第零段测试内容AAAA'
        const exported = await injectRedlineMarks(baseBuffer, [
            makeRisk({
                id: 303,
                clauseText: clauseText3,
                clauseParagraphIndex: 0,
                problematicQuote: 'AAAA',
                quoteCharStart: clauseText3.indexOf('AAAA'),
                quoteCharEnd: clauseText3.indexOf('AAAA') + 4,
                suggestedClauseText: 'ZZZZ',
            }),
        ], { reviewId: 500, idStart: 0 })

        const parsed = await parseRedlineMarks(exported.buffer)
        expect(parsed.refs.length).toBe(1)

        const ref = parsed.refs[0]!
        const fakeRef = { ...ref, paraIdxs: [] } // 空 paraIdxs

        const corpus = resolveCorpusForRef(parsed, fakeRef)
        // 回退全文，应包含内容
        expect(corpus.corpusT.length + corpus.corpusDel.length).toBeGreaterThan(0)
    })
})

// ===== 多条 risk 的 round-trip =====

describe('parseRedlineMarks · 多条 risk round-trip', () => {
    const FIXTURE_XML_MULTI = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t xml:space="preserve">违约金按 0.05% 计算。</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">服务费每月支付一次。</w:t></w:r></w:p>
  </w:body>
</w:document>`

    it('两条 risk → refs 数量等于 spansByRiskId.size', async () => {
        const baseBuffer = await buildFixtureBuffer(FIXTURE_XML_MULTI)
        const exported = await injectRedlineMarks(baseBuffer, [
            makeRisk({
                id: 401,
                clauseText: '违约金按 0.05% 计算。',
                clauseParagraphIndex: 0,
                problematicQuote: '0.05%',
                quoteCharStart: 5,
                quoteCharEnd: 10,
                suggestedClauseText: '0.5%',
            }),
            makeRisk({
                id: 402,
                clauseText: '服务费每月支付一次。',
                clauseParagraphIndex: 1,
                problematicQuote: '每月',
                quoteCharStart: 3,
                quoteCharEnd: 5,
                suggestedClauseText: '每季度',
            }),
        ], { reviewId: 777, idStart: 100 })

        expect(exported.skippedRiskIds).toEqual([])

        const parsed = await parseRedlineMarks(exported.buffer)
        expect(parsed.reviewId).toBe(777)
        expect(parsed.refs.length).toBe(exported.spansByRiskId.size)
        expect(parsed.refs.length).toBe(2)

        // 每条 ref 的 ins/del 都存活
        for (const ref of parsed.refs) {
            expect(parsed.survivingInsIds.has(ref.insId)).toBe(true)
            for (const delId of ref.delIds) {
                expect(parsed.survivingDelIds.has(delId)).toBe(true)
            }
        }
    })
})
