/**
 * uploadClientVersion.service 测试（B1 骨架）
 *
 * **Feature: contract-review-versioning-phase-b**
 * **Validates: Plan Task 1.5 B1 骨架**
 *
 * 测试范围：
 * 1. 骨架事件数量：5 个 progress + 1 个 complete
 * 2. 幂等跳过 auto_backup：无未保存编辑时只多 client_return 一条版本
 * 3. OSS 文件不存在 → 吐 parse error 事件
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { uploadClientVersionService } from '~~/server/services/assistant/contract/uploadClientVersion.service'
import { createOssFileDao } from '~~/server/services/files/ossFiles.dao'
import { saveContractReviewVersionService } from '~~/server/services/assistant/contract/contractReviewVersion.service'
import { ensureTestUser } from '../test-db-helper'
import type { ParsedDocxComments } from '~~/server/services/assistant/contract/docx/wordCommentParser'

// ============ mock storage.service：避免真实 OSS 下载 ============
// parseContractDocx 会被间接调用，给它一份有效的 docx buffer 代替
vi.mock('~~/server/services/storage/storage.service', () => ({
    downloadFileService: vi.fn(async () => {
        // 返回最小合法 docx：一段简单文本（测试不需要真实 Word 段落结构，
        // parseContractDocx 对空 buffer 会抛错，但我们直接 mock 整个 loadContractFullText 更稳妥）
        return Buffer.from('FAKE-DOCX')
    }),
    uploadFileService: vi.fn(),
    generateSignedUrlService: vi.fn(),
}))

// mock parseContractDocx，避免依赖真实 docx 解析库对假 buffer 的处理
vi.mock('~~/server/services/assistant/contract/docx/parser', () => ({
    parseContractDocx: vi.fn(async () => ({
        paragraphs: ['第一条 甲方应在合同签署后 30 日内支付首付款。', '第二条 乙方应提供相应服务。'],
        rawXml: '<root/>',
    })),
}))

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** 收集 AsyncGenerator 的所有事件 */
async function collectEvents(
    gen: AsyncGenerator<{ type: string; data: unknown }>,
): Promise<{ type: string; data: unknown }[]> {
    const events: { type: string; data: unknown }[] = []
    for await (const ev of gen) {
        events.push(ev)
    }
    return events
}

