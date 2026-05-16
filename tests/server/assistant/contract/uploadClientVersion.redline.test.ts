/**
 * uploadClientVersionService · 修订版回传识别集成测试（spec §11.2 / Plan Task 10）。
 *
 * 验证回传链路接入「修订处置识别」后的端到端行为：
 *  1. 纯修订版回传不再误触发「防误删保护」（统一覆盖率口径）
 *  2. 修订被客户接受 / 拒绝 / 未处理 → contractRisks.clientRedlineDecision 落库正确
 *  3. 接受 → archivedStatus 自动置 handled（但不覆盖律师已有处置）
 *  4. both 模式：修订标记与批注标记并存，互不干扰
 *  5. 跨审查 redlineRefs（reviewId 不符）被忽略
 *
 * 测试用真实 docx round-trip：
 *  - injectRedlineMarks 产出带 <w:ins>/<w:del> + redlineRefs.xml 的修订版 docx
 *  - acceptAllRedlines / rejectAllRedlines 在 OOXML 层模拟 Word「接受/拒绝全部修订」
 *  - downloadFileService 被 mock 成返回当前 test 注入的 docx buffer
 *
 * **Feature: contract-redline-roundtrip-and-signature**
 * **Validates: Plan Task 10 / spec §11.2**
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { prisma } from '~~/server/utils/db'
import { uploadClientVersionService } from '~~/server/agents/contract/uploadClientVersion.service'
import { createOssFileDao } from '~~/server/services/files/ossFiles.dao'
import { loadDocxZip, zipToBuffer, readTextFromZip, writeTextToZip } from '~~/server/agents/contract/docx/zipRewriter'
import {
    parseOoxml,
    stringifyOoxml,
    tagOf,
    childrenOf,
    textOf,
    getAttr,
    makeElement,
    makeText,
    type Node,
    type NodeArray,
} from '~~/server/agents/contract/docx/xmlAst'
import {
    injectRedlineMarks,
    type RedlineRisk,
} from '~~/server/agents/contract/docx/redlineInjector'
import { ensureTestUser } from '../test-db-helper'
import type { ParsedDocxComments, ParsedWordComment } from '~~/server/agents/contract/docx/wordCommentParser'

const SAMPLE = join(__dirname, '../../../../prisma/seeds/contract-samples/labor.docx')
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/**
 * 当前 test 要让 downloadFileService 返回的 docx buffer。
 * 每个 it 在 arrange 阶段通过 setMockDocx() 注入。
 */
let mockDocxBuffer: Buffer = Buffer.from([0x50, 0x4b, 0x03, 0x04])
function setMockDocx(buf: Buffer): void {
    mockDocxBuffer = buf
}

// downloadFileService：返回当前 test 注入的修订版 docx（parseRedlineMarks 直接消费它）
vi.mock('~~/server/services/storage/storage.service', () => ({
    downloadFileService: vi.fn(async () => mockDocxBuffer),
    uploadFileService: vi.fn(),
    generateSignedUrlService: vi.fn(),
}))

// parseContractDocx：与 redline 无关（仅供 service 内段落切分）。返回稳定的两段。
vi.mock('~~/server/agents/contract/docx/parser', () => ({
    parseContractDocx: vi.fn(async () => ({
        paragraphs: ['第一条 甲方应在合同签署后 30 日内支付首付款。', '第二条 乙方应提供相应服务。'],
        rawXml: '<root/>',
    })),
}))

// wordCommentParser：默认空批注（纯修订版回传场景）。both 模式用例单独 mockResolvedValueOnce。
vi.mock('~~/server/agents/contract/docx/wordCommentParser', () => ({
    parseWordComments: vi.fn(async (): Promise<ParsedDocxComments> => ({
        comments: [],
        annotationRefsByWId: new Map(),
        customXmlRefEntries: [],
    })),
}))

