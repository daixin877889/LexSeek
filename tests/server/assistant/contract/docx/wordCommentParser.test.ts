import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import JSZip from 'jszip'
import { parseWordComments } from '~~/server/services/assistant/contract/docx/wordCommentParser'
import { injectAnnotations } from '~~/server/services/assistant/contract/docx/commentInjector'
import type { ContractAnnotationForExport } from '~~/server/services/assistant/contract/docx/commentInjector'
import { injectComments } from '~~/server/services/assistant/contract/docx/commentInjector'
import { parseContractDocx } from '~~/server/services/assistant/contract/docx/parser'
import type { Risk } from '#shared/types/contract'

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

function makeRisk(index: number, overrides: Partial<Risk> = {}): Risk {
    return {
        id: `r-${index}`,
        clauseIndex: index,
        clauseText: `条款 ${index}`,
        level: 'high',
        category: '测试类别',
        problem: '问题描述',
        analysis: '条款分析内容',
        risk: '法律风险',
        suggestion: '修改建议',
        legalBasis: '《民法典》第 509 条',
        suggestedClauseText: '建议条款',
        ...overrides,
    }
}

describe('parseWordComments', () => {
    it('docx 无 word/comments.xml 时 comments 为空数组，annotationRefsByWId 为空 Map', async () => {
        // labor.docx 原始文件无批注
        const original = await readFile(SAMPLE)
        const { comments, annotationRefsByWId } = await parseWordComments(original)
        expect(comments).toEqual([])
        expect(annotationRefsByWId.size).toBe(0)
    })

    it('注入 3 条 annotation 后解析出 3 条记录', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        const maxIdx = paragraphs.length - 1

        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({ id: 1, anchorParagraphIndex: Math.min(0, maxIdx) }),
            makeAnnotation({ id: 2, anchorParagraphIndex: Math.min(1, maxIdx) }),
            makeAnnotation({ id: 3, anchorParagraphIndex: Math.min(2, maxIdx) }),
        ]

        const { buffer } = await injectAnnotations(original, annotations)
        const { comments } = await parseWordComments(buffer)
        expect(comments).toHaveLength(3)
    })

    it('wId 从 0 连续递增', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        const maxIdx = paragraphs.length - 1

        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({ id: 1, anchorParagraphIndex: Math.min(1, maxIdx) }),
            makeAnnotation({ id: 2, anchorParagraphIndex: Math.min(2, maxIdx) }),
        ]

        const { buffer } = await injectAnnotations(original, annotations)
        const { comments } = await parseWordComments(buffer)

        const ids = comments.map(c => c.wId).sort((a, b) => a - b)
        expect(ids).toEqual([0, 1])
    })

    it('wAuthor 含 LS: 前缀 + [#id-rand8] 稳定身份证（Phase C）', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        const maxIdx = paragraphs.length - 1

        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({ id: 1, authorName: '张律师', anchorParagraphIndex: Math.min(1, maxIdx) }),
        ]

        const { buffer } = await injectAnnotations(original, annotations)
        const { comments } = await parseWordComments(buffer)

        expect(comments[0].wAuthor).toMatch(/^LS:张律师 \[#1-[a-zA-Z0-9]{8}\]$/)
    })

    it('wInitials 为 LEXSEEK 格式时原样返回', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        const maxIdx = paragraphs.length - 1

        const existingRef = 'LEXSEEK-42-ab12cd34'
        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({ id: 42, wordCommentRef: existingRef, anchorParagraphIndex: Math.min(1, maxIdx) }),
        ]

        const { buffer } = await injectAnnotations(original, annotations)
        const { comments } = await parseWordComments(buffer)

        expect(comments[0].wInitials).toBe(existingRef)
    })

    it('答复批注 parentAnnotationId 非空时 parentWId 正确', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        const maxIdx = paragraphs.length - 1
        const idx = Math.min(1, maxIdx)

        // id=1 对应 w:id=0，id=2 对应 w:id=1，parentAnnotationId=1 → parentWId=0
        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({ id: 1, anchorParagraphIndex: idx }),
            makeAnnotation({ id: 2, parentAnnotationId: 1, anchorParagraphIndex: idx }),
        ]

        const { buffer } = await injectAnnotations(original, annotations)
        const { comments } = await parseWordComments(buffer)

        const reply = comments.find(c => c.wId === 1)
        expect(reply).toBeDefined()
        expect(reply?.parentWId).toBe(0)
    })

    it('无 parentId 时 parentWId 为 null', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        const maxIdx = paragraphs.length - 1

        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({ id: 1, anchorParagraphIndex: Math.min(1, maxIdx) }),
        ]

        const { buffer } = await injectAnnotations(original, annotations)
        const { comments } = await parseWordComments(buffer)

        expect(comments[0].parentWId).toBeNull()
    })

    it('content 正确提取批注文本', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        const maxIdx = paragraphs.length - 1

        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({ id: 1, content: '这是批注正文', anchorParagraphIndex: Math.min(1, maxIdx) }),
        ]

        const { buffer } = await injectAnnotations(original, annotations)
        const { comments } = await parseWordComments(buffer)

        expect(comments[0].content).toBe('这是批注正文')
    })

    it('多段落内容（injectComments 五模块格式）用 \\n 分隔', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        const maxIdx = paragraphs.length - 1

        const risk = makeRisk(Math.min(2, maxIdx), { legalBasis: undefined })
        const { buffer } = await injectComments(original, [risk])
        const { comments } = await parseWordComments(buffer)

        expect(comments).toHaveLength(1)
        // 五模块内容必须包含换行
        expect(comments[0].content).toContain('\n')
        expect(comments[0].content).toContain('【条款分析】')
        expect(comments[0].content).toContain('【修改建议】')
    })

    it('含特殊字符的 content XML 转义后可正确解码', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        const maxIdx = paragraphs.length - 1

        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({
                id: 1,
                content: '条款 "A" 与 <B> 冲突 & 引号 \'单引号\'',
                anchorParagraphIndex: Math.min(1, maxIdx),
            }),
        ]

        const { buffer } = await injectAnnotations(original, annotations)
        const { comments } = await parseWordComments(buffer)

        expect(comments[0].content).toBe('条款 "A" 与 <B> 冲突 & 引号 \'单引号\'')
    })

    it('dateIso 正确提取（ISO 格式字符串）', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        const maxIdx = paragraphs.length - 1

        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({ id: 1, anchorParagraphIndex: Math.min(1, maxIdx) }),
        ]

        const { buffer } = await injectAnnotations(original, annotations)
        const { comments } = await parseWordComments(buffer)

        expect(comments[0].dateIso).not.toBeNull()
        // ISO 8601 格式
        expect(comments[0].dateIso).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    it('无 w:initials 属性时 wInitials 为空字符串', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        const maxIdx = paragraphs.length - 1

        // injectComments（旧 API）不写 w:initials
        const risk = makeRisk(Math.min(1, maxIdx))
        const { buffer } = await injectComments(original, [risk])
        const { comments } = await parseWordComments(buffer)

        expect(comments[0].wInitials).toBe('')
    })

    // ============ annotationRefsByWId：从 wInitials 派生 ============

    it('injectAnnotations 注入后 annotationRefsByWId 非空，wId 正确映射到 annotationId', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        const maxIdx = paragraphs.length - 1

        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({ id: 325, wordCommentRef: 'LEXSEEK-325-a3f9b2c1', anchorParagraphIndex: Math.min(1, maxIdx) }),
            makeAnnotation({ id: 297, wordCommentRef: 'LEXSEEK-297-k8f2m9d4', anchorParagraphIndex: Math.min(2, maxIdx) }),
            makeAnnotation({ id: 284, wordCommentRef: 'LEXSEEK-284-x1y7q3r8', anchorParagraphIndex: Math.min(3, maxIdx) }),
        ]

        const { buffer } = await injectAnnotations(original, annotations)
        const { annotationRefsByWId } = await parseWordComments(buffer)

        // 三条 annotation 应都能通过 wId 查到对应的 annotationId（Phase C：从 w:author 解析）
        expect(annotationRefsByWId.size).toBe(3)
        expect(annotationRefsByWId.get(0)?.annotationId).toBe(325)
        expect(annotationRefsByWId.get(1)?.annotationId).toBe(297)
        expect(annotationRefsByWId.get(2)?.annotationId).toBe(284)
        // ref 字段现在是 w:author 的完整值（含 [#id-rand8]），不是 LEXSEEK 字面量
        expect(annotationRefsByWId.get(0)?.ref).toMatch(/\[#325-a3f9b2c1\]$/)
    })

    it('不含 customXml 的旧格式 docx → annotationRefsByWId 为空 Map，不抛错', async () => {
        // 用最小 docx 构造：只有 comments.xml，没有 customXml/annotationRefs.xml
        const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>测试段落</w:t></w:r></w:p></w:body></w:document>`
        const commentsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="0" w:author="LS:AI" w:initials="LEXSEEK-1" w:date="2026-01-01T00:00:00Z"><w:p><w:r><w:t>旧格式批注</w:t></w:r></w:p></w:comment></w:comments>`

        const zip = new JSZip()
        zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>`)
        zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`)
        zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`)
        zip.file('word/document.xml', docXml)
        zip.file('word/comments.xml', commentsXml)
        const docxBuffer = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }))

        // 不应抛错，annotationRefsByWId 为空 Map
        const { comments, annotationRefsByWId } = await parseWordComments(docxBuffer)
        expect(comments).toHaveLength(1)
        expect(annotationRefsByWId.size).toBe(0)
    })

    it('annotationId 42 的 ref 从 w:author [#42-xxx] 正确取回（Phase C 主通路）', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        const maxIdx = paragraphs.length - 1

        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({ id: 42, wordCommentRef: 'LEXSEEK-42-abc12345', anchorParagraphIndex: Math.min(1, maxIdx) }),
        ]

        const { buffer } = await injectAnnotations(original, annotations)
        const { annotationRefsByWId } = await parseWordComments(buffer)

        expect(annotationRefsByWId.get(0)?.annotationId).toBe(42)
        expect(annotationRefsByWId.get(0)?.ref).toMatch(/\[#42-abc12345\]$/)
    })

    it('Word 截断 w:initials 为 "LEXSEEK-3" 时仍能从 w:author 恢复 annotationId', async () => {
        // 模拟 Microsoft Word 保存后的 docx：
        // - 所有 LS:* 作者的 w:initials 都被统一截断为第一条 ID 对应的字符串
        // - w:author 完整保留（含 [#id-rand8]）
        const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>条款一</w:t></w:r></w:p><w:p><w:r><w:t>条款二</w:t></w:r></w:p></w:body></w:document>`
        const commentsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="0" w:author="LS:AI [#101-ab12cd34]" w:initials="LEXSEEK-3" w:date="2026-01-01T00:00:00Z"><w:p><w:r><w:t>AI 意见一</w:t></w:r></w:p></w:comment><w:comment w:id="1" w:author="LS:律师 [#205-xy98ab7c]" w:initials="LEXSEEK-3" w:date="2026-01-01T00:00:00Z"><w:p><w:r><w:t>律师意见</w:t></w:r></w:p></w:comment></w:comments>`

        const zip = new JSZip()
        zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>`)
        zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`)
        zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`)
        zip.file('word/document.xml', docXml)
        zip.file('word/comments.xml', commentsXml)
        const docxBuffer = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }))

        const { annotationRefsByWId } = await parseWordComments(docxBuffer)
        expect(annotationRefsByWId.size).toBe(2)
        expect(annotationRefsByWId.get(0)?.annotationId).toBe(101)
        expect(annotationRefsByWId.get(1)?.annotationId).toBe(205)
    })
})
