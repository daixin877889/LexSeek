/**
 * M5 合同审查闭环集成测试
 *
 * 验证 Task 2（PATCH risks）+ Task 3（rebuild-docx）新端点与真实 DB 链路联动：
 *   1. 成功：completed → rebuilding → completed，reviewedFileId 被替换
 *   2. 并发：预置 rebuilding 后再次调用直接被拒（前置 409 / atomicSet 429 共同构成防线）
 *   3. 失败：injectComments 抛异常 → rollback，status 回 completed + reviewedFileId 不漂移
 *
 * storage.service / docx.injectComments / storageConfig 整体 mock；DAO + handler 走真实 DB。
 *
 * **Feature: contract-review-m5**
 * **Validates: Plan Task 10 / Spec §8.3 §8.4 闭环**
 */
import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest'

// ==================== 全局 Stub（Nuxt nitro 自动导入）====================
;(globalThis as any).resError = (_e: any, code: number, message: string) => ({ code, success: false, message, data: null })
;(globalThis as any).resSuccess = (_e: any, message: string, data: any) => ({ code: 0, success: true, message, data })
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).getRouterParam = (e: any, k: string) => e.__params?.[k]
;(globalThis as any).readBody = (e: any) => Promise.resolve(e.__body)
;(globalThis as any).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }

// ==================== mock 对外依赖（OSS / docx 注入 / 存储配置 / 批注查询）====================
vi.mock('~~/server/services/storage/storage.service', () => ({
    downloadFileService: vi.fn(async () => Buffer.from('FAKE-ORIG-DOCX')),
    uploadFileService: vi.fn(async (path: string) => ({ name: path, url: `https://oss.example.com/${path}` })),
    generateSignedUrlService: vi.fn(async (path: string) => `https://oss.example.com/${path}?sig=fake&expires=3600`),
}))
vi.mock('~~/server/services/assistant/contract/docx', () => ({
    // Phase B：injectAnnotations 替代 injectComments 作为 rebuildDocxService 的入口
    injectAnnotations: vi.fn(async () => ({
        buffer: Buffer.from('FAKE-REVIEWED-DOCX'),
        refsByAnnotationId: new Map(),
    })),
}))
vi.mock('~~/server/services/assistant/contract/contractAnnotation.dao', () => ({
    listAnnotationsForExportDAO: vi.fn(async () => []),
}))
vi.mock('~~/server/services/storage/storageConfig.dao', () => ({
    getDefaultStorageConfigDao: vi.fn(async () => ({ bucket: 'test-bucket' })),
}))

const { default: patchHandler } = await import(
    '../../../../server/api/v1/assistant/contract/reviews/[id]/index.patch'
)
const { default: rebuildHandler } = await import(
    '../../../../server/api/v1/assistant/contract/reviews/[id]/rebuild-docx.post'
)
import { injectAnnotations } from '~~/server/services/assistant/contract/docx'
import { listAnnotationsForExportDAO } from '~~/server/services/assistant/contract/contractAnnotation.dao'
import {
    createContractReviewDAO,
    getContractReviewDAO,
    updateContractReviewDAO,
} from '~~/server/services/assistant/contract/contractReview.dao'
import { createOssFileDao } from '~~/server/services/files/ossFiles.dao'
import { prisma } from '~~/server/utils/db'
import { ensureTestUser, cleanupTestData } from '../test-db-helper'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const makeEvent = (userId: number, id: string, body?: any) => ({
    context: { auth: { user: { id: userId } } },
    __params: { id },
    __body: body,
}) as any

// refine 需要 high level 必带 suggestedClauseText
const buildRisk = (idx: number, text = '新条款文本') => ({
    id: crypto.randomUUID(),
    clauseIndex: idx,
    clauseText: `条款${idx}原文`,
    level: 'high',
    category: '付款',
    problem: '付款期限不明',
    analysis: '条款未约定具体付款期限',
    risk: '可能导致催收困难',
    suggestion: '补充明确付款期限',
    suggestedClauseText: text,
})