describe('uploadClientVersionService（B1 骨架）', () => {
    let userId: number
    let reviewId: number
    let ossFileId: number

    // 清理时用
    const createdOssFileIds: number[] = []

    beforeEach(async () => {
        userId = await ensureTestUser()

        // 创建基础 review（maxVersionNo=0，currentVersionId=null）
        const review = await prisma.contractReviews.create({
            data: {
                userId,
                status: 'completed',
                risks: [],
                sessionId: `upload-ver-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                originalFileId: 0,
                maxVersionNo: 0,
            },
        })
        reviewId = review.id

        // 创建一条 OSS 文件记录（指向假路径，download 已 mock）
        const oss = await createOssFileDao({
            userId,
            bucketName: 'test-bucket',
            fileName: 'client-return.docx',
            filePath: `users/${userId}/contract-reviews/client-${Date.now()}.docx`,
            fileSize: 1024,
            fileType: DOCX_MIME,
            status: 1,
        })
        ossFileId = oss.id
        createdOssFileIds.push(oss.id)
    })

    afterEach(async () => {
        await prisma.contractReviewVersions.deleteMany({ where: { reviewId } })
        await prisma.contractAnnotations.deleteMany({ where: { reviewId } })
        await prisma.contractRisks.deleteMany({ where: { reviewId } })
        await prisma.contractReviews.delete({ where: { id: reviewId } })
        if (createdOssFileIds.length > 0) {
            await prisma.ossFiles.deleteMany({ where: { id: { in: createdOssFileIds } } })
            createdOssFileIds.length = 0
        }
        // 清理 ensureTestUser 创建的用户
        await prisma.users.deleteMany({ where: { id: userId } })
    })

    it('骨架事件数量：5 个 progress + 1 个 complete', async () => {
        const review = await prisma.contractReviews.findUniqueOrThrow({ where: { id: reviewId } })
        const events = await collectEvents(
            uploadClientVersionService({ review, ossFileId, userId }),
        )

        const progressEvents = events.filter((e) => e.type === 'progress')
        const completeEvents = events.filter((e) => e.type === 'complete')
        const errorEvents = events.filter((e) => e.type === 'error')

        expect(errorEvents).toHaveLength(0)
        expect(progressEvents).toHaveLength(5) // backup / parse / diff / ai / merge
        expect(completeEvents).toHaveLength(1)

        // 验证 progress steps 顺序
        const steps = progressEvents.map((e) => (e.data as { step: string }).step)
        expect(steps).toEqual(['backup', 'parse', 'diff', 'ai', 'merge'])

        // complete 事件包含 newVersionId
        const completeData = completeEvents[0].data as { newVersionId: number; summary: string }
        expect(completeData.newVersionId).toBeGreaterThan(0)
        expect(typeof completeData.summary).toBe('string')
    })

    it('幂等跳过 auto_backup：无未保存编辑时只多 client_return 一条版本', async () => {
        // 先创建一个 v1 快照并设为 currentVersionId（此后不再添加 risk/annotation，模拟无未保存编辑）
        const v1 = await saveContractReviewVersionService({
            reviewId,
            systemLabel: 'lawyer_save',
            createdById: userId,
        })
        // 此时 currentVersionId = v1.id，没有比 v1.createdAt 更新的 risk/annotation
        // → detectUnsavedEdits 应返回 false → 不产生 auto_backup

        const review = await prisma.contractReviews.findUniqueOrThrow({ where: { id: reviewId } })
        const events = await collectEvents(
            uploadClientVersionService({ review, ossFileId, userId }),
        )

        const errorEvents = events.filter((e) => e.type === 'error')
        expect(errorEvents).toHaveLength(0)

        // 版本表：只有 lawyer_save（v1） + client_return（v2），没有 auto_backup
        const versions = await prisma.contractReviewVersions.findMany({
            where: { reviewId },
            orderBy: { versionNumber: 'asc' },
            select: { systemLabel: true, versionNumber: true },
        })
        const labels = versions.map((v) => v.systemLabel)
        expect(labels).not.toContain('auto_backup')
        expect(labels).toContain('client_return')
        // 共 2 条：lawyer_save + client_return
        expect(versions).toHaveLength(2)
    })

    it('律师修改批注内容后触发 auto_backup（覆盖 annotation.updatedAt 漏检修复验证）', async () => {
        // 先创建 v1 快照并设为 currentVersionId
        const v1 = await saveContractReviewVersionService({
            reviewId,
            systemLabel: 'lawyer_save',
            createdById: userId,
        })
        expect(v1.id).toBeGreaterThan(0)

        // 在 v1 快照之后预埋一条 risk + annotation（模拟律师在 v1 之后添加了批注）
        const risk = await prisma.contractRisks.create({
            data: {
                reviewId,
                source: 'ai',
                code: 'TEST-001',
                category: '测试分类',
                level: 'medium',
                problem: '测试风险',
                anchorQuote: '第一条',
            },
        })

        // 先创建批注（updatedAt == createdAt，此时已晚于 v1.createdAt）
        const ann = await prisma.contractAnnotations.create({
            data: {
                reviewId,
                riskId: risk.id,
                authorType: 'lawyer',
                authorName: '测试律师',
                authorUserId: userId,
                content: '初始批注内容',
            },
        })

        // 再 update content，触发 updatedAt 自动刷新（确保 updatedAt > v1.createdAt）
        await prisma.contractAnnotations.update({
            where: { id: ann.id },
            data: { content: '律师修订后的批注内容' },
        })

        const review = await prisma.contractReviews.findUniqueOrThrow({ where: { id: reviewId } })
        const events = await collectEvents(
            uploadClientVersionService({ review, ossFileId, userId }),
        )

        const errorEvents = events.filter((e) => e.type === 'error')
        expect(errorEvents).toHaveLength(0)

        // 验证 auto_backup 版本已被创建
        const versions = await prisma.contractReviewVersions.findMany({
            where: { reviewId },
            orderBy: { versionNumber: 'asc' },
            select: { systemLabel: true, versionNumber: true },
        })
        const labels = versions.map((v) => v.systemLabel)
        expect(labels).toContain('auto_backup')
        expect(labels).toContain('client_return')
        // 共 3 条：lawyer_save + auto_backup + client_return
        expect(versions).toHaveLength(3)
    })

    it('OSS 文件不存在 → error 事件（step=parse, code=PARSE_FAILED）', async () => {
        const review = await prisma.contractReviews.findUniqueOrThrow({ where: { id: reviewId } })
        // 使用一个确实不存在于 DB 的 ossFileId
        const nonExistentOssFileId = 999_999_999

        const events = await collectEvents(
            uploadClientVersionService({ review, ossFileId: nonExistentOssFileId, userId }),
        )

        const errorEvents = events.filter((e) => e.type === 'error')
        expect(errorEvents).toHaveLength(1)

        const errData = errorEvents[0].data as { step: string; code: string; message: string }
        expect(errData.step).toBe('parse')
        expect(errData.code).toBe('PARSE_FAILED')

        // backup progress 应已产出（backup 先于 parse）
        const progressEvents = events.filter((e) => e.type === 'progress')
        expect(progressEvents[0]).toMatchObject({ data: { step: 'backup', status: 'done' } })
    })
})

// ============================================================
// Phase B：customXml annotationRefs 映射识别测试
// ============================================================

// mock wordCommentParser，精确控制 annotationRefsByWId
vi.mock('~~/server/services/assistant/contract/docx/wordCommentParser', () => ({
    parseWordComments: vi.fn(async (): Promise<ParsedDocxComments> => ({
        comments: [],
        annotationRefsByWId: new Map(),
    })),
}))

describe('uploadClientVersionService（customXml 映射识别）', () => {
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
                sessionId: `upload-customxml-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                originalFileId: 0,
                maxVersionNo: 0,
            },
        })
        reviewId = review.id

        const oss = await createOssFileDao({
            userId,
            bucketName: 'test-bucket',
            fileName: 'client-customxml.docx',
            filePath: `users/${userId}/contract-reviews/customxml-${Date.now()}.docx`,
            fileSize: 1024,
            fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            status: 1,
        })
        ossFileId = oss.id
        createdOssFileIds.push(oss.id)
    })

    afterEach(async () => {
        await prisma.contractReviewVersions.deleteMany({ where: { reviewId } })
        await prisma.contractAnnotations.deleteMany({ where: { reviewId } })
        await prisma.contractRisks.deleteMany({ where: { reviewId } })
        await prisma.contractReviews.delete({ where: { id: reviewId } })
        if (createdOssFileIds.length > 0) {
            await prisma.ossFiles.deleteMany({ where: { id: { in: createdOssFileIds } } })
            createdOssFileIds.length = 0
        }
        await prisma.users.deleteMany({ where: { id: userId } })
    })

    it('customXml 映射命中：系统 annotation 不产生 removedByClient 也不产生 external_new', async () => {
        // 预置：1 条系统 AI annotation（id 动态分配）
        const risk = await prisma.contractRisks.create({
            data: {
                reviewId,
                source: 'ai',
                category: '合同风险',
                level: 'medium',
                problem: '违约金偏高',
                anchorQuote: '第一条',
            },
        })
        const ann = await prisma.contractAnnotations.create({
            data: {
                reviewId,
                riskId: risk.id,
                authorType: 'ai',
                authorName: 'AI',
                content: '违约金偏高，建议调整',
                wordCommentRef: `LEXSEEK-${risk.id}-abc12345`,
            },
        })

        // mock parseWordComments 返回：系统批注通过 customXml 映射到 ann.id
        const { parseWordComments } = await import('~~/server/services/assistant/contract/docx/wordCommentParser')
        const mockFn = parseWordComments as ReturnType<typeof vi.fn>
        mockFn.mockResolvedValueOnce({
            comments: [
                {
                    wId: 0,
                    wAuthor: 'LS:AI',
                    // 模拟 Word 截断后的 initials（不含完整格式，但 customXml 有完整映射）
                    wInitials: 'LEXSEEK-',
                    content: '违约金偏高，建议调整',
                    parentWId: null,
                    dateIso: new Date().toISOString(),
                },
            ],
            annotationRefsByWId: new Map([
                [0, { annotationId: ann.id, ref: `LEXSEEK-${ann.id}-abc12345` }],
            ]),
        } satisfies ParsedDocxComments)

        const review = await prisma.contractReviews.findUniqueOrThrow({ where: { id: reviewId } })
        const events = await collectEvents(
            uploadClientVersionService({ review, ossFileId, userId }),
        )

        const errorEvents = events.filter(e => e.type === 'error')
        expect(errorEvents).toHaveLength(0)

        // 关键断言：系统 annotation 被正确识别，不应被标记 removedByClient
        const updatedAnn = await prisma.contractAnnotations.findUniqueOrThrow({ where: { id: ann.id } })
        expect(updatedAnn.removedByClient).toBe(false)

        // 不应有 external_new source 的 risk 产生
        const externalRisks = await prisma.contractRisks.findMany({
            where: { reviewId, source: 'external_new' },
        })
        expect(externalRisks).toHaveLength(0)
    })
})