/** 复用 redlineInjector 测试的 makeRisk 辅助 */
function makeRedlineRisk(overrides: Partial<RedlineRisk> & { id: number }): RedlineRisk {
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

/** 用最小 fixture XML 替换 labor.docx 的 word/document.xml */
async function buildFixtureBuffer(documentXml: string): Promise<Buffer> {
    const zip = await loadDocxZip(await readFile(SAMPLE))
    zip.file('word/document.xml', documentXml)
    return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

/**
 * 递归遍历任意 children 数组，对 <w:ins> / <w:del> 节点做就地变换。
 * transform 返回替换后的节点数组（空数组 = 删除该节点）。
 */
function rewriteRedlineNodes(
    nodes: NodeArray,
    transform: (node: Node, tag: 'w:ins' | 'w:del') => NodeArray,
): void {
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]!
        const tag = tagOf(node)
        if (tag === 'w:ins' || tag === 'w:del') {
            const replacement = transform(node, tag)
            nodes.splice(i, 1, ...replacement)
            i += replacement.length - 1
            continue
        }
        const kids = childrenOf(node)
        if (kids.length > 0) rewriteRedlineNodes(kids, transform)
    }
}

/**
 * 把 <w:r> 内的 <w:delText> 子节点改回 <w:t>（拒绝修订时恢复原文）。
 * 不还原 delText 的话回传文档里仍残留 <w:delText>，parseRedlineMarks 的
 * corpusDel 会含原文导致被误判为「未处理」。
 */
function delTextRunToNormalRun(runNode: Node): Node {
    const newKids: NodeArray = childrenOf(runNode).map((kid) =>
        tagOf(kid) === 'w:delText'
            ? makeElement('w:t', { 'xml:space': 'preserve' }, [makeText(textOf(kid))])
            : kid,
    )
    return makeElement('w:r', {}, newKids)
}

/**
 * 模拟 Word「接受全部修订」：
 *  - <w:ins> 解包为其内子节点（插入内容转为正文）
 *  - <w:del> 整体移除（删除生效）
 */
async function acceptAllRedlines(docxBuffer: Buffer): Promise<Buffer> {
    const zip = await loadDocxZip(docxBuffer)
    const ast = parseOoxml(await readTextFromZip(zip, 'word/document.xml'))
    rewriteRedlineNodes(ast, (node, tag) => {
        if (tag === 'w:ins') return childrenOf(node) // 解包
        return [] // w:del 删除
    })
    writeTextToZip(zip, 'word/document.xml', stringifyOoxml(ast))
    return await zipToBuffer(zip)
}

/**
 * 模拟 Word「拒绝全部修订」：
 *  - <w:del> 解包为其内子节点，且 <w:delText> 还原为 <w:t>（恢复原文）
 *  - <w:ins> 整体移除（插入被丢弃）
 */
async function rejectAllRedlines(docxBuffer: Buffer): Promise<Buffer> {
    const zip = await loadDocxZip(docxBuffer)
    const ast = parseOoxml(await readTextFromZip(zip, 'word/document.xml'))
    rewriteRedlineNodes(ast, (node, tag) => {
        if (tag === 'w:del') {
            return childrenOf(node).map((kid) =>
                tagOf(kid) === 'w:r' ? delTextRunToNormalRun(kid) : kid,
            )
        }
        return [] // w:ins 删除
    })
    writeTextToZip(zip, 'word/document.xml', stringifyOoxml(ast))
    return await zipToBuffer(zip)
}

/** 收集 AsyncGenerator 的所有事件 */
async function collectEvents(
    gen: AsyncGenerator<{ type: string; data: unknown }>,
): Promise<{ type: string; data: unknown }[]> {
    const events: { type: string; data: unknown }[] = []
    for await (const ev of gen) events.push(ev)
    return events
}