describe('M5 合同审查闭环（PATCH + rebuild-docx + 真实 DB 链路）', () => {
    let userId: number
    const reviewIds: number[] = []
    const ossFileIds: number[] = []

    const seedOssFile = async (tag: string) => {
        const f = await createOssFileDao({
            userId,
            bucketName: 'test-bucket',
            fileName: `contract-${tag}.docx`,
            filePath: `users/${userId}/contract-reviews/${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.docx`,
            fileSize: 1024,
            fileType: DOCX_MIME,
            status: 1,
        })
        ossFileIds.push(f.id)
        return f
    }

    const seedCompletedReview = async () => {
        const original = await seedOssFile('orig')
        const reviewed = await seedOssFile('reviewed')
        const r = await createContractReviewDAO({
            userId,
            sessionId: `m5-itest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            originalFileId: original.id,
            status: 'pending',
        })
        reviewIds.push(r.id)
        await updateContractReviewDAO(r.id, {
            status: 'completed',
            reviewedFileId: reviewed.id,
            risks: [buildRisk(0, '旧条款')],
        })
        return { reviewId: r.id, oldReviewedFileId: reviewed.id }
    }

    beforeAll(async () => { userId = await ensureTestUser() })

    afterEach(async () => {
        if (reviewIds.length) await prisma.contractReviews.deleteMany({ where: { id: { in: reviewIds } } })
        if (ossFileIds.length) await prisma.ossFiles.deleteMany({ where: { id: { in: ossFileIds } } })
        reviewIds.length = 0
        ossFileIds.length = 0
        vi.clearAllMocks()
    })

    afterAll(async () => { await cleanupTestData() })

    it('PATCH risks + rebuild-docx 完整路径：状态 completed→rebuilding→completed + 新 reviewedFileId', async () => {
        const { reviewId, oldReviewedFileId } = await seedCompletedReview()

        const newRisks = [buildRisk(0, '用户改过的条款'), buildRisk(1, '新增的条款')]
        const patchRes: any = await patchHandler(makeEvent(userId, String(reviewId), { risks: newRisks }))
        expect(patchRes.success).toBe(true)
        const afterPatch = await getContractReviewDAO(reviewId)
        expect((afterPatch?.risks as any[]).length).toBe(2)
        expect((afterPatch?.risks as any[])[0].suggestedClauseText).toBe('用户改过的条款')

        const rebuildRes: any = await rebuildHandler(makeEvent(userId, String(reviewId)))
        expect(rebuildRes.success).toBe(true)
        expect(typeof rebuildRes.data.reviewedFileId).toBe('number')
        expect(rebuildRes.data.reviewedFileId).not.toBe(oldReviewedFileId)
        expect(typeof rebuildRes.data.downloadUrl).toBe('string')
        expect(rebuildRes.data.downloadUrl.startsWith('https://')).toBe(true)

        const final = await getContractReviewDAO(reviewId)
        expect(final?.status).toBe('completed')
        expect(final?.reviewedFileId).toBe(rebuildRes.data.reviewedFileId)
        // 新生成的 ossFile 行也需纳入清理
        ossFileIds.push(rebuildRes.data.reviewedFileId)
    }, 30_000)

    it('并发 rebuild-docx：第一个请求占位后，第二个立即被拒（原子占位验证）', async () => {
        const { reviewId } = await seedCompletedReview()
        // 模拟"第一个请求已占位" —— 直接把 status 置为 rebuilding
        await updateContractReviewDAO(reviewId, { status: 'rebuilding' })

        const res: any = await rebuildHandler(makeEvent(userId, String(reviewId)))
        // status=rebuilding 命中前置守护（EDITABLE_STATUSES 拦截）→ 409
        // 真并发下 atomicSet=false → 429 的语义已由 rebuildDocx.api.test.ts 覆盖
        expect(res.code).toBe(409)
        expect(res.success).toBe(false)
    }, 30_000)

    it('rebuild-docx 失败（injectAnnotations 抛异常）→ status 回滚 completed 且 reviewedFileId 未变', async () => {
        const { reviewId, oldReviewedFileId } = await seedCompletedReview()
        vi.mocked(injectAnnotations).mockRejectedValueOnce(new Error('mock inject fail'))

        const res: any = await rebuildHandler(makeEvent(userId, String(reviewId)))
        expect(res.code).toBe(500)
        expect(res.success).toBe(false)

        const after = await getContractReviewDAO(reviewId)
        expect(after?.status).toBe('completed')
        expect(after?.reviewedFileId).toBe(oldReviewedFileId)
    }, 30_000)
})
