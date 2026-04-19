/**
 * 合同审查 PDF 导出服务测试
 *
 * 覆盖：
 *  - includeRisks=false 生成最小 PDF（%PDF 头、buffer > 1KB）
 *  - includeRisks=true 含 3 条风险，体积显著大于 false 版本
 *  - summary 为 null 时不崩
 *  - risks 为 null + includeRisks=true 时不崩，显示"无风险记录"
 *  - reviewId 不存在抛 "review not found"
 *  - reviewId 存在但非 owner 抛 "review not found"（owner 校验归一到 not found 保护信息）
 *
 * **Feature: contract-review-m6.2**
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { ensureTestUser, cleanupTestData } from '../test-db-helper'
import { exportReviewPdfService } from '~~/server/services/assistant/contract/contractReviewPdf.service'
import type { Risk } from '#shared/types/contract'

describe('exportReviewPdfService', () => {
    let ownerUserId: number
    let otherUserId: number
    let fileId: number
    const createdReviewIds: number[] = []
    const createdFileIds: number[] = []

    beforeAll(async () => {
        ownerUserId = await ensureTestUser()
        otherUserId = await ensureTestUser()
        const file = await prisma.ossFiles.create({
            data: {
                userId: ownerUserId,
                bucketName: 'test-bucket',
                fileName: '劳动合同_甲方公司.docx',
                filePath: `test/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.docx`,
                fileSize: 2048,
                fileType:
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            },
        })
        fileId = file.id
        createdFileIds.push(file.id)
    })

    afterEach(async () => {
        if (createdReviewIds.length > 0) {
            await prisma.contractReviews.deleteMany({
                where: { id: { in: createdReviewIds } },
            })
            createdReviewIds.length = 0
        }
    })

    afterAll(async () => {
        if (createdFileIds.length > 0) {
            await prisma.ossFiles.deleteMany({
                where: { id: { in: createdFileIds } },
            })
        }
        await cleanupTestData()
    })

    function makeRisks(): Risk[] {
        return [
            {
                id: '11111111-1111-1111-1111-111111111111',
                clauseIndex: 3,
                clauseText: '第三条 付款条款：甲方应在合同签订后 7 日内支付全部款项。',
                level: 'high',
                category: '付款',
                problem: '付款期限过短，不利于乙方资金周转',
                legalBasis: '《民法典》第 509 条',
                analysis: '单方压缩付款周期可能导致违约风险显著上升。',
                risk: '乙方可能因迟延付款承担违约金。',
                suggestion: '建议调整为 30 日内付款，并分期执行。',
                suggestedClauseText: '第三条 付款条款：甲方应在合同签订后 30 日内支付 50%，剩余款项按进度支付。',
            },
            {
                id: '22222222-2222-2222-2222-222222222222',
                clauseIndex: 7,
                clauseText: '第七条 违约责任：任何一方违约承担合同总额 50% 违约金。',
                level: 'medium',
                category: '违约',
                problem: '违约金比例畸高',
                analysis: '畸高违约金可能被法院酌减。',
                risk: '实际执行时违约金可能被调整，影响预期。',
                suggestion: '建议按实际损失核算违约金，上限不超过 20%。',
                suggestedClauseText: '第七条 违约责任：任何一方违约按实际损失赔偿，上限为合同总额 20%。',
            },
            {
                id: '33333333-3333-3333-3333-333333333333',
                clauseIndex: 12,
                clauseText: '第十二条 争议解决：提交甲方所在地法院审理。',
                level: 'low',
                category: '争议解决',
                problem: '管辖条款对乙方略不利',
                analysis: '单边管辖可能被认定为格式条款无效。',
                risk: '争议发生时管辖地可能被挑战。',
                suggestion: '建议改为合同签订地或双方共同指定。',
            },
        ]
    }

    async function createReview(opts: {
        userId: number
        summary?: string | null
        risks?: Risk[] | null
    }) {
        const row = await prisma.contractReviews.create({
            data: {
                userId: opts.userId,
                sessionId: `pdf-test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
                originalFileId: fileId,
                status: 'completed',
                contractType: '劳动合同',
                partyA: '甲方公司',
                partyB: '乙方个人',
                stance: 'partyB',
                summary: opts.summary === undefined ? '# 摘要\n本合同存在**付款**和 **违约金** 两项主要风险。' : opts.summary,
                risks: (opts.risks === undefined ? [] : opts.risks) as any,
            },
        })
        createdReviewIds.push(row.id)
        return row
    }

    it('includeRisks=false 生成 PDF，首 4 字节为 %PDF 且体积 > 1KB', async () => {
        const review = await createReview({ userId: ownerUserId })
        const buf = await exportReviewPdfService(review.id, ownerUserId, {
            includeRisks: false,
        })
        expect(buf).toBeInstanceOf(Buffer)
        expect(buf.length).toBeGreaterThan(1000)
        expect(buf.subarray(0, 4).toString()).toBe('%PDF')
    })

    it('includeRisks=true 含 3 条风险时 PDF 体积显著大于 false 版本', async () => {
        const review = await createReview({ userId: ownerUserId, risks: makeRisks() })
        const [withRisks, withoutRisks] = await Promise.all([
            exportReviewPdfService(review.id, ownerUserId, { includeRisks: true }),
            exportReviewPdfService(review.id, ownerUserId, { includeRisks: false }),
        ])
        expect(withRisks.subarray(0, 4).toString()).toBe('%PDF')
        expect(withoutRisks.subarray(0, 4).toString()).toBe('%PDF')
        expect(withRisks.length - withoutRisks.length).toBeGreaterThan(500)
    })

    it('summary=null 时不崩，正常生成 PDF', async () => {
        const review = await createReview({ userId: ownerUserId, summary: null })
        const buf = await exportReviewPdfService(review.id, ownerUserId, {
            includeRisks: false,
        })
        expect(buf.subarray(0, 4).toString()).toBe('%PDF')
    })

    it('risks=null 且 includeRisks=true 时不崩', async () => {
        const review = await createReview({ userId: ownerUserId, risks: null })
        const buf = await exportReviewPdfService(review.id, ownerUserId, {
            includeRisks: true,
        })
        expect(buf.subarray(0, 4).toString()).toBe('%PDF')
    })

    it('reviewId 不存在应抛 review not found', async () => {
        await expect(
            exportReviewPdfService(999999999, ownerUserId, { includeRisks: false }),
        ).rejects.toThrow('review not found')
    })

    it('非 owner 请求应抛 review not found（owner 校验）', async () => {
        const review = await createReview({ userId: ownerUserId })
        await expect(
            exportReviewPdfService(review.id, otherUserId, { includeRisks: false }),
        ).rejects.toThrow('review not found')
    })
})
