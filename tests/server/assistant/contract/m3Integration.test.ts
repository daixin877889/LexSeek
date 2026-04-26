/**
 * 合同审查 M3 端到端集成测：afterAgent 持久化语义（真实 DB）
 *
 * 单测（Task 4）用 mock 覆盖各路径的语义；本集成测用真实 DB 驱动 afterAgent hook，
 * 验证"批注注入准备阶段失败（originalFile 不存在）"时 risks 确实落到真实 DB 里，
 * 这是 M5 rebuild-docx 能够在失败态恢复的前提。
 *
 * **Feature: contract-review-m3**
 * **Validates: Plan Task 10 / Spec §12.1 端到端 afterAgent 语义**
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { reviewResultPersistenceMiddleware } from '~~/server/services/workflow/middleware/reviewResultPersistence.middleware'
import {
    createContractReviewDAO,
    getContractReviewDAO,
} from '~~/server/agents/contract/contractReview.dao'
import { prisma } from '~~/server/utils/db'
import { ensureTestUser, cleanupTestData } from '../test-db-helper'

describe('M3 集成：结果持久化语义', () => {
    let userId: number
    const createdIds: number[] = []

    beforeAll(async () => {
        userId = await ensureTestUser()
    })

    afterEach(async () => {
        if (createdIds.length > 0) {
            await prisma.contractReviews.deleteMany({ where: { id: { in: createdIds } } })
            createdIds.length = 0
        }
    })

    afterAll(async () => {
        await cleanupTestData()
    })

    function getAfterHook(mw: any) {
        return mw.afterAgent?.hook ?? mw.afterAgent
    }

    // 注：`structuredResponse 缺失 → failed` 的语义已由 Task 4 单测（mock）覆盖；
    // 本集成测只保留 "真实 DB + 真实 injectComments 准备阶段失败" 一例，
    // 验证 risks 能真的落库（M5 rebuild-docx 依赖此前提）。

    // M6.1 子期 2 改造后：afterAgent 从 DB 读 risks（不再从 state.structuredResponse 读）。
    // 测试场景：review DB 里已有 risks（由 runAnalyzeLoop 写入），但 originalFileId=0 让
    // findOssFileByIdDao 返回 null → 注入前准备阶段抛错 → status=failed，risks 保留在 DB 里。
    it('批注注入准备阶段失败（originalFile 不存在）→ risks 已落库 + status=failed（M5 rebuild-docx 可恢复）', async () => {
        const { updateContractReviewDAO } = await import('~~/server/agents/contract/contractReview.dao')

        // 用 originalFileId=0 让 findOssFileByIdDao 返回 null → 注入前准备阶段抛错
        const review = await createContractReviewDAO({
            userId,
            sessionId: `itest-${Date.now()}-inject-fail`,
            originalFileId: 0,
            status: 'reviewing',
        })
        createdIds.push(review.id)

        const fakeRisks = [{
            id: '00000000-0000-4000-8000-000000000001',
            clauseIndex: 0,
            clauseText: 'P0',
            level: 'low',
            category: '其他',
            problem: 'x',
            analysis: 'x',
            risk: 'x',
            suggestion: 'x',
        }]

        // M6.1 子期 2：afterAgent 从 DB 读 risks，所以先把 risks 写进 DB（模拟 runAnalyzeLoop 已执行）
        await updateContractReviewDAO(review.id, {
            risks: fakeRisks as unknown as any,
        })

        const mw = reviewResultPersistenceMiddleware({
            reviewId: review.id,
            sessionId: review.sessionId,
        })
        const after = getAfterHook(mw)

        // afterAgent 读 DB risks → runAnnotateAndUpload → 因 originalFileId=0 失败 → status=failed
        await after({})

        const refreshed = await getContractReviewDAO(review.id)
        expect(refreshed?.status).toBe('failed')
        expect(refreshed?.risks).toEqual(fakeRisks)  // 关键：risks 已落库（注入失败不清除 risks）
        expect(refreshed?.reviewedFileId).toBeNull()  // 未生成批注文件
    })
})
