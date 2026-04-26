/**
 * M4 合同审查闭环集成测试
 *
 * 验证 M4 新增 download 端点与真实 DB 链路联动（纯后端状态机驱动，不跑 agent）：
 *   seed user → 直接写入"模拟 agent 已完成"的 review + ossFiles → 调 download handler
 *
 * 目的：守护 download 端点的鉴权 / 业务状态 / ossFile 真实链路；
 * 兼顾"未完成态不吐签名 URL"和"属于他人 403"两条防回归。
 *
 * 约束：不起 nitro；storage.service 对真实 OSS 有依赖，仅 mock 其签名 URL 出口；
 *       contractReviews / ossFiles 走真实 ls_new_testing 数据库。
 *
 * **Feature: contract-review-m4**
 * **Validates: Plan Task 10 / Spec §11 download 端点闭环**
 */
import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest'

// ==================== 全局 Stub（Nuxt nitro 自动导入）====================
;(globalThis as any).resError = (_e: any, code: number, message: string) => ({ code, success: false, message, data: null })
;(globalThis as any).resSuccess = (_e: any, message: string, data: any) => ({ code: 0, success: true, message, data })
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).getRouterParam = (e: any, k: string) => e.__params?.[k]
;(globalThis as any).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }

// 仅 mock storage 出口（对真实 OSS 有依赖），其余走真实 DAO
vi.mock('~~/server/services/storage/storage.service', () => ({
    generateSignedUrlService: vi.fn(async (path: string) => `https://oss.example.com/${path}?sig=fake&expires=3600`),
}))

// download 新语义（2026-04-24）：每次下载都触发 rebuildDocxService 生成最新产物。
// rebuild 内部要真下原件 / 注入 / 上传 OSS，本 integration 不涵盖；只 mock 它的
// 外层返回，保证 download 端点能继续测 atomic claim + 产物 URL 透传的链路完整性。
vi.mock('~~/server/agents/contract/contractReviewRebuild.service', () => ({
    rebuildDocxService: vi.fn(async (review: any) => ({
        reviewedFileId: review.reviewedFileId,
        downloadUrl: `https://oss.example.com/rebuild-${review.id}.docx?sig=fake&expires=3600`,
        filename: `contract-${review.id}_v${review.maxVersionNo ?? 0}_2026-04-24.docx`,
    })),
}))

const { default: downloadHandler } = await import(
    '../../../../server/api/v1/assistant/contract/reviews/[id]/download.get'
)
import {
    createContractReviewDAO,
    updateContractReviewDAO,
} from '~~/server/agents/contract/contractReview.dao'
import { createOssFileDao } from '~~/server/services/files/ossFiles.dao'
import { prisma } from '~~/server/utils/db'
import { ensureTestUser, cleanupTestData } from '../test-db-helper'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const makeEvent = (userId: number | null, id: string) => ({
    context: userId ? { auth: { user: { id: userId } } } : {},
    __params: { id },
}) as any

describe('M4 合同审查闭环（download 端点 + 真实 DB 链路）', () => {
    let userId: number
    const reviewIds: number[] = []
    const ossFileIds: number[] = []

    const seedOssFile = async (tag: string) => {
        const f = await createOssFileDao({
            userId,
            bucketName: 'test-bucket',
            fileName: `contract-${tag}.docx`,
            filePath: `users/${userId}/contract-reviews/${tag}-${Date.now()}.docx`,
            fileSize: 1024,
            fileType: DOCX_MIME,
            status: 1,
        })
        ossFileIds.push(f.id)
        return f
    }

    const seedReview = async (status: string, extra: Record<string, any> = {}) => {
        const original = await seedOssFile(`orig-${status}`)
        const r = await createContractReviewDAO({
            userId,
            sessionId: `m4-itest-${Date.now()}-${status}-${Math.random().toString(36).slice(2, 8)}`,
            originalFileId: original.id,
            status,
            ...extra,
        })
        reviewIds.push(r.id)
        return r
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

    it('模拟 agent 完成 → download 抢锁 + 跑 rebuild + 返回产物 URL/filename', async () => {
        const review = await seedReview('pending')
        const reviewed = await seedOssFile('reviewed')
        await updateContractReviewDAO(review.id, {
            status: 'completed',
            reviewedFileId: reviewed.id,
            partyA: '甲方公司',
            partyB: '乙方公司',
            stance: 'partyA',
            contractType: '买卖合同',
            risks: [{ id: 'r1', clauseIndex: 0, clauseText: 'P0', level: 'low', category: '其他', problem: 'x', analysis: 'x', risk: 'x', suggestion: 'x' }],
            summary: '整体风险可控',
        })

        const res: any = await downloadHandler(makeEvent(userId, String(review.id)))

        expect(res.success).toBe(true)
        expect(typeof res.data.downloadUrl).toBe('string')
        expect(res.data.downloadUrl.startsWith('https://')).toBe(true)
        // rebuild 后 review.status 被 rebuildDocxService.setCompletedAfterRebuildDAO
        // 切回 completed；本测试 mock 了 rebuild 出口所以 status 仍是 rebuilding，
        // 这里不检查 status，只保证 URL/filename 透传。
        expect(res.data.filename).toMatch(/\.docx$/)
    }, 30_000)

    it('review.status !== completed 时 download 返回 400（未完成不可下载）', async () => {
        const review = await seedReview('awaiting_stance')
        const res: any = await downloadHandler(makeEvent(userId, String(review.id)))
        expect(res.code).toBe(400)
        expect(res.message).toContain('尚未完成')
    }, 30_000)

    it('review 属于他人时 download 返回 403（归属校验真实走 DB）', async () => {
        const review = await seedReview('completed', { reviewedFileId: undefined })
        // 建一个"已完成"样态（reviewedFileId 回填成原始文件 id，仅为触达归属分支）
        await updateContractReviewDAO(review.id, { reviewedFileId: review.originalFileId })

        const otherUserId = userId + 999999
        const res: any = await downloadHandler(makeEvent(otherUserId, String(review.id)))
        expect(res.code).toBe(403)
    }, 30_000)
})
