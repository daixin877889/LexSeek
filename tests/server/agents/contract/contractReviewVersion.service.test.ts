/**
 * contractReviewVersion.service 单元测试
 *
 * 覆盖目标：90%+ 行覆盖率
 *
 * 测试范围（saveContractReviewVersionService）：
 * - review 不存在 → ReviewNotFoundError
 * - review 已软删 → ReviewNotFoundError
 * - 首次保存（currentVersionId=null）使用入参 docxText/clauses
 * - 后续保存（currentVersionId 存在）从前版本继承 docxText/clauses
 * - lawyerNote 持久化 + 默认 null
 * - docxFileId 持久化 + 默认 null
 *
 * 测试范围（loadContractReviewVersionSnapshotService）：
 * - version_not_found
 * - 完整 snapshot 解析（risks/annotations/clauses/docxText）
 * - 脏数据降级（snapshot 非数组字段）
 *
 * 测试范围（downloadContractReviewVersionService）：
 * - version_not_found
 * - snapshot_invalid（risks 不是数组）
 * - origin_file_missing（baseFileId 为空）
 * - origin_file_missing（findOssFileByIdDao 返回 null / filePath 空）
 * - inject_failed（injectAnnotations 抛错）
 * - inject_failed（uploadAndRegisterOssFile 抛错触发清孤儿）
 * - happy path（含 wordCommentRef null 时回 DB 兜底）
 *
 * 使用 vi.mock 隔离 OSS / docx / 复杂 Prisma 查询。
 *
 * **Validates: 阶段 8 测试覆盖率提升**
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { prisma } from '~~/server/utils/db'
import {
    saveContractReviewVersionService,
    loadContractReviewVersionSnapshotService,
    downloadContractReviewVersionService,
    ReviewNotFoundError,
} from '~~/server/agents/contract/contractReviewVersion.service'
import { ensureTestUser } from '../../assistant/test-db-helper'

// ==================== Mock 外部 OSS / docx 依赖 ====================

vi.mock('~~/server/services/storage/storage.service', () => ({
    downloadFileService: vi.fn(),
    generateSignedUrlService: vi.fn(),
    deleteFileService: vi.fn(),
}))

vi.mock('~~/server/services/files/ossFiles.dao', () => ({
    findOssFileByIdDao: vi.fn(),
}))

vi.mock('~~/server/agents/contract/docx', () => ({
    injectAnnotations: vi.fn(),
}))

vi.mock('~~/server/agents/contract/utils/uploadAndRegisterOssFile', () => ({
    uploadAndRegisterOssFile: vi.fn(),
}))

import {
    downloadFileService,
    generateSignedUrlService,
    deleteFileService,
} from '~~/server/services/storage/storage.service'
import { findOssFileByIdDao } from '~~/server/services/files/ossFiles.dao'
import { injectAnnotations } from '~~/server/agents/contract/docx'
import { uploadAndRegisterOssFile } from '~~/server/agents/contract/utils/uploadAndRegisterOssFile'

const mockDownload = downloadFileService as ReturnType<typeof vi.fn>
const mockSignUrl = generateSignedUrlService as ReturnType<typeof vi.fn>
const mockDelete = deleteFileService as ReturnType<typeof vi.fn>
const mockFindOss = findOssFileByIdDao as ReturnType<typeof vi.fn>
const mockInject = injectAnnotations as ReturnType<typeof vi.fn>
const mockUploadReg = uploadAndRegisterOssFile as ReturnType<typeof vi.fn>

describe('contractReviewVersion.service', () => {
    let userId: number
    let reviewId: number

    beforeEach(async () => {
        vi.clearAllMocks()
        userId = await ensureTestUser()
        const review = await prisma.contractReviews.create({
            data: {
                userId,
                status: 'completed',
                risks: [],
                sessionId: `version-svc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                originalFileId: 100, // 假定存在
                maxVersionNo: 0,
            },
        })
        reviewId = review.id
    })

    afterEach(async () => {
        await prisma.contractReviewVersions.deleteMany({ where: { reviewId } })
        await prisma.contractAnnotations.deleteMany({ where: { reviewId } })
        await prisma.contractRisks.deleteMany({ where: { reviewId } })
        await prisma.contractReviews.delete({ where: { id: reviewId } })
        await prisma.users.deleteMany({ where: { id: userId } })
    })

    describe('saveContractReviewVersionService', () => {
        it('review 不存在 → ReviewNotFoundError', async () => {
            await expect(
                saveContractReviewVersionService({
                    reviewId: 99999999,
                    systemLabel: 'lawyer_save',
                    createdById: userId,
                }),
            ).rejects.toThrow(ReviewNotFoundError)
        })

        it('review 已软删 → ReviewNotFoundError', async () => {
            await prisma.contractReviews.update({
                where: { id: reviewId },
                data: { deletedAt: new Date() },
            })
            await expect(
                saveContractReviewVersionService({
                    reviewId,
                    systemLabel: 'lawyer_save',
                    createdById: userId,
                }),
            ).rejects.toThrow(ReviewNotFoundError)
        })

        it('首次保存（currentVersionId=null）使用入参 docxText/clauses', async () => {
            const v = await saveContractReviewVersionService({
                reviewId,
                systemLabel: 'lawyer_save',
                createdById: userId,
                docxText: '原文 A',
                clauses: [{ index: 1, text: 'c1', offsetStart: 0, offsetEnd: 2 }],
            })
            expect(v.versionNumber).toBe(1)
            // currentVersionId 已被更新
            const after = await prisma.contractReviews.findUnique({ where: { id: reviewId } })
            expect(after?.currentVersionId).toBe(v.id)
            expect(after?.maxVersionNo).toBe(1)
            // snapshot 含传入字段
            const snapshot = v.snapshotData as any
            expect(snapshot.docxText).toBe('原文 A')
            expect(snapshot.clauses).toEqual([{ index: 1, text: 'c1', offsetStart: 0, offsetEnd: 2 }])
        })

        it('后续保存从前版本继承 docxText/clauses（未传时）', async () => {
            const v1 = await saveContractReviewVersionService({
                reviewId, systemLabel: 'initial_upload', createdById: userId,
                docxText: '继承用文本',
                clauses: [{ index: 1, text: 'inherited', offsetStart: 0, offsetEnd: 9 }],
            })
            // 不传 docxText/clauses → 应继承 v1
            const v2 = await saveContractReviewVersionService({
                reviewId, systemLabel: 'lawyer_save', createdById: userId,
            })
            expect(v2.versionNumber).toBe(2)
            expect(v2.id).not.toBe(v1.id)
            const snapshot = v2.snapshotData as any
            expect(snapshot.docxText).toBe('继承用文本')
            expect(snapshot.clauses).toHaveLength(1)
        })

        it('lawyerNote 持久化', async () => {
            const v = await saveContractReviewVersionService({
                reviewId, systemLabel: 'lawyer_save', createdById: userId,
                lawyerNote: '版本备注',
            })
            expect(v.lawyerNote).toBe('版本备注')
        })

        it('lawyerNote 默认 null', async () => {
            const v = await saveContractReviewVersionService({
                reviewId, systemLabel: 'lawyer_save', createdById: userId,
            })
            expect(v.lawyerNote).toBeNull()
        })

        it('docxFileId 持久化 + 默认 null', async () => {
            const v1 = await saveContractReviewVersionService({
                reviewId, systemLabel: 'initial_upload', createdById: userId,
                docxFileId: 12345,
            })
            expect(v1.docxFileId).toBe(12345)

            const v2 = await saveContractReviewVersionService({
                reviewId, systemLabel: 'lawyer_save', createdById: userId,
            })
            expect(v2.docxFileId).toBeNull()
        })

        it('快照含工作区当前 risks + annotations', async () => {
            // 预埋 risk + annotation
            const risk = await prisma.contractRisks.create({
                data: {
                    reviewId, source: 'ai', category: 'test',
                    level: 'medium', stance: 'balanced',
                    problem: 'p', anchorQuote: 'q',
                    anchorParagraphIndex: 0,
                },
            })
            await prisma.contractAnnotations.create({
                data: { reviewId, riskId: risk.id, authorType: 'ai', authorName: 'AI', content: 'c' },
            })
            const v = await saveContractReviewVersionService({
                reviewId, systemLabel: 'lawyer_save', createdById: userId,
            })
            const snapshot = v.snapshotData as any
            expect(snapshot.risks).toHaveLength(1)
            expect(snapshot.annotations).toHaveLength(1)
        })

        it('快照排除已软删的 annotation', async () => {
            const risk = await prisma.contractRisks.create({
                data: {
                    reviewId, source: 'ai', category: 'test',
                    level: 'medium', stance: 'balanced',
                    problem: 'p', anchorQuote: 'q',
                    anchorParagraphIndex: 0,
                },
            })
            await prisma.contractAnnotations.create({
                data: { reviewId, riskId: risk.id, authorType: 'ai', authorName: 'AI', content: 'c' },
            })
            const ann2 = await prisma.contractAnnotations.create({
                data: { reviewId, riskId: risk.id, authorType: 'ai', authorName: 'AI', content: 'd' },
            })
            await prisma.contractAnnotations.update({
                where: { id: ann2.id },
                data: { deletedAt: new Date() },
            })
            const v = await saveContractReviewVersionService({
                reviewId, systemLabel: 'lawyer_save', createdById: userId,
            })
            const snapshot = v.snapshotData as any
            expect(snapshot.annotations).toHaveLength(1)
        })
    })

    describe('loadContractReviewVersionSnapshotService', () => {
        it('未知 versionId → version_not_found', async () => {
            const r = await loadContractReviewVersionSnapshotService(99999999)
            expect(r).toEqual({ error: 'version_not_found' })
        })

        it('happy path：返回完整 snapshot + createdByName', async () => {
            const v = await saveContractReviewVersionService({
                reviewId, systemLabel: 'lawyer_save', createdById: userId,
                docxText: '正文', clauses: [{ index: 1, text: 'a', offsetStart: 0, offsetEnd: 1 }],
            })
            const r = await loadContractReviewVersionSnapshotService(v.id)
            expect('data' in r).toBe(true)
            if ('data' in r) {
                expect(r.data.id).toBe(v.id)
                expect(r.data.versionNumber).toBe(1)
                expect(r.data.snapshot.docxText).toBe('正文')
                expect(r.data.snapshot.clauses).toHaveLength(1)
                expect(r.data.createdByName).toBeTruthy()
            }
        })

        it('snapshotData 中 risks/annotations 非数组 → 降级为空数组', async () => {
            // 直接通过 DAO 制造脏数据
            const v = await prisma.contractReviewVersions.create({
                data: {
                    reviewId, versionNumber: 99, systemLabel: 'lawyer_save',
                    snapshotData: { risks: 'not-an-array', annotations: null, docxText: 123, clauses: 'x' },
                    createdById: userId,
                },
            })
            const r = await loadContractReviewVersionSnapshotService(v.id)
            if ('data' in r) {
                expect(r.data.snapshot.risks).toEqual([])
                expect(r.data.snapshot.annotations).toEqual([])
                expect(r.data.snapshot.docxText).toBe('')
                expect(r.data.snapshot.clauses).toEqual([])
            }
        })

        it('snapshotData 完全是 null 也安全', async () => {
            const v = await prisma.contractReviewVersions.create({
                data: {
                    reviewId, versionNumber: 99, systemLabel: 'lawyer_save',
                    snapshotData: null as any,
                    createdById: userId,
                },
            })
            const r = await loadContractReviewVersionSnapshotService(v.id)
            expect('data' in r).toBe(true)
        })
    })

    describe('downloadContractReviewVersionService', () => {
        let baseReview: any
        beforeEach(async () => {
            baseReview = await prisma.contractReviews.findUniqueOrThrow({ where: { id: reviewId } })
        })

        it('未知 versionId → version_not_found', async () => {
            const r = await downloadContractReviewVersionService(baseReview, 99999999)
            expect(r).toEqual({ error: 'version_not_found' })
        })

        it('snapshot.risks 不是数组 → snapshot_invalid', async () => {
            const v = await prisma.contractReviewVersions.create({
                data: {
                    reviewId, versionNumber: 99, systemLabel: 'lawyer_save',
                    snapshotData: { risks: 'invalid', annotations: [] },
                    createdById: userId,
                },
            })
            const r = await downloadContractReviewVersionService(baseReview, v.id)
            expect(r).toEqual({ error: 'snapshot_invalid' })
        })

        it('snapshot.annotations 不是数组 → snapshot_invalid', async () => {
            const v = await prisma.contractReviewVersions.create({
                data: {
                    reviewId, versionNumber: 99, systemLabel: 'lawyer_save',
                    snapshotData: { risks: [], annotations: 'invalid' },
                    createdById: userId,
                },
            })
            const r = await downloadContractReviewVersionService(baseReview, v.id)
            expect(r).toEqual({ error: 'snapshot_invalid' })
        })

        it('snapshotData 为 null → snapshot_invalid', async () => {
            const v = await prisma.contractReviewVersions.create({
                data: {
                    reviewId, versionNumber: 99, systemLabel: 'lawyer_save',
                    snapshotData: null as any,
                    createdById: userId,
                },
            })
            const r = await downloadContractReviewVersionService(baseReview, v.id)
            expect(r).toEqual({ error: 'snapshot_invalid' })
        })

        it('baseFileId 为空（version.docxFileId=null + review.originalFileId=0）→ origin_file_missing', async () => {
            const reviewWithNoFile = await prisma.contractReviews.update({
                where: { id: reviewId },
                data: { originalFileId: 0 },
            })
            const v = await prisma.contractReviewVersions.create({
                data: {
                    reviewId, versionNumber: 99, systemLabel: 'lawyer_save',
                    snapshotData: { risks: [], annotations: [] },
                    createdById: userId,
                },
            })
            mockFindOss.mockResolvedValue(null)
            const r = await downloadContractReviewVersionService(reviewWithNoFile, v.id)
            expect(r).toEqual({ error: 'origin_file_missing' })
        })

        it('findOssFileByIdDao 返回 null → origin_file_missing', async () => {
            const v = await prisma.contractReviewVersions.create({
                data: {
                    reviewId, versionNumber: 99, systemLabel: 'lawyer_save',
                    snapshotData: { risks: [], annotations: [] },
                    createdById: userId,
                    docxFileId: 100,
                },
            })
            mockFindOss.mockResolvedValue(null)
            const r = await downloadContractReviewVersionService(baseReview, v.id)
            expect(r).toEqual({ error: 'origin_file_missing' })
        })

        it('ossFile.filePath 为空 → origin_file_missing', async () => {
            const v = await prisma.contractReviewVersions.create({
                data: {
                    reviewId, versionNumber: 99, systemLabel: 'lawyer_save',
                    snapshotData: { risks: [], annotations: [] },
                    createdById: userId,
                    docxFileId: 100,
                },
            })
            mockFindOss.mockResolvedValue({ id: 100, filePath: '', fileName: 'x.docx' })
            const r = await downloadContractReviewVersionService(baseReview, v.id)
            expect(r).toEqual({ error: 'origin_file_missing' })
        })

        it('injectAnnotations 抛错 → inject_failed', async () => {
            const v = await prisma.contractReviewVersions.create({
                data: {
                    reviewId, versionNumber: 99, systemLabel: 'lawyer_save',
                    snapshotData: { risks: [], annotations: [] },
                    createdById: userId,
                    docxFileId: 100,
                },
            })
            mockFindOss.mockResolvedValue({ id: 100, filePath: 'p/q.docx', fileName: 'q.docx' })
            mockDownload.mockResolvedValue(Buffer.from('docx'))
            mockInject.mockRejectedValue(new Error('inject crashed'))
            const r = await downloadContractReviewVersionService(baseReview, v.id)
            expect(r).toEqual({ error: 'inject_failed' })
        })

        it('happy path：返回 downloadUrl + filename', async () => {
            const risk = {
                id: 1, anchorQuote: '原文', anchorParagraphIndex: 0,
                level: 'medium', category: 'test', problem: 'p',
                analysis: 'a', suggestion: 's',
                source: 'ai', stance: 'balanced',
            }
            const annotation = {
                id: 10, riskId: 1, authorType: 'ai', authorName: 'AI',
                content: 'c', parentAnnotationId: null,
                wordCommentRef: 'LEXSEEK-10-abcd1234',
                createdAt: new Date().toISOString(),
            }
            const v = await prisma.contractReviewVersions.create({
                data: {
                    reviewId, versionNumber: 1, systemLabel: 'lawyer_save',
                    snapshotData: { risks: [risk], annotations: [annotation] },
                    createdById: userId,
                    docxFileId: 100,
                },
            })
            mockFindOss.mockResolvedValue({ id: 100, filePath: 'p/q.docx', fileName: '合同.docx' })
            mockDownload.mockResolvedValue(Buffer.from('docx'))
            mockInject.mockResolvedValue({ buffer: Buffer.from('injected'), refsByAnnotationId: new Map() })
            mockUploadReg.mockResolvedValue({ uploadName: 'oss/v.docx', bucketName: 'b', ossFileId: 999 })
            mockSignUrl.mockResolvedValue('https://signed.example/download')

            const r = await downloadContractReviewVersionService(baseReview, v.id)
            expect('data' in r).toBe(true)
            if ('data' in r) {
                expect(r.data.downloadUrl).toBe('https://signed.example/download')
                expect(r.data.filename).toMatch(/^合同_v1_\d{4}-\d{2}-\d{2}\.docx$/)
            }
        })

        it('happy path：snapshot wordCommentRef=null 时回 DB 兜底取 ref', async () => {
            // 真建一个 annotation 行用于回 DB 查询
            const dbRisk = await prisma.contractRisks.create({
                data: {
                    reviewId, source: 'ai', category: 't',
                    level: 'low', stance: 'balanced',
                    problem: 'p', anchorQuote: 'q',
                    anchorParagraphIndex: 0,
                },
            })
            const dbAnn = await prisma.contractAnnotations.create({
                data: {
                    reviewId, riskId: dbRisk.id,
                    authorType: 'ai', authorName: 'AI', content: 'c',
                    wordCommentRef: 'LEXSEEK-X-fromDB12',
                },
            })
            // 构造 snapshot 中相同 id 的 annotation 但 wordCommentRef=null
            const v = await prisma.contractReviewVersions.create({
                data: {
                    reviewId, versionNumber: 2, systemLabel: 'lawyer_save',
                    snapshotData: {
                        risks: [{ id: dbRisk.id, anchorQuote: 'q', anchorParagraphIndex: 0, level: 'low', category: 't', problem: 'p' }],
                        annotations: [{ id: dbAnn.id, riskId: dbRisk.id, authorType: 'ai', authorName: 'AI', content: 'c', parentAnnotationId: null, wordCommentRef: null }],
                    },
                    createdById: userId,
                    docxFileId: 100,
                },
            })
            mockFindOss.mockResolvedValue({ id: 100, filePath: 'p/q.docx', fileName: '合同.docx' })
            mockDownload.mockResolvedValue(Buffer.from('docx'))
            mockInject.mockResolvedValue({ buffer: Buffer.from('injected'), refsByAnnotationId: new Map() })
            mockUploadReg.mockResolvedValue({ uploadName: 'oss/v.docx', bucketName: 'b', ossFileId: 999 })
            mockSignUrl.mockResolvedValue('https://x')

            const r = await downloadContractReviewVersionService(baseReview, v.id)
            expect('data' in r).toBe(true)
            // injectAnnotations 收到的 annotation 应该 wordCommentRef = DB 兜底值
            const injectArg = mockInject.mock.calls[0]?.[1] as any[]
            expect(injectArg[0].wordCommentRef).toBe('LEXSEEK-X-fromDB12')
        })

        it('signedUrl 抛错 → 触发孤儿清理 + inject_failed', async () => {
            const risk = { id: 1, anchorQuote: 'q', anchorParagraphIndex: 0, level: 'low', category: 't', problem: 'p' }
            const annotation = { id: 10, riskId: 1, authorType: 'ai', authorName: 'AI', content: 'c', parentAnnotationId: null, wordCommentRef: 'LEXSEEK-10-abcd1234' }
            const v = await prisma.contractReviewVersions.create({
                data: {
                    reviewId, versionNumber: 1, systemLabel: 'lawyer_save',
                    snapshotData: { risks: [risk], annotations: [annotation] },
                    createdById: userId,
                    docxFileId: 100,
                },
            })
            mockFindOss.mockResolvedValue({ id: 100, filePath: 'p/q.docx', fileName: '合同.docx' })
            mockDownload.mockResolvedValue(Buffer.from('docx'))
            mockInject.mockResolvedValue({ buffer: Buffer.from('injected'), refsByAnnotationId: new Map() })
            mockUploadReg.mockResolvedValue({ uploadName: 'oss/v.docx', bucketName: 'b', ossFileId: 999 })
            mockSignUrl.mockRejectedValue(new Error('sign URL 抛错'))
            mockDelete.mockResolvedValue(undefined)

            const r = await downloadContractReviewVersionService(baseReview, v.id)
            expect(r).toEqual({ error: 'inject_failed' })
            expect(mockDelete).toHaveBeenCalledWith('oss/v.docx', expect.objectContaining({ userId }))
        })

        it('signedUrl 抛错 + delete 也抛错 → 仍返回 inject_failed（不冒泡 cleanup error）', async () => {
            const risk = { id: 1, anchorQuote: 'q', anchorParagraphIndex: 0, level: 'low', category: 't', problem: 'p' }
            const annotation = { id: 10, riskId: 1, authorType: 'ai', authorName: 'AI', content: 'c', parentAnnotationId: null, wordCommentRef: 'LEXSEEK-10-abcd1234' }
            const v = await prisma.contractReviewVersions.create({
                data: {
                    reviewId, versionNumber: 1, systemLabel: 'lawyer_save',
                    snapshotData: { risks: [risk], annotations: [annotation] },
                    createdById: userId,
                    docxFileId: 100,
                },
            })
            mockFindOss.mockResolvedValue({ id: 100, filePath: 'p/q.docx', fileName: '合同.docx' })
            mockDownload.mockResolvedValue(Buffer.from('docx'))
            mockInject.mockResolvedValue({ buffer: Buffer.from('injected'), refsByAnnotationId: new Map() })
            mockUploadReg.mockResolvedValue({ uploadName: 'oss/v.docx', bucketName: 'b', ossFileId: 999 })
            mockSignUrl.mockRejectedValue(new Error('sign URL 抛错'))
            mockDelete.mockRejectedValue(new Error('清孤儿失败'))

            const r = await downloadContractReviewVersionService(baseReview, v.id)
            expect(r).toEqual({ error: 'inject_failed' })
        })
    })
})
