/**
 * M4 合同审查闭环集成测试
 *
 * 验证 M4 新增 download 端点与真实 DB 链路联动（纯后端状态机驱动，不跑 agent）：
 *   seed user → 写入"模拟 agent 已完成"的 review + ossFiles → 调 download handler
 *
 * 目的：守护 download 端点鉴权 / 业务状态 / ossFile 真实链路；
 * 兼顾一条"未完成态"防回归断言，确保 download 不会对未完成的 review 吐签名 URL。
 *
 * 约束：不起 nitro；storage.service 对真实 OSS 有依赖，只 mock 其签名 URL 出口。
 * 其余 contractReviews / ossFiles DAO 均走真实 ls_new_testing 数据库。
 *
 * **Feature: contract-review-m4**
 * **Validates: Plan Task 10 / Spec §11 download 端点闭环**
 */
import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest'

// ==================== 全局 Stub（模拟 Nuxt nitro 自动导入）====================

const resError = (_event: any, code: number, message: string) => ({
    code,
    success: false,
    message,
    data: null,
})
const resSuccess = (_event: any, message: string, data: any) => ({
    code: 0,
    success: true,
    message,
    data,
})

;(globalThis as any).resError = resError
;(globalThis as any).resSuccess = resSuccess
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).getRouterParam = (event: any, key: string) => event.__params?.[key]
;(globalThis as any).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }

// ==================== Mock storage（保留真实 DAO）====================

vi.mock('~~/server/services/storage/storage.service', () => ({
    generateSignedUrlService: vi.fn(async (path: string) =>
        `https://oss.example.com/${path}?sig=fake&expires=3600`,
    ),
}))

// ==================== 动态 import handler（必须在 mock 之后）====================

const { default: downloadHandler } = await import(
    '../../../../server/api/v1/assistant/contract/reviews/[id]/download.get'
)
import { createContractReviewDAO, updateContractReviewDAO } from '~~/server/services/assistant/contract/contractReview.dao'
import { createOssFileDao } from '~~/server/services/files/ossFiles.dao'
import { prisma } from '~~/server/utils/db'
import { ensureTestUser, cleanupTestData } from '../test-db-helper'

// ==================== 工具 ====================

function makeEvent(userId: number | null, id: string) {
    return {
        context: userId ? { auth: { user: { id: userId } } } : {},
        __params: { id },
    } as any
}

describe('M4 合同审查闭环（download + stance 链路防回归）', () => {
    let userId: number
    const createdReviewIds: number[] = []
    const createdOssFileIds: number[] = []

    beforeAll(async () => {
        userId = await ensureTestUser()
    })

    afterEach(async () => {
        if (createdReviewIds.length > 0) {
            await prisma.contractReviews.deleteMany({ where: { id: { in: createdReviewIds } } })
            createdReviewIds.length = 0
        }
        if (createdOssFileIds.length > 0) {
            await prisma.ossFiles.deleteMany({ where: { id: { in: createdOssFileIds } } })
            createdOssFileIds.length = 0
        }
        vi.clearAllMocks()
    })

    afterAll(async () => {
        await cleanupTestData()
    })

    it('模拟 agent 完成 → download 返回 1h 签名 https URL', async () => {
        // 1) 先建一条"原始文件"占位（originalFileId 必填，非空外键概念）
        const originalFile = await createOssFileDao({
            userId,
            bucketName: 'test-bucket',
            fileName: 'contract-original.docx',
            filePath: `users/${userId}/contracts/original-${Date.now()}.docx`,
            fileSize: 1024,
            fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            status: 1,
        })
        createdOssFileIds.push(originalFile.id)

        // 2) 建 review（pending）
        const review = await createContractReviewDAO({
            userId,
            sessionId: `m4-itest-${Date.now()}-done`,
            originalFileId: originalFile.id,
            status: 'pending',
        })
        createdReviewIds.push(review.id)

        // 3) 模拟 agent 已完成：写入批注版产物文件 + 更新 review 至 completed
        const reviewedFile = await createOssFileDao({
            userId,
            bucketName: 'test-bucket',
            fileName: 'contract-reviewed.docx',
            filePath: `users/${userId}/contract-reviews/${review.id}.docx`,
            fileSize: 2048,
            fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            status: 1,
        })
        createdOssFileIds.push(reviewedFile.id)

        await updateContractReviewDAO(review.id, {
            status: 'completed',
            reviewedFileId: reviewedFile.id,
            partyA: '甲方公司',
            partyB: '乙方公司',
            stance: 'partyA',
            contractType: '买卖合同',
            risks: [{ id: 'r1', clauseIndex: 0, clauseText: 'P0', level: 'low', category: '其他', problem: 'x', analysis: 'x', risk: 'x', suggestion: 'x' }],
            summary: '整体风险可控',
        })

        // 4) 调 download handler
        const res: any = await downloadHandler(makeEvent(userId, String(review.id)))

        expect(res.success).toBe(true)
        expect(typeof res.data.downloadUrl).toBe('string')
        expect(res.data.downloadUrl.startsWith('https://')).toBe(true)
        expect(res.data.downloadUrl).toContain(reviewedFile.filePath)
    }, 30_000)

    it('review.status !== completed 时 download 返回 400（未完成不可下载）', async () => {
        const originalFile = await createOssFileDao({
            userId,
            bucketName: 'test-bucket',
            fileName: 'contract-original.docx',
            filePath: `users/${userId}/contracts/original-${Date.now()}-awaiting.docx`,
            fileSize: 1024,
            fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            status: 1,
        })
        createdOssFileIds.push(originalFile.id)

        // awaiting_stance 且 reviewedFileId=null：download 应被业务状态拦截
        const review = await createContractReviewDAO({
            userId,
            sessionId: `m4-itest-${Date.now()}-await`,
            originalFileId: originalFile.id,
            status: 'awaiting_stance',
        })
        createdReviewIds.push(review.id)

        const res: any = await downloadHandler(makeEvent(userId, String(review.id)))
        expect(res.code).toBe(400)
        expect(res.message).toContain('尚未完成')
    }, 30_000)

    it('review 属于他人时 download 返回 403（归属校验真实走 DB）', async () => {
        const originalFile = await createOssFileDao({
            userId,
            bucketName: 'test-bucket',
            fileName: 'contract-original.docx',
            filePath: `users/${userId}/contracts/original-${Date.now()}-other.docx`,
            fileSize: 1024,
            fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            status: 1,
        })
        createdOssFileIds.push(originalFile.id)

        const review = await createContractReviewDAO({
            userId,
            sessionId: `m4-itest-${Date.now()}-foreign`,
            originalFileId: originalFile.id,
            status: 'completed',
            reviewedFileId: originalFile.id,
        })
        createdReviewIds.push(review.id)

        // 用另一个用户身份访问
        const otherUserId = userId + 999999
        const res: any = await downloadHandler(makeEvent(otherUserId, String(review.id)))
        expect(res.code).toBe(403)
    }, 30_000)
})
