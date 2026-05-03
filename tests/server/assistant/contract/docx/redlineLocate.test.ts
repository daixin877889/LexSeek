import { describe, it, expect } from 'vitest'
import {
    parseOoxml,
    collectNonEmptyParagraphs,
} from '~~/server/agents/contract/docx/xmlAst'
import { locateQuoteInParagraphs } from '~~/server/agents/contract/docx/redlineLocate'

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

function makeDoc(...paragraphsXml: string[]): ReturnType<typeof collectNonEmptyParagraphs> {
    const xml = `<?xml version="1.0"?><w:document ${W_NS}><w:body>${paragraphsXml.join('')}</w:body></w:document>`
    return collectNonEmptyParagraphs(parseOoxml(xml))
}

describe('locateQuoteInParagraphs', () => {
    it('单 run 内的 quote：起止 runIdx 相同', () => {
        const paragraphs = makeDoc(
            '<w:p><w:r><w:t>违约金按 0.05% 计算。</w:t></w:r></w:p>',
        )
        const loc = locateQuoteInParagraphs({
            nonEmptyParagraphs: paragraphs,
            clauseText: '违约金按 0.05% 计算。',
            clauseParagraphIndex: 0,
            quoteCharStart: 5, // "0.05%"
            quoteCharEnd: 10,
        })
        expect(loc).not.toBeNull()
        expect(loc!.startParaIdx).toBe(0)
        expect(loc!.endParaIdx).toBe(0)
        expect(loc!.splits).toHaveLength(1)
        expect(loc!.splits[0]!.runSplit).toEqual({
            startRunIdx: 0,
            startRunOffset: 5,
            endRunIdx: 0,
            endRunOffset: 10,
        })
    })

    it('跨多 run 的 quote：起止 runIdx 不同', () => {
        const paragraphs = makeDoc(
            '<w:p>'
            + '<w:r><w:rPr><w:b/></w:rPr><w:t>违约金</w:t></w:r>'
            + '<w:r><w:t>按月底支付，逾期每日加收 </w:t></w:r>'
            + '<w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t>0.05%</w:t></w:r>'
            + '<w:r><w:t> 滞纳金。</w:t></w:r>'
            + '</w:p>',
        )
        // clauseText = "违约金按月底支付，逾期每日加收 0.05% 滞纳金。"
        // quote 取 "0.05%"（"违约金按月底支付，逾期每日加收 ".length = 16 字符）
        const loc = locateQuoteInParagraphs({
            nonEmptyParagraphs: paragraphs,
            clauseText: '违约金按月底支付，逾期每日加收 0.05% 滞纳金。',
            clauseParagraphIndex: 0,
            quoteCharStart: 16,
            quoteCharEnd: 21,
        })
        expect(loc).not.toBeNull()
        expect(loc!.splits[0]!.runSplit).toEqual({
            startRunIdx: 2,
            startRunOffset: 0,
            endRunIdx: 2,
            endRunOffset: 5,
        })
    })

    it('quote 跨 run 起止：拆两个 run', () => {
        const paragraphs = makeDoc(
            '<w:p>'
            + '<w:r><w:t>违约金按月底</w:t></w:r>'
            + '<w:r><w:t>支付</w:t></w:r>'
            + '</w:p>',
        )
        // clauseText = "违约金按月底支付"
        // quote = "月底支" (offset 4..7)：起 run0 内 offset 4，止 run1 内 offset 1
        const loc = locateQuoteInParagraphs({
            nonEmptyParagraphs: paragraphs,
            clauseText: '违约金按月底支付',
            clauseParagraphIndex: 0,
            quoteCharStart: 4,
            quoteCharEnd: 7,
        })
        expect(loc).not.toBeNull()
        expect(loc!.splits[0]!.runSplit).toEqual({
            startRunIdx: 0,
            startRunOffset: 4,
            endRunIdx: 1,
            endRunOffset: 1,
        })
    })

    it('quote 终点恰好落在 run 边界 → 落到能容纳的第一个 run 末尾', () => {
        const paragraphs = makeDoc(
            '<w:p>'
            + '<w:r><w:t>违约金按月底</w:t></w:r>'
            + '<w:r><w:t>支付</w:t></w:r>'
            + '</w:p>',
        )
        // quote = "按月底" (offset 3..6)，终点 6 == run0 末尾 = run1 起点的边界
        const loc = locateQuoteInParagraphs({
            nonEmptyParagraphs: paragraphs,
            clauseText: '违约金按月底支付',
            clauseParagraphIndex: 0,
            quoteCharStart: 3,
            quoteCharEnd: 6,
        })
        expect(loc).not.toBeNull()
        expect(loc!.splits[0]!.runSplit).toEqual({
            startRunIdx: 0,
            startRunOffset: 3,
            endRunIdx: 0,
            endRunOffset: 6,
        })
    })

    it('quote 跨多段（clauseText 含 \\n）', () => {
        const paragraphs = makeDoc(
            '<w:p><w:r><w:t>第一行内容</w:t></w:r></w:p>',
            '<w:p><w:r><w:t>第二行内容</w:t></w:r></w:p>',
        )
        // clauseText = "第一行内容\n第二行内容"，长度 11（\n 占 1）
        // quote = "内容\n第二" (offset 3..8)
        const loc = locateQuoteInParagraphs({
            nonEmptyParagraphs: paragraphs,
            clauseText: '第一行内容\n第二行内容',
            clauseParagraphIndex: 0,
            quoteCharStart: 3,
            quoteCharEnd: 8,
        })
        expect(loc).not.toBeNull()
        expect(loc!.startParaIdx).toBe(0)
        expect(loc!.endParaIdx).toBe(1)
        expect(loc!.splits).toHaveLength(2)
        expect(loc!.splits[0]!.runSplit).toEqual({
            startRunIdx: 0,
            startRunOffset: 3,
            endRunIdx: 0,
            endRunOffset: 5, // 第一行末尾
        })
        expect(loc!.splits[1]!.runSplit).toEqual({
            startRunIdx: 0,
            startRunOffset: 0,
            endRunIdx: 0,
            endRunOffset: 2, // "第二"
        })
    })

    it('clauseParagraphIndex 越界 → 返回 null', () => {
        const paragraphs = makeDoc('<w:p><w:r><w:t>foo</w:t></w:r></w:p>')
        const loc = locateQuoteInParagraphs({
            nonEmptyParagraphs: paragraphs,
            clauseText: 'foo',
            clauseParagraphIndex: 5,
            quoteCharStart: 0,
            quoteCharEnd: 3,
        })
        expect(loc).toBeNull()
    })

    it('quote 范围越出 clauseText → 返回 null', () => {
        const paragraphs = makeDoc('<w:p><w:r><w:t>foo</w:t></w:r></w:p>')
        const loc = locateQuoteInParagraphs({
            nonEmptyParagraphs: paragraphs,
            clauseText: 'foo',
            clauseParagraphIndex: 0,
            quoteCharStart: 1,
            quoteCharEnd: 99,
        })
        expect(loc).toBeNull()
    })

    it('段落 textContent 不含 quote 字符段 → 返回 null', () => {
        // clauseText 与 OOXML 段落 textContent 不一致（罕见迁移残留），定位失败返回 null
        const paragraphs = makeDoc('<w:p><w:r><w:t>合同正文 A</w:t></w:r></w:p>')
        const loc = locateQuoteInParagraphs({
            nonEmptyParagraphs: paragraphs,
            clauseText: '合同正文 B', // 与段落 textContent "合同正文 A" 不一致
            clauseParagraphIndex: 0,
            quoteCharStart: 0,
            quoteCharEnd: 3,
        })
        expect(loc).toBeNull()
    })

    it('w:tab 视作 1 字符', () => {
        const paragraphs = makeDoc(
            '<w:p>'
            + '<w:r><w:t>前</w:t><w:tab/><w:t>后</w:t></w:r>'
            + '</w:p>',
        )
        // textContent = "前\t后" (3 字符)；clauseText 同；quote = "\t后" (offset 1..3)
        const loc = locateQuoteInParagraphs({
            nonEmptyParagraphs: paragraphs,
            clauseText: '前\t后',
            clauseParagraphIndex: 0,
            quoteCharStart: 1,
            quoteCharEnd: 3,
        })
        expect(loc).not.toBeNull()
        expect(loc!.splits[0]!.runSplit).toEqual({
            startRunIdx: 0,
            startRunOffset: 1,
            endRunIdx: 0,
            endRunOffset: 3,
        })
    })
})
