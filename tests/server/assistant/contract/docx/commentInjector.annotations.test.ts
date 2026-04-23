import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { injectAnnotations } from '~~/server/services/assistant/contract/docx/commentInjector'
import type { ContractAnnotationForExport } from '~~/server/services/assistant/contract/docx/commentInjector'
import { loadDocxZip, readTextFromZip } from '~~/server/services/assistant/contract/docx/zipRewriter'
import { parseWordCommentRef } from '~~/server/services/assistant/contract/utils/wordCommentRef'
import { parseContractDocx } from '~~/server/services/assistant/contract/docx/parser'

const SAMPLE = join(__dirname, '../../../../../prisma/seeds/contract-samples/labor.docx')

function makeAnnotation(
    overrides: Partial<ContractAnnotationForExport> & { id: number },
): ContractAnnotationForExport {
    return {
        riskId: 10,
        authorType: 'ai',
        authorName: 'AI',
        content: '审查意见内容',
        parentAnnotationId: null,
        anchorQuote: '条款原文',
        anchorParagraphIndex: 1,
        wordCommentRef: null,
        ...overrides,
    }
}

describe('injectAnnotations', () => {
    it('空数组时移除 word/comments.xml，返回空 refsByAnnotationId', async () => {
        const original = await readFile(SAMPLE)
        const { buffer, refsByAnnotationId } = await injectAnnotations(original, [])
        const zip = await loadDocxZip(buffer)
        expect(zip.file('word/comments.xml')).toBeNull()
        expect(refsByAnnotationId.size).toBe(0)
    })

    it('注入 3 条 annotation 后 comments.xml 含 3 个 w:comment', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)

        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({ id: 1, authorType: 'ai', authorName: 'AI', content: 'AI 审查意见：违约金过高', anchorParagraphIndex: Math.min(0, paragraphs.length - 1) }),
            makeAnnotation({ id: 2, authorType: 'lawyer', authorName: '张律师', content: '下调到 10%', parentAnnotationId: 1, anchorParagraphIndex: Math.min(0, paragraphs.length - 1) }),
            makeAnnotation({ id: 3, riskId: 20, authorType: 'external', authorName: '客户甲', content: '管辖法院改深圳', anchorParagraphIndex: Math.min(1, paragraphs.length - 1) }),
        ]

        const { buffer, refsByAnnotationId } = await injectAnnotations(original, annotations)
        expect(refsByAnnotationId.size).toBe(3)

        const zip = await loadDocxZip(buffer)
        const commentsXml = await readTextFromZip(zip, 'word/comments.xml')
        const matches = commentsXml.match(/<w:comment\s/g) ?? []
        expect(matches.length).toBe(3)
    })

    it('w:initials 全部符合 LEXSEEK 格式，parseWordCommentRef 能提取 annotationId', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)

        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({ id: 1, anchorParagraphIndex: Math.min(1, paragraphs.length - 1) }),
            makeAnnotation({ id: 2, anchorParagraphIndex: Math.min(2, paragraphs.length - 1) }),
        ]

        const { refsByAnnotationId } = await injectAnnotations(original, annotations)
        for (const [id, ref] of refsByAnnotationId) {
            const parsed = parseWordCommentRef(ref)
            expect(parsed).not.toBeNull()
            expect(parsed?.annotationId).toBe(id)
        }
    })

    it('w:author 带 LS: 前缀，authorName 正确写入', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)

        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({ id: 1, authorType: 'ai', authorName: 'AI', anchorParagraphIndex: Math.min(1, paragraphs.length - 1) }),
            makeAnnotation({ id: 2, authorType: 'lawyer', authorName: '张律师', anchorParagraphIndex: Math.min(1, paragraphs.length - 1) }),
            makeAnnotation({ id: 3, authorType: 'external', authorName: '客户甲', anchorParagraphIndex: Math.min(2, paragraphs.length - 1) }),
        ]

        const { buffer } = await injectAnnotations(original, annotations)
        const zip = await loadDocxZip(buffer)
        const commentsXml = await readTextFromZip(zip, 'word/comments.xml')

        expect(commentsXml).toContain('w:author="LS:AI"')
        expect(commentsXml).toContain('w:author="LS:张律师"')
        expect(commentsXml).toContain('w:author="LS:客户甲"')
    })

    it('答复批注写入 w:parentId 引用父 w:id', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)

        const idx = Math.min(1, paragraphs.length - 1)
        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({ id: 1, authorName: 'AI', anchorParagraphIndex: idx }),
            makeAnnotation({ id: 2, authorName: '张律师', parentAnnotationId: 1, anchorParagraphIndex: idx }),
        ]

        const { buffer } = await injectAnnotations(original, annotations)
        const zip = await loadDocxZip(buffer)
        const commentsXml = await readTextFromZip(zip, 'word/comments.xml')

        // id=2 的 annotation 对应 w:id="1"（0-indexed），其父 id=1 对应 w:id="0"
        expect(commentsXml).toMatch(/w:parentId="0"/)
    })

    it('已有 wordCommentRef 的 annotation 沿用原值不新生成', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)

        const existingRef = 'LEXSEEK-99-abc12345'
        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({ id: 99, wordCommentRef: existingRef, anchorParagraphIndex: Math.min(1, paragraphs.length - 1) }),
        ]

        const { refsByAnnotationId } = await injectAnnotations(original, annotations)
        expect(refsByAnnotationId.get(99)).toBe(existingRef)
    })

    it('anchorParagraphIndex 越界时跳过 document.xml 注入，但 refsByAnnotationId 仍包含该 annotation', async () => {
        const original = await readFile(SAMPLE)

        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({ id: 1, anchorParagraphIndex: 1 }),
            makeAnnotation({ id: 2, anchorParagraphIndex: 99999 }),
        ]

        const { buffer, refsByAnnotationId } = await injectAnnotations(original, annotations)
        // 两条都应在 refsByAnnotationId（方便回写 DB）
        expect(refsByAnnotationId.size).toBe(2)

        const zip = await loadDocxZip(buffer)
        const commentsXml = await readTextFromZip(zip, 'word/comments.xml')
        // comments.xml 包含全部（越界的也写进去，只是 document.xml 里没有 range marker）
        const matches = commentsXml.match(/<w:comment\s/g) ?? []
        expect(matches.length).toBe(2)

        // document.xml 只有 id=0（未越界的 annotation 1 对应 w:id=0）
        const docXml = await readTextFromZip(zip, 'word/document.xml')
        expect(docXml).toContain('w:id="0"')
        // 越界的 id=1（对应 annotation 2）不应插入 range marker
        // 用 commentRangeStart 检验：只有 1 个
        const rangeMatches = docXml.match(/<w:commentRangeStart\s/g) ?? []
        expect(rangeMatches.length).toBe(1)
    })

    it('[Content_Types].xml 和 rels 含 comments 注册项', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)

        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({ id: 1, anchorParagraphIndex: Math.min(1, paragraphs.length - 1) }),
        ]

        const { buffer } = await injectAnnotations(original, annotations)
        const zip = await loadDocxZip(buffer)

        const types = await readTextFromZip(zip, '[Content_Types].xml')
        expect(types).toContain('PartName="/word/comments.xml"')

        const rels = await readTextFromZip(zip, 'word/_rels/document.xml.rels')
        expect(rels).toContain('Target="comments.xml"')
    })

    it('内容含特殊字符时正常 XML 转义', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)

        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({
                id: 1,
                content: '条款 "A" 与 <B> 冲突 & 引号 \'单引号\'',
                anchorParagraphIndex: Math.min(1, paragraphs.length - 1),
            }),
        ]

        const { buffer } = await injectAnnotations(original, annotations)
        const zip = await loadDocxZip(buffer)
        const commentsXml = await readTextFromZip(zip, 'word/comments.xml')

        expect(commentsXml).toContain('&quot;A&quot;')
        expect(commentsXml).toContain('&lt;B&gt;')
        expect(commentsXml).toContain('&amp;')
        expect(commentsXml).toContain('&apos;单引号&apos;')
    })
})
