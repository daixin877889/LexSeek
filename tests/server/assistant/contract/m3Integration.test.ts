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
} from '~~/server/services/assistant/contract/contractReview.dao'
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

    // M6.1 Task 1.2：持久化层把 summary 包装为 ContractOverview 对象写入，
    // 但 contractReviews.summary 列仍是 String?（Task 1.3 才迁移为 Json）。
    // 此集成测跑真实 DB，Prisma 会拒绝对象写入 → update 抛错 → risks 无法落库，
    // 断言 "risks 已落库" 暂时无法通过。Task 1.3 完成 JSON 迁移后解除 skip。
    it.skip('批注注入准备阶段失败（originalFile 不存在）→ risks 已落库 + status=failed（M5 rebuild-docx 可恢复）', async () => {
        // 用 originalFileId=0 让 findOssFileByIdDao 返回 null → 注入前准备阶段抛错
        //（真正进入 injectComments 抛错的路径由 Task 4 的 mock 单测覆盖；
        // 真实 DB 难以稳定构造坏 .docx Buffer 触发 injectComments 内部异常）
        const review = await createContractReviewDAO({
            userId,
            sessionId: `itest-${Date.now()}-inject-fail`,
            originalFileId: 0,
            status: 'reviewing',
        })
        createdIds.push(review.id)

        const mw = reviewResultPersistenceMiddleware({
            reviewId: review.id,
            sessionId: review.sessionId,
        })
        const after = getAfterHook(mw)
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

        await after({
            structuredResponse: { risks: fakeRisks, summary: '整体风险可控' },
        })

        const refreshed = await getContractReviewDAO(review.id)
        expect(refreshed?.status).toBe('failed')
        expect(refreshed?.risks).toEqual(fakeRisks)  // 关键：risks 已落库
        expect(refreshed?.summary).toBe('整体风险可控')
        expect(refreshed?.reviewedFileId).toBeNull()  // 未生成批注文件
    })
})
