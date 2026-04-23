import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import JSZip from 'jszip'
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

    it('anchorQuote 定位优先于 anchorParagraphIndex：批注标记插入 anchorQuote 所在段落而非第 0 个段落', async () => {
        // 手工构造三段落 docx：段落 0="甲方义务条款"、段落 1="第一条 乙方应当履行"、段落 2="乙方权利事项"
        const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
            `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
            `<w:body>` +
            `<w:p><w:r><w:t>甲方义务条款</w:t></w:r></w:p>` +
            `<w:p><w:r><w:t>第一条 乙方应当履行</w:t></w:r></w:p>` +
            `<w:p><w:r><w:t>乙方权利事项</w:t></w:r></w:p>` +
            `</w:body></w:document>`

        const zip = new JSZip()
        zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`)
        zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`)
        zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`)
        zip.file('word/document.xml', docXml)
        const docxBuffer = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }))

        // anchorParagraphIndex=0（错误），anchorQuote='第一条'（正确，应定位到段落 1）
        const annotation: ContractAnnotationForExport = makeAnnotation({
            id: 1,
            anchorQuote: '第一条',
            anchorParagraphIndex: 0,
        })

        const { buffer: result } = await injectAnnotations(docxBuffer, [annotation])
        const resultZip = await loadDocxZip(result)
        const resultDocXml = await readTextFromZip(resultZip, 'word/document.xml')

        // 分割所有 <w:p>...</w:p> 段落，找到含 commentRangeStart 的那一个
        const allParas = resultDocXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? []
        const paraWithRange = allParas.find(p => p.includes('<w:commentRangeStart'))
        expect(paraWithRange).not.toBeUndefined()
        // 该段落必须包含 "第一条"，不能是 "甲方义务条款"
        expect(paraWithRange!).toContain('第一条')
        expect(paraWithRange!).not.toContain('甲方义务条款')
    })

    it('anchorQuote 含多行内容（\\n 分隔）时，取首行定位段落——模拟 Phase B 条款完整内容形态', async () => {
        // 构造 3 段落 docx：
        //   段落 0 = "合同编号 ABC-001"
        //   段落 1 = "第一条 合同期限与试用期"（条款标题行）
        //   段落 2 = "第二条 工作内容与职位"
        const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
            `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
            `<w:body>` +
            `<w:p><w:r><w:t>合同编号 ABC-001</w:t></w:r></w:p>` +
            `<w:p><w:r><w:t>第一条 合同期限与试用期</w:t></w:r></w:p>` +
            `<w:p><w:r><w:t>第二条 工作内容与职位</w:t></w:r></w:p>` +
            `</w:body></w:document>`

        const zip = new JSZip()
        zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`)
        zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`)
        zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`)
        zip.file('word/document.xml', docXml)
        const docxBuffer = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }))

        // Phase B 真实形态：anchor_quote 是条款完整内容，多段落用 \n 拼接
        // anchorParagraphIndex=0 故意填错，期望 anchorQuote 首行 "第一条 合同期限与试用期" 命中段落 1
        const multiLineQuote = '第一条 合同期限与试用期\n合同期限：本合同期限为 3年，自 2026年2月18日起算\n试用期：试用期为 6个月'
        const annotation: ContractAnnotationForExport = makeAnnotation({
            id: 1,
            anchorQuote: multiLineQuote,
            anchorParagraphIndex: 0, // 故意填错
        })

        const { buffer: result } = await injectAnnotations(docxBuffer, [annotation])
        const resultZip = await loadDocxZip(result)
        const resultDocXml = await readTextFromZip(resultZip, 'word/document.xml')

        // 找到含 commentRangeStart 的段落
        const allParas = resultDocXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? []
        const paraWithRange = allParas.find(p => p.includes('<w:commentRangeStart'))
        expect(paraWithRange).not.toBeUndefined()

        // 必须挂在"第一条 合同期限与试用期"段落，而不是"合同编号 ABC-001"段落
        expect(paraWithRange!).toContain('第一条 合同期限与试用期')
        expect(paraWithRange!).not.toContain('合同编号 ABC-001')
    })
})
