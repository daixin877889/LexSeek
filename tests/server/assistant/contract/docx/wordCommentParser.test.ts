import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
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
    it('docx 无 word/comments.xml 时返回空数组', async () => {
        // labor.docx 原始文件无批注
        const original = await readFile(SAMPLE)
        const result = await parseWordComments(original)
        expect(result).toEqual([])
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
        const result = await parseWordComments(buffer)
        expect(result).toHaveLength(3)
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
        const result = await parseWordComments(buffer)

        const ids = result.map(c => c.wId).sort((a, b) => a - b)
        expect(ids).toEqual([0, 1])
    })

    it('wAuthor 包含 LS: 前缀', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        const maxIdx = paragraphs.length - 1

        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({ id: 1, authorName: '张律师', anchorParagraphIndex: Math.min(1, maxIdx) }),
        ]

        const { buffer } = await injectAnnotations(original, annotations)
        const result = await parseWordComments(buffer)

        expect(result[0].wAuthor).toBe('LS:张律师')
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
        const result = await parseWordComments(buffer)

        expect(result[0].wInitials).toBe(existingRef)
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
        const result = await parseWordComments(buffer)

        const reply = result.find(c => c.wId === 1)
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
        const result = await parseWordComments(buffer)

        expect(result[0].parentWId).toBeNull()
    })

    it('content 正确提取批注文本', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        const maxIdx = paragraphs.length - 1

        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({ id: 1, content: '这是批注正文', anchorParagraphIndex: Math.min(1, maxIdx) }),
        ]

        const { buffer } = await injectAnnotations(original, annotations)
        const result = await parseWordComments(buffer)

        expect(result[0].content).toBe('这是批注正文')
    })

    it('多段落内容（injectComments 五模块格式）用 \\n 分隔', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        const maxIdx = paragraphs.length - 1

        const risk = makeRisk(Math.min(2, maxIdx), { legalBasis: undefined })
        const { buffer } = await injectComments(original, [risk])
        const result = await parseWordComments(buffer)

        expect(result).toHaveLength(1)
        // 五模块内容必须包含换行
        expect(result[0].content).toContain('\n')
        expect(result[0].content).toContain('【条款分析】')
        expect(result[0].content).toContain('【修改建议】')
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
        const result = await parseWordComments(buffer)

        expect(result[0].content).toBe('条款 "A" 与 <B> 冲突 & 引号 \'单引号\'')
    })

    it('dateIso 正确提取（ISO 格式字符串）', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        const maxIdx = paragraphs.length - 1

        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({ id: 1, anchorParagraphIndex: Math.min(1, maxIdx) }),
        ]

        const { buffer } = await injectAnnotations(original, annotations)
        const result = await parseWordComments(buffer)

        expect(result[0].dateIso).not.toBeNull()
        // ISO 8601 格式
        expect(result[0].dateIso).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    it('无 w:initials 属性时 wInitials 为空字符串', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        const maxIdx = paragraphs.length - 1

        // injectComments（旧 API）不写 w:initials
        const risk = makeRisk(Math.min(1, maxIdx))
        const { buffer } = await injectComments(original, [risk])
        const result = await parseWordComments(buffer)

        expect(result[0].wInitials).toBe('')
    })
})