describe('uploadClientVersionService · 修订版回传识别（spec §11.2）', () => {
    let userId: number
    let reviewId: number
    let ossFileId: number
    const createdOssFileIds: number[] = []

    beforeEach(async () => {
        userId = await ensureTestUser()
        const review = await prisma.contractReviews.create({
            data: {
                userId,
                status: 'completed',
                risks: [],
                sessionId: `upload-redline-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                originalFileId: 0,
                maxVersionNo: 0,
            },
        })
        reviewId = review.id

        const oss = await createOssFileDao({
            userId,
            bucketName: 'test-bucket',
            fileName: 'client-redline.docx',
            filePath: `users/${userId}/contract-reviews/redline-${Date.now()}.docx`,
            fileSize: 4096,
            fileType: DOCX_MIME,
            status: 1,
        })
        ossFileId = oss.id
        createdOssFileIds.push(oss.id)
    })

    afterEach(async () => {
        // 叶表 → 父表顺序清理（worker DB 同 worker 内串行共享）
        await prisma.contractReviewVersions.deleteMany({ where: { reviewId } })
        await prisma.contractAnnotations.deleteMany({ where: { reviewId } })
        await prisma.contractRisks.deleteMany({ where: { reviewId } })
        await prisma.contractReviews.delete({ where: { id: reviewId } }).catch(() => {})
        if (createdOssFileIds.length > 0) {
            await prisma.ossFiles.deleteMany({ where: { id: { in: createdOssFileIds } } })
            createdOssFileIds.length = 0
        }
        await prisma.users.deleteMany({ where: { id: userId } })
    })

    /**
     * 在 DB 里建一条带 quote 锚点 / suggestedClauseText 的 AI 风险 +
     * 对应带 wordCommentRef 的 AI annotation（让该风险进入「带身份证」覆盖率口径）。
     */
    async function seedRiskWithAnnotation(input: {
        clauseText: string
        problematicQuote: string
        quoteCharStart: number
        quoteCharEnd: number
        suggestedClauseText: string
    }): Promise<{ riskId: number; annId: number }> {
        const risk = await prisma.contractRisks.create({
            data: {
                reviewId,
                source: 'ai',
                category: '合同风险',
                level: 'high',
                problem: '违约金条款偏离行业惯例',
                clauseText: input.clauseText,
                clauseParagraphIndex: 0,
                problematicQuote: input.problematicQuote,
                quoteCharStart: input.quoteCharStart,
                quoteCharEnd: input.quoteCharEnd,
                suggestedClauseText: input.suggestedClauseText,
            },
        })
        const ann = await prisma.contractAnnotations.create({
            data: {
                reviewId,
                riskId: risk.id,
                authorType: 'ai',
                authorName: 'AI',
                content: '违约金条款偏离行业惯例，建议调整',
                wordCommentRef: `LEXSEEK-${risk.id}-redlinetest`,
            },
        })
        return { riskId: risk.id, annId: ann.id }
    }

    /** 单段 fixture：含一句可被 redline 命中的合同条款文字 */
    const FIXTURE_SINGLE = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t xml:space="preserve">违约金按合同总额的百分之五十计算。</w:t></w:r></w:p>
  </w:body>
</w:document>`

    it('修订版回传：未处理 docx 不触发防误删、风险标记 untouched', async () => {
        const clauseText = '违约金按合同总额的百分之五十计算。'
        const quote = '百分之五十'
        const start = clauseText.indexOf(quote)
        const { riskId, annId } = await seedRiskWithAnnotation({
            clauseText,
            problematicQuote: quote,
            quoteCharStart: start,
            quoteCharEnd: start + quote.length,
            suggestedClauseText: '百分之十',
        })

        // 导出修订版 docx，原样回传（客户未处理）
        const base = await buildFixtureBuffer(FIXTURE_SINGLE)
        const exported = await injectRedlineMarks(
            base,
            [makeRedlineRisk({
                id: riskId,
                clauseText,
                clauseParagraphIndex: 0,
                problematicQuote: quote,
                quoteCharStart: start,
                quoteCharEnd: start + quote.length,
                suggestedClauseText: '百分之十',
            })],
            { reviewId, idStart: 5000 },
        )
        expect(exported.skippedRiskIds).toEqual([])
        setMockDocx(exported.buffer)

        const review = await prisma.contractReviews.findUniqueOrThrow({ where: { id: reviewId } })
        const events = await collectEvents(uploadClientVersionService({ review, ossFileId, userId }))

        // 不应触发防误删保护
        expect(events.filter(e => e.type === 'error')).toHaveLength(0)
        const after = await prisma.contractReviews.findUniqueOrThrow({ where: { id: reviewId } })
        expect(after.status).not.toBe('failed')

        const risk = await prisma.contractRisks.findUniqueOrThrow({ where: { id: riskId } })
        expect(risk.clientRedlineDecision).toBe('untouched')
        // 未处理不动律师处置
        expect(risk.archivedStatus).toBeNull()

        // 回归（review 6 真实 bug）：该风险走 redline 修订标记导出、不写批注，其
        // annotation 不在 customXmlRefEntries 内——回传识别不能把它误判成「客户删除
        // 批注」（否则整批走修订标记的风险批注会被错误标记 removedByClient）
        const ann = await prisma.contractAnnotations.findUniqueOrThrow({ where: { id: annId } })
        expect(ann.removedByClient).toBe(false)
    })

    it('修订版回传：全接受 → clientRedlineDecision=accepted 且 archivedStatus=handled', async () => {
        const clauseText = '违约金按合同总额的百分之五十计算。'
        const quote = '百分之五十'
        const start = clauseText.indexOf(quote)
        const { riskId } = await seedRiskWithAnnotation({
            clauseText,
            problematicQuote: quote,
            quoteCharStart: start,
            quoteCharEnd: start + quote.length,
            suggestedClauseText: '百分之十',
        })

        const base = await buildFixtureBuffer(FIXTURE_SINGLE)
        const exported = await injectRedlineMarks(
            base,
            [makeRedlineRisk({
                id: riskId,
                clauseText,
                clauseParagraphIndex: 0,
                problematicQuote: quote,
                quoteCharStart: start,
                quoteCharEnd: start + quote.length,
                suggestedClauseText: '百分之十',
            })],
            { reviewId, idStart: 5000 },
        )
        expect(exported.skippedRiskIds).toEqual([])
        // 模拟 Word 接受全部修订后回传
        setMockDocx(await acceptAllRedlines(exported.buffer))

        const review = await prisma.contractReviews.findUniqueOrThrow({ where: { id: reviewId } })
        const events = await collectEvents(uploadClientVersionService({ review, ossFileId, userId }))
        expect(events.filter(e => e.type === 'error')).toHaveLength(0)

        const risk = await prisma.contractRisks.findUniqueOrThrow({ where: { id: riskId } })
        expect(risk.clientRedlineDecision).toBe('accepted')
        expect(risk.archivedStatus).toBe('handled')
        expect(risk.archivedAt).not.toBeNull()
    })

    it('修订版回传：全拒绝 → clientRedlineDecision=rejected 且不动 archivedStatus', async () => {
        const clauseText = '违约金按合同总额的百分之五十计算。'
        const quote = '百分之五十'
        const start = clauseText.indexOf(quote)
        const { riskId } = await seedRiskWithAnnotation({
            clauseText,
            problematicQuote: quote,
            quoteCharStart: start,
            quoteCharEnd: start + quote.length,
            suggestedClauseText: '百分之十',
        })

        const base = await buildFixtureBuffer(FIXTURE_SINGLE)
        const exported = await injectRedlineMarks(
            base,
            [makeRedlineRisk({
                id: riskId,
                clauseText,
                clauseParagraphIndex: 0,
                problematicQuote: quote,
                quoteCharStart: start,
                quoteCharEnd: start + quote.length,
                suggestedClauseText: '百分之十',
            })],
            { reviewId, idStart: 5000 },
        )
        expect(exported.skippedRiskIds).toEqual([])
        // 模拟 Word 拒绝全部修订后回传
        setMockDocx(await rejectAllRedlines(exported.buffer))

        const review = await prisma.contractReviews.findUniqueOrThrow({ where: { id: reviewId } })
        const events = await collectEvents(uploadClientVersionService({ review, ossFileId, userId }))
        expect(events.filter(e => e.type === 'error')).toHaveLength(0)

        const risk = await prisma.contractRisks.findUniqueOrThrow({ where: { id: riskId } })
        expect(risk.clientRedlineDecision).toBe('rejected')
        expect(risk.archivedStatus).toBeNull()
    })

    it('修订版回传：接受部分（两条修订只接受一条）→ 分别标记 accepted / untouched', async () => {
        const clauseText1 = '违约金按合同总额的百分之五十计算。'
        const quote1 = '百分之五十'
        const s1 = clauseText1.indexOf(quote1)
        const clauseText2 = '服务费每月支付一次并由乙方开具发票。'
        const quote2 = '每月'
        const s2 = clauseText2.indexOf(quote2)

        const r1 = await seedRiskWithAnnotation({
            clauseText: clauseText1,
            problematicQuote: quote1,
            quoteCharStart: s1,
            quoteCharEnd: s1 + quote1.length,
            suggestedClauseText: '百分之十',
        })
        const r2 = await seedRiskWithAnnotation({
            clauseText: clauseText2,
            problematicQuote: quote2,
            quoteCharStart: s2,
            quoteCharEnd: s2 + quote2.length,
            suggestedClauseText: '每季度',
        })

        const fixture = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t xml:space="preserve">${clauseText1}</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">${clauseText2}</w:t></w:r></w:p>
  </w:body>
</w:document>`
        const base = await buildFixtureBuffer(fixture)
        const exported = await injectRedlineMarks(
            base,
            [
                makeRedlineRisk({
                    id: r1.riskId,
                    clauseText: clauseText1,
                    clauseParagraphIndex: 0,
                    problematicQuote: quote1,
                    quoteCharStart: s1,
                    quoteCharEnd: s1 + quote1.length,
                    suggestedClauseText: '百分之十',
                }),
                makeRedlineRisk({
                    id: r2.riskId,
                    clauseText: clauseText2,
                    clauseParagraphIndex: 1,
                    problematicQuote: quote2,
                    quoteCharStart: s2,
                    quoteCharEnd: s2 + quote2.length,
                    suggestedClauseText: '每季度',
                }),
            ],
            { reviewId, idStart: 5000 },
        )
        expect(exported.skippedRiskIds).toEqual([])

        // 只接受 risk1 的修订：移除 risk1 的 w:del、解包 risk1 的 w:ins；risk2 原样保留
        const r1Span = exported.spansByRiskId.get(r1.riskId)!
        const r1DelIds = new Set(r1Span.paragraphSpans.map(s => s.delId))
        const r1InsIds = new Set(
            r1Span.paragraphSpans.map(s => s.insId).filter((x): x is number => x !== null),
        )
        const zip = await loadDocxZip(exported.buffer)
        const ast = parseOoxml(await readTextFromZip(zip, 'word/document.xml'))
        rewriteRedlineNodes(ast, (node, tag) => {
            const id = Number(getAttr(node, 'w:id') ?? '')
            if (tag === 'w:ins' && r1InsIds.has(id)) return childrenOf(node) // 接受 risk1 插入
            if (tag === 'w:del' && r1DelIds.has(id)) return [] // 接受 risk1 删除
            return [node] // risk2 不动
        })
        writeTextToZip(zip, 'word/document.xml', stringifyOoxml(ast))
        setMockDocx(await zipToBuffer(zip))

        const review = await prisma.contractReviews.findUniqueOrThrow({ where: { id: reviewId } })
        const events = await collectEvents(uploadClientVersionService({ review, ossFileId, userId }))
        expect(events.filter(e => e.type === 'error')).toHaveLength(0)

        const risk1 = await prisma.contractRisks.findUniqueOrThrow({ where: { id: r1.riskId } })
        const risk2 = await prisma.contractRisks.findUniqueOrThrow({ where: { id: r2.riskId } })
        expect(risk1.clientRedlineDecision).toBe('accepted')
        expect(risk1.archivedStatus).toBe('handled')
        expect(risk2.clientRedlineDecision).toBe('untouched')
        expect(risk2.archivedStatus).toBeNull()
    })

    it('全接受：律师已有处置（ignored）不被覆盖，仅写 clientRedlineDecision', async () => {
        const clauseText = '违约金按合同总额的百分之五十计算。'
        const quote = '百分之五十'
        const start = clauseText.indexOf(quote)
        const { riskId } = await seedRiskWithAnnotation({
            clauseText,
            problematicQuote: quote,
            quoteCharStart: start,
            quoteCharEnd: start + quote.length,
            suggestedClauseText: '百分之十',
        })
        // 律师已先行把该风险标为 ignored
        await prisma.contractRisks.update({
            where: { id: riskId },
            data: { archivedStatus: 'ignored', archivedAt: new Date() },
        })

        const base = await buildFixtureBuffer(FIXTURE_SINGLE)
        const exported = await injectRedlineMarks(
            base,
            [makeRedlineRisk({
                id: riskId,
                clauseText,
                clauseParagraphIndex: 0,
                problematicQuote: quote,
                quoteCharStart: start,
                quoteCharEnd: start + quote.length,
                suggestedClauseText: '百分之十',
            })],
            { reviewId, idStart: 5000 },
        )
        setMockDocx(await acceptAllRedlines(exported.buffer))

        const review = await prisma.contractReviews.findUniqueOrThrow({ where: { id: reviewId } })
        await collectEvents(uploadClientVersionService({ review, ossFileId, userId }))

        const risk = await prisma.contractRisks.findUniqueOrThrow({ where: { id: riskId } })
        expect(risk.clientRedlineDecision).toBe('accepted')
        // 律师的 ignored 处置不应被 redline 接受覆盖成 handled
        expect(risk.archivedStatus).toBe('ignored')
    })

    it('both 模式：修订识别与批注识别并存、互不干扰', async () => {
        const clauseText = '违约金按合同总额的百分之五十计算。'
        const quote = '百分之五十'
        const start = clauseText.indexOf(quote)
        // 修订风险（带 quote 锚点）
        const redlineRisk = await seedRiskWithAnnotation({
            clauseText,
            problematicQuote: quote,
            quoteCharStart: start,
            quoteCharEnd: start + quote.length,
            suggestedClauseText: '百分之十',
        })
        // 批注风险（另一条 AI 风险 + 带 wordCommentRef 的 annotation，走 comment 命中路径）
        const commentRisk = await prisma.contractRisks.create({
            data: {
                reviewId,
                source: 'ai',
                category: '合同风险',
                level: 'medium',
                problem: '付款节点表述不清',
                clauseText: '第二条 付款节点',
                clauseParagraphIndex: 1,
            },
        })
        const commentAnn = await prisma.contractAnnotations.create({
            data: {
                reviewId,
                riskId: commentRisk.id,
                authorType: 'ai',
                authorName: 'AI',
                content: '付款节点表述不清，建议明确',
                wordCommentRef: `LEXSEEK-${commentRisk.id}-bothmode`,
            },
        })

        const base = await buildFixtureBuffer(FIXTURE_SINGLE)
        const exported = await injectRedlineMarks(
            base,
            [makeRedlineRisk({
                id: redlineRisk.riskId,
                clauseText,
                clauseParagraphIndex: 0,
                problematicQuote: quote,
                quoteCharStart: start,
                quoteCharEnd: start + quote.length,
                suggestedClauseText: '百分之十',
            })],
            { reviewId, idStart: 5000 },
        )
        // 客户接受修订后回传
        setMockDocx(await acceptAllRedlines(exported.buffer))

        // mock parseWordComments：批注风险通过 customXml 命中（模拟 both 模式批注端）
        const { parseWordComments } = await import('~~/server/agents/contract/docx/wordCommentParser')
        const mockFn = parseWordComments as ReturnType<typeof vi.fn>
        const comment: ParsedWordComment = {
            wId: 0,
            wAuthor: 'AI',
            wInitials: 'LEXSEEK-',
            content: '付款节点表述不清，建议明确',
            parentWId: null,
            dateIso: new Date().toISOString(),
            anchorParagraphIndex: 1,
        }
        mockFn.mockResolvedValueOnce({
            comments: [comment],
            annotationRefsByWId: new Map([
                [0, {
                    reviewId,
                    annotationId: commentAnn.id,
                    source: 'customXml',
                    ref: `LEXSEEK-${commentAnn.id}-bothmode`,
                }],
            ]),
            customXmlRefEntries: [{
                reviewId,
                annotationId: commentAnn.id,
                source: 'customXml',
                ref: `LEXSEEK-${commentAnn.id}-bothmode`,
            }],
        } satisfies ParsedDocxComments)

        const review = await prisma.contractReviews.findUniqueOrThrow({ where: { id: reviewId } })
        const events = await collectEvents(uploadClientVersionService({ review, ossFileId, userId }))
        expect(events.filter(e => e.type === 'error')).toHaveLength(0)

        // 修订风险被识别为 accepted
        const updatedRedline = await prisma.contractRisks.findUniqueOrThrow({ where: { id: redlineRisk.riskId } })
        expect(updatedRedline.clientRedlineDecision).toBe('accepted')
        // 批注风险走 comment 路径：命中后不应被标记 removedByClient，也不写 clientRedlineDecision
        const updatedCommentAnn = await prisma.contractAnnotations.findUniqueOrThrow({ where: { id: commentAnn.id } })
        expect(updatedCommentAnn.removedByClient).toBe(false)
        const updatedCommentRisk = await prisma.contractRisks.findUniqueOrThrow({ where: { id: commentRisk.id } })
        expect(updatedCommentRisk.clientRedlineDecision).toBeNull()
    })

    it('跨审查 redlineRefs（reviewId 不符）→ 忽略修订标记、不写 clientRedlineDecision', async () => {
        const clauseText = '违约金按合同总额的百分之五十计算。'
        const quote = '百分之五十'
        const start = clauseText.indexOf(quote)
        const { riskId } = await seedRiskWithAnnotation({
            clauseText,
            problematicQuote: quote,
            quoteCharStart: start,
            quoteCharEnd: start + quote.length,
            suggestedClauseText: '百分之十',
        })

        const base = await buildFixtureBuffer(FIXTURE_SINGLE)
        // 用一个明显不属于本审查的 reviewId 导出 redlineRefs.xml
        const exported = await injectRedlineMarks(
            base,
            [makeRedlineRisk({
                id: riskId,
                clauseText,
                clauseParagraphIndex: 0,
                problematicQuote: quote,
                quoteCharStart: start,
                quoteCharEnd: start + quote.length,
                suggestedClauseText: '百分之十',
            })],
            { reviewId: reviewId + 999_999, idStart: 5000 },
        )
        // 客户接受了修订，但 redlineRefs.xml 声明的 reviewId 与本审查不符
        setMockDocx(await acceptAllRedlines(exported.buffer))

        const review = await prisma.contractReviews.findUniqueOrThrow({ where: { id: reviewId } })
        const events = await collectEvents(uploadClientVersionService({ review, ossFileId, userId }))

        // 跨审查 redlineRefs 被忽略：refs 不参与覆盖率 → 该 docx 无任何身份可识别内容 → 触发保护
        const errorEvents = events.filter(e => e.type === 'error')
        expect(errorEvents).toHaveLength(1)
        const errData = errorEvents[0]!.data as { code: string; message: string }
        expect(errData.code).toBe('NO_CONTENT_MATCH')
        expect(errData.message).toContain('其他合同审查')

        // 修订标记被忽略 → 不写 clientRedlineDecision
        const risk = await prisma.contractRisks.findUniqueOrThrow({ where: { id: riskId } })
        expect(risk.clientRedlineDecision).toBeNull()
    })
})
