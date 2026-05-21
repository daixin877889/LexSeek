/**
 * comment 导出文件安全性测试（批次二 · 文件损坏类）
 *
 * - M16：findMaxSharedIdInDocx 扫描所有 w:id 共享池 part（含 header/footer/comments）
 * - S2：comment 模式不传 idStart 时自动避开原文档既有 w:id，不撞车
 * - S3：批注内容/作者含非法 XML 字符时写入 comments.xml 前被剥除
 *
 * **Validates: 合同审查审计修复 S2 / S3 / M16**
 */
import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import JSZip from 'jszip'
import { injectAnnotations } from '~~/server/agents/contract/docx/commentInjector'
import type { ContractAnnotationForExport } from '~~/server/agents/contract/docx/commentInjector'
import { loadDocxZip, readTextFromZip, findMaxSharedIdInDocx } from '~~/server/agents/contract/docx/zipRewriter'

const SAMPLE = join(__dirname, '../../../../../prisma/seeds/contract-samples/labor.docx')

/** 非法 XML 1.0 控制字符正则（写进 docx 会让 Word 拒绝打开）；用字符串构造避免源码含控制字符 */
const ILLEGAL_XML_RE = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]')
const BACKSPACE = String.fromCharCode(8)   // U+0008 退格
const ESC = String.fromCharCode(27)        // U+001B ESC

function makeAnnotation(over: Partial<ContractAnnotationForExport> & { id: number }): ContractAnnotationForExport {
    return {
        riskId: 10,
        authorType: 'ai',
        authorName: 'AI',
        content: '审查意见内容',
        parentAnnotationId: null,
        anchorQuote: '条款原文',
        anchorParagraphIndex: 0,
        wordCommentRef: null,
        ...over,
    }
}

describe('M16：findMaxSharedIdInDocx 多 part 扫描', () => {
    it('取 document / header / comments 等 part 里的全局最大 w:id', async () => {
        const zip = new JSZip()
        zip.file('word/document.xml', '<w:document><w:body><w:bookmarkStart w:id="3"/></w:body></w:document>')
        zip.file('word/header1.xml', '<w:hdr><w:bookmarkStart w:id="99"/></w:hdr>')
        zip.file('word/comments.xml', '<w:comments><w:comment w:id="50"/></w:comments>')
        // 非 w:id 共享池 part 不参与
        zip.file('word/styles.xml', '<w:styles><w:foo w:id="9999"/></w:styles>')
        expect(await findMaxSharedIdInDocx(zip)).toBe(99)
    })

    it('只看 document.xml 会漏掉 header 里更大的 w:id → 多 part 扫描覆盖', async () => {
        const zip = new JSZip()
        zip.file('word/document.xml', '<w:document><w:body><w:bookmarkStart w:id="2"/></w:body></w:document>')
        zip.file('word/header2.xml', '<w:hdr><w:bookmarkStart w:id="71"/></w:hdr>')
        expect(await findMaxSharedIdInDocx(zip)).toBe(71)
    })
})

describe('S2：comment 模式 idStart 自动避让', () => {
    it('不传 idStart → 注入的 commentRange w:id 不与原文档既有 w:id 撞车', async () => {
        const original = await readFile(SAMPLE)
        const maxBefore = await findMaxSharedIdInDocx(await loadDocxZip(original))
        const { buffer } = await injectAnnotations(original, [makeAnnotation({ id: 1 })], 999)
        const docXml = await readTextFromZip(await loadDocxZip(buffer), 'word/document.xml')
        const m = docXml.match(/<w:commentRangeStart[^>]*w:id="(\d+)"/)
        expect(m).not.toBeNull()
        // 注入的 commentRange w:id 必须 > 原文档既有 w:id 池上限（旧实现从 0 起会撞车）
        expect(Number(m![1])).toBeGreaterThan(maxBefore)
    })
})

describe('M14：comment 导出保留原文档原生批注', () => {
    it('base 已带批注（视作原生）→ 再次 comment 注入保留它、不抛错、合并两条', async () => {
        const original = await readFile(SAMPLE)
        // 第一次注入产出"已带 1 条批注"的 docx——第二次注入时它就是 base 里的原生批注
        const first = await injectAnnotations(original, [makeAnnotation({ id: 1, content: '第一条批注' })], 999)
        // 第二次注入到带批注的 docx 上：旧实现整体覆盖 comments.xml 会丢第一条、
        // 且 document.xml 残留其 commentRange 致 assertCommentIntegrity 抛错
        const second = await injectAnnotations(first.buffer, [makeAnnotation({ id: 2, content: '第二条批注' })], 999)
        const commentsXml = await readTextFromZip(await loadDocxZip(second.buffer), 'word/comments.xml')
        // 两条批注都在（base 里的没被覆盖丢失），且导出未抛错
        const count = (commentsXml.match(/<w:comment\s/g) ?? []).length
        expect(count).toBe(2)
        expect(commentsXml).toContain('第一条批注')
        expect(commentsXml).toContain('第二条批注')
    })
})

describe('S3：批注非法 XML 字符剥除', () => {
    it('content / authorName 含非法控制字符 → comments.xml 不含非法字符', async () => {
        const original = await readFile(SAMPLE)
        const ann = makeAnnotation({
            id: 1,
            content: `正常审查意见${BACKSPACE}带退格${ESC}带ESC`,
            authorType: 'lawyer',
            authorName: `张律师${BACKSPACE}`,
        })
        const { buffer } = await injectAnnotations(original, [ann], 999)
        const commentsXml = await readTextFromZip(await loadDocxZip(buffer), 'word/comments.xml')
        // 非法控制字符不得出现（否则 Word 拒绝打开）
        expect(ILLEGAL_XML_RE.test(commentsXml)).toBe(false)
        // 正常文字保留
        expect(commentsXml).toContain('正常审查意见')
        expect(commentsXml).toContain('带退格')
    })
})
