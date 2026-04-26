import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('~~/server/agents/contract/contractReview.dao', () => ({
    findContractReviewBySessionIdDAO: vi.fn(),
}))
// 其他依赖均为现有稳定实现，不 mock；若跑全量测试需要隔离，视实际情况在
// Task 10 集成测里再加 mock（本 smoke 只检查 sessionId 未命中时抛错）

import { runContractReviewChat } from '~~/server/services/workflow/agents/contractReviewMainAgent'
import { findContractReviewBySessionIdDAO } from '~~/server/agents/contract/contractReview.dao'

describe('runContractReviewChat', () => {
    beforeEach(() => vi.clearAllMocks())

    it('sessionId 未命中 review → 抛错', async () => {
        ;(findContractReviewBySessionIdDAO as any).mockResolvedValueOnce(null)
        await expect(
            runContractReviewChat('unknown-session', { userId: 7 }),
        ).rejects.toThrow(/No contract review/)
    })
})
