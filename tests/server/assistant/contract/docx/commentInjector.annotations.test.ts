import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import JSZip from 'jszip'
import { injectAnnotations } from '~~/server/agents/contract/docx/commentInjector'
import type { ContractAnnotationForExport } from '~~/server/agents/contract/docx/commentInjector'
import { loadDocxZip, readTextFromZip } from '~~/server/agents/contract/docx/zipRewriter'
import { parseWordCommentRef } from '~~/server/agents/contract/utils/wordCommentRef'
import { parseContractDocx } from '~~/server/agents/contract/docx/parser'

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
    it('空数组时移除 word/comments.xml 并清理 [Content_Types].xml 和 rels 中的注册项，返回空 refsByAnnotationId', async () => {
        const original = await readFile(SAMPLE)
        const { buffer, refsByAnnotationId } = await injectAnnotations(original, [], 999)
        const zip = await loadDocxZip(buffer)
        expect(zip.file('word/comments.xml')).toBeNull()
        expect(refsByAnnotationId.size).toBe(0)

        // [Content_Types].xml 中不应有 comments.xml 的 Override（否则 Word 会找不到文件而报错）
        const types = await readTextFromZip(zip, '[Content_Types].xml')
        expect(types).not.toContain('PartName="/word/comments.xml"')

        // _rels 中不应有 comments.xml 的 Relationship
        const rels = await readTextFromZip(zip, 'word/_rels/document.xml.rels')
        expect(rels).not.toContain('Target="comments.xml"')
    })

    it('注入 3 条 annotation 后 comments.xml 含 3 个 w:comment', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)

        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({ id: 1, authorType: 'ai', authorName: 'AI', content: 'AI 审查意见：违约金过高', anchorParagraphIndex: Math.min(0, paragraphs.length - 1) }),
            makeAnnotation({ id: 2, authorType: 'lawyer', authorName: '张律师', content: '下调到 10%', parentAnnotationId: 1, anchorParagraphIndex: Math.min(0, paragraphs.length - 1) }),
            makeAnnotation({ id: 3, riskId: 20, authorType: 'external', authorName: '客户甲', content: '管辖法院改深圳', anchorParagraphIndex: Math.min(1, paragraphs.length - 1) }),
        ]

        const { buffer, refsByAnnotationId } = await injectAnnotations(original, annotations, 999)
        expect(refsByAnnotationId.size).toBe(3)

        const zip = await loadDocxZip(buffer)
        const commentsXml = await readTextFromZip(zip, 'word/comments.xml')
        const matches = commentsXml.match(/<w:comment\s/g) ?? []
        expect(matches.length).toBe(3)
    })

    it('DB 存储用的 wordCommentRef 字面量格式为 LEXSEEK-{id}-{rand8}', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)

        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({ id: 1, anchorParagraphIndex: Math.min(1, paragraphs.length - 1) }),
            makeAnnotation({ id: 2, anchorParagraphIndex: Math.min(2, paragraphs.length - 1) }),
        ]

        const { refsByAnnotationId } = await injectAnnotations(original, annotations, 999)
        for (const [id, ref] of refsByAnnotationId) {
            expect(ref).toMatch(new RegExp(`^LEXSEEK-${id}-[a-zA-Z0-9]{8}$`))
        }
    })

    it('w:author 只写纯净的 LS:{人名}，不含身份证尾部（spec §14：身份证依赖 customXml）', async () => {
        // 历史曾把身份证 [#reviewId-annotationId-rand8] 拼到 w:author 尾部，Word 批注卡片
        // 用户端会显示 "LS:AI [#871-386-aOhj...]" 这种机器码，体验极差。现按 spec §14：
        // author 只保留 "LS:{人名}" 作为可见系统标识，身份证交给 customXml 主防线。
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)

        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({ id: 1, authorType: 'ai', authorName: 'AI', anchorParagraphIndex: Math.min(1, paragraphs.length - 1) }),
            makeAnnotation({ id: 2, authorType: 'lawyer', authorName: '张律师', anchorParagraphIndex: Math.min(1, paragraphs.length - 1) }),
            makeAnnotation({ id: 3, authorType: 'external', authorName: '客户甲', anchorParagraphIndex: Math.min(2, paragraphs.length - 1) }),
        ]

        const { buffer } = await injectAnnotations(original, annotations, 999)
        const zip = await loadDocxZip(buffer)
        const commentsXml = await readTextFromZip(zip, 'word/comments.xml')

        // spec §4.3：作者名一律去 LS: 前缀；AI 内容用署名（未传 signature 回退 'AI'），律师/客户用各自姓名
        expect(commentsXml).toContain('w:author="AI"')
        expect(commentsXml).toContain('w:author="张律师"')
        expect(commentsXml).toContain('w:author="客户甲"')
        // 全文无 LS: 前缀
        expect(commentsXml).not.toContain('LS:')
        // 反向断言：不应再出现 [#...-...-...] 身份证机器码
        expect(commentsXml).not.toMatch(/w:author="[^"]*\[#\d+-\d+-[a-zA-Z0-9]{8}\]"/)
    })

    it('答复批注写入 w:parentId 引用父 w:id', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)

        const idx = Math.min(1, paragraphs.length - 1)
        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({ id: 1, authorName: 'AI', anchorParagraphIndex: idx }),
            makeAnnotation({ id: 2, authorName: '张律师', parentAnnotationId: 1, anchorParagraphIndex: idx }),
        ]

        const { buffer } = await injectAnnotations(original, annotations, 999)
        const zip = await loadDocxZip(buffer)
        const commentsXml = await readTextFromZip(zip, 'word/comments.xml')

        // id=2 的 annotation 对应 w:id="1"（0-indexed），其父 id=1 对应 w:id="0"
        expect(commentsXml).toMatch(/w:parentId="0"/)
    })

    it('同段落 N 条 annotation 在 document.xml 必须有 N 个 commentRangeStart（防孤儿批注致 Word 报"文件损坏"）', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)

        const idx = Math.min(1, paragraphs.length - 1)
        // 3 条 annotation 都落在同一段落：AI 主批 + 律师答复 + 外部评论
        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({ id: 1, authorType: 'ai', authorName: 'AI', anchorParagraphIndex: idx }),
            makeAnnotation({ id: 2, authorType: 'lawyer', authorName: '张律师', parentAnnotationId: 1, anchorParagraphIndex: idx }),
            makeAnnotation({ id: 3, authorType: 'external', authorName: '客户甲', anchorParagraphIndex: idx }),
        ]

        const { buffer } = await injectAnnotations(original, annotations, 999)
        const zip = await loadDocxZip(buffer)
        const docXml = await readTextFromZip(zip, 'word/document.xml')
        const commentsXml = await readTextFromZip(zip, 'word/comments.xml')

        // comments.xml 有 3 条 comment
        const commentMatches = commentsXml.match(/<w:comment\s/g) ?? []
        expect(commentMatches.length).toBe(3)

        // document.xml 必须有 3 个 commentRangeStart 与之对应，否则产生孤儿 comment
        const rangeStartMatches = docXml.match(/<w:commentRangeStart\s/g) ?? []
        expect(rangeStartMatches.length).toBe(3)

        // 每个 w:id（0/1/2）都要在 document.xml 里出现至少一次 rangeStart
        expect(docXml).toMatch(/<w:commentRangeStart[^/]*w:id="0"/)
        expect(docXml).toMatch(/<w:commentRangeStart[^/]*w:id="1"/)
        expect(docXml).toMatch(/<w:commentRangeStart[^/]*w:id="2"/)

        // 对应的 commentRangeEnd 和 commentReference 也各 3 个
        const rangeEndMatches = docXml.match(/<w:commentRangeEnd\s/g) ?? []
        const commentRefMatches = docXml.match(/<w:commentReference\s/g) ?? []
        expect(rangeEndMatches.length).toBe(3)
        expect(commentRefMatches.length).toBe(3)
    })

    it('已有 wordCommentRef 的 annotation 沿用原值不新生成', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)

        const existingRef = 'LEXSEEK-99-abc12345'
        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({ id: 99, wordCommentRef: existingRef, anchorParagraphIndex: Math.min(1, paragraphs.length - 1) }),
        ]

        const { refsByAnnotationId } = await injectAnnotations(original, annotations, 999)
        expect(refsByAnnotationId.get(99)).toBe(existingRef)
    })

    it('anchorParagraphIndex 越界时跳过 document.xml 注入，但 refsByAnnotationId 仍包含该 annotation', async () => {
        const original = await readFile(SAMPLE)

        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({ id: 1, anchorParagraphIndex: 1 }),
            makeAnnotation({ id: 2, anchorParagraphIndex: 99999 }),
        ]

        const { buffer, refsByAnnotationId } = await injectAnnotations(original, annotations, 999)
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

    it('M9 回归：anchorParagraphIndex 为 null（上游 clauseParagraphIndex 越界落 null）时不抛 TypeError', async () => {
        // 崩溃路径：越界 clauseIndex → buildClauseToBodyParagraphMap.get 得 undefined →
        // clauseParagraphIndex 落库 null → runAnnotateAndUpload 用 `a.risk.clauseParagraphIndex!`
        // 把 null 当 number 传入。旧实现 `null >= 0` 求值为真 → normalizedParas[null] 得 undefined
        // → paraText.includes() 抛 TypeError → 整份审查置 failed。
        const original = await readFile(SAMPLE)
        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({
                id: 1,
                anchorParagraphIndex: null as unknown as number,
                anchorQuote: '一段绝不会出现在样本合同里的独特短语ZZZ99887',
            }),
        ]
        // 修复前：抛 TypeError；修复后：quote 未命中 → 跳过该批注，不崩溃
        const { buffer, refsByAnnotationId } = await injectAnnotations(original, annotations, 999)
        expect(buffer).toBeInstanceOf(Buffer)
        expect(refsByAnnotationId.size).toBe(1)
    })

    it('M9 回归：anchorParagraphIndex 为 null 但 anchorQuote 命中时，仍能按 quote 定位注入', async () => {
        const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
            `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
            `<w:body>` +
            `<w:p><w:r><w:t>合同编号 ABC-001</w:t></w:r></w:p>` +
            `<w:p><w:r><w:t>第一条 乙方应当按时履行交付义务</w:t></w:r></w:p>` +
            `<w:p><w:r><w:t>第二条 工作内容与职位</w:t></w:r></w:p>` +
            `</w:body></w:document>`
        const zip = new JSZip()
        zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`)
        zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`)
        zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`)
        zip.file('word/document.xml', docXml)
        const docxBuffer = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }))

        const annotation = makeAnnotation({
            id: 1,
            anchorParagraphIndex: null as unknown as number,
            anchorQuote: '第一条 乙方应当按时履行交付义务',
        })
        const { buffer } = await injectAnnotations(docxBuffer, [annotation], 999)
        const resultZip = await loadDocxZip(buffer)
        const resultDocXml = await readTextFromZip(resultZip, 'word/document.xml')
        const allParas = resultDocXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? []
        const paraWithRange = allParas.find(p => p.includes('<w:commentRangeStart'))
        expect(paraWithRange).not.toBeUndefined()
        expect(paraWithRange!).toContain('第一条 乙方应当按时履行交付义务')
    })

    it('[Content_Types].xml 和 rels 含 comments 注册项', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)

        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({ id: 1, anchorParagraphIndex: Math.min(1, paragraphs.length - 1) }),
        ]

        const { buffer } = await injectAnnotations(original, annotations, 999)
        const zip = await loadDocxZip(buffer)

        const types = await readTextFromZip(zip, '[Content_Types].xml')
        expect(types).toContain('PartName="/word/comments.xml"')

        const rels = await readTextFromZip(zip, 'word/_rels/document.xml.rels')
        expect(rels).toContain('Target="comments.xml"')
    })

    it('L12：多行 content 按 \\n 拆成多个 <w:p>，气泡里正确换行', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({
                id: 1,
                content: '问题：付款期限过短\n【法律依据】《民法典》第577条\n【建议】延长付款期',
                anchorParagraphIndex: Math.min(1, paragraphs.length - 1),
            }),
        ]
        const { buffer } = await injectAnnotations(original, annotations, 999)
        const zip = await loadDocxZip(buffer)
        const commentsXml = await readTextFromZip(zip, 'word/comments.xml')
        // 3 行 content → w:comment 内 3 个 <w:p>（旧实现塞进单个 <w:t> 只有 1 个）
        const pCount = (commentsXml.match(/<w:p\b/g) ?? []).length
        expect(pCount).toBe(3)
        expect(commentsXml).toContain('【法律依据】《民法典》第577条')
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

        const { buffer } = await injectAnnotations(original, annotations, 999)
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

        const { buffer: result } = await injectAnnotations(docxBuffer, [annotation], 999)
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

        const { buffer: result } = await injectAnnotations(docxBuffer, [annotation], 999)
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

describe('injectAnnotations idStart 协调（PR6 §8.3.1）', () => {
    it('未传 idStart 时 wId 从 0 开始（向后兼容）', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({ id: 1, anchorParagraphIndex: Math.min(0, paragraphs.length - 1) }),
            makeAnnotation({ id: 2, anchorParagraphIndex: Math.min(1, paragraphs.length - 1) }),
        ]
        const { buffer, nextIdAfter } = await injectAnnotations(original, annotations, 999)
        const zip = await loadDocxZip(buffer)
        const commentsXml = await readTextFromZip(zip, 'word/comments.xml')
        expect(commentsXml).toContain('w:id="0"')
        expect(commentsXml).toContain('w:id="1"')
        expect(commentsXml).not.toContain('w:id="2"')
        expect(nextIdAfter).toBe(2)
    })

    it('传 idStart=10 时 wId 从 10 开始 + nextIdAfter=12', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({ id: 1, anchorParagraphIndex: Math.min(0, paragraphs.length - 1) }),
            makeAnnotation({ id: 2, anchorParagraphIndex: Math.min(1, paragraphs.length - 1) }),
        ]
        const { buffer, nextIdAfter } = await injectAnnotations(original, annotations, 999, { idStart: 10 })
        const zip = await loadDocxZip(buffer)
        const commentsXml = await readTextFromZip(zip, 'word/comments.xml')
        expect(commentsXml).toContain('w:id="10"')
        expect(commentsXml).toContain('w:id="11"')
        expect(commentsXml).not.toContain('w:id="12"')
        expect(nextIdAfter).toBe(12)
    })

    it('空 annotations + idStart=5 → nextIdAfter=5（不消耗 ID）', async () => {
        const original = await readFile(SAMPLE)
        const { nextIdAfter } = await injectAnnotations(original, [], 999, { idStart: 5 })
        expect(nextIdAfter).toBe(5)
    })

    it('parentAnnotationId 引用按新 idStart 偏移后的 wId', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        const idx = Math.min(1, paragraphs.length - 1)
        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({ id: 1, authorName: 'AI', anchorParagraphIndex: idx }),
            makeAnnotation({ id: 2, authorName: '张律师', parentAnnotationId: 1, anchorParagraphIndex: idx }),
        ]
        const { buffer } = await injectAnnotations(original, annotations, 999, { idStart: 100 })
        const zip = await loadDocxZip(buffer)
        const commentsXml = await readTextFromZip(zip, 'word/comments.xml')
        // id=2 的 annotation 对应 w:id="101"，其父 id=1 对应 w:id="100"
        expect(commentsXml).toMatch(/w:parentId="100"/)
    })

    it('未传 wrapTargetByRiskId → 维持现有段落级行为（commentRangeStart w:id 从 idStart 起始）', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        const ann = makeAnnotation({ id: 1, anchorParagraphIndex: Math.min(0, paragraphs.length - 1) })
        const { buffer } = await injectAnnotations(original, [ann], 999) // 不传 opts
        const zip = await loadDocxZip(buffer)
        const docXml = await readTextFromZip(zip, 'word/document.xml')
        // 仍按既有逻辑：commentRangeStart 在段首
        expect(docXml).toMatch(/<w:commentRangeStart\s+w:id="0"/)
    })
})

describe('injectAnnotations 署名与去 LS: 前缀（Task 5 spec §4.3）', () => {
    it('AI 批注用署名，律师批注去 LS: 前缀，全文无 LS: 字符串', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        const idx = Math.min(1, paragraphs.length - 1)

        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({ id: 1, authorType: 'ai', authorName: 'AI', anchorParagraphIndex: idx }),
            makeAnnotation({ id: 2, authorType: 'lawyer', authorName: '陈律师', anchorParagraphIndex: idx }),
        ]

        const { buffer } = await injectAnnotations(original, annotations, 999, { signature: '王明远' })
        const zip = await loadDocxZip(buffer)
        const commentsXml = await readTextFromZip(zip, 'word/comments.xml')

        // AI 批注用署名
        expect(commentsXml).toContain('w:author="王明远"')
        // 律师批注去前缀（authorName 直接用，无 LS: 前缀）
        expect(commentsXml).toContain('w:author="陈律师"')
        // 全文无 LS: 前缀
        expect(commentsXml).not.toContain('LS:')
    })
})
