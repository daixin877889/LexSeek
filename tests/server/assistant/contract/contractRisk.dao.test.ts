/**
 * ContractRisk DAO 测试
 *
 * **Feature: contract-review-versioning-phase-a**
 * **Validates: Plan Task 2.1**
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import {
    createContractRiskDAO,
    updateContractRiskDAO,
    listContractRisksDAO,
    getContractRiskByIdDAO,
} from '~~/server/agents/contract/contractRisk.dao'
import { ensureTestUser } from '../test-db-helper'

describe('contractRisk.dao', () => {
    let reviewId: number
    let userId: number

    beforeEach(async () => {
        userId = await ensureTestUser()
        const review = await prisma.contractReviews.create({
            data: {
                userId,
                status: 'completed',
                risks: [],
                sessionId: `risk-dao-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                originalFileId: 0,
            },
        })
        reviewId = review.id
    })

    afterEach(async () => {
        // 级联删除：先删 annotations，再删 risks，再删 review（或利用 Cascade）
        await prisma.contractAnnotations.deleteMany({ where: { reviewId } })
        await prisma.contractRisks.deleteMany({ where: { reviewId } })
        await prisma.contractReviews.delete({ where: { id: reviewId } })
        await prisma.users.deleteMany({ where: { id: userId } })
    })

    it('create 能成功写入', async () => {
        const risk = await createContractRiskDAO({
            reviewId,
            source: 'ai',
            code: 'probation',
            category: '试用期',
            level: 'high',
            stance: 'balanced',
            problem: '超长试用期',
            clauseText: '试用期 6 个月',
        })
        expect(risk.id).toBeGreaterThan(0)
        expect(risk.source).toBe('ai')
        expect(risk.category).toBe('试用期')
        expect(risk.level).toBe('high')
        expect(risk.archivedStatus).toBeNull()
    })

    it('update archivedStatus 生效，且 archivedAt 自动填充', async () => {
        const risk = await createContractRiskDAO({
            reviewId,
            source: 'ai',
            category: 'x',
            level: 'high',
            stance: 'balanced',
            problem: 'x',
            clauseText: 'x',
        })
        const updated = await updateContractRiskDAO(risk.id, { archivedStatus: 'handled' })
        expect(updated.archivedStatus).toBe('handled')
        expect(updated.archivedAt).not.toBeNull()
    })

    it('update archivedStatus 置 null 时 archivedAt 清空', async () => {
        const risk = await createContractRiskDAO({
            reviewId,
            source: 'ai',
            category: 'x',
            level: 'high',
            stance: 'balanced',
            problem: 'x',
            clauseText: 'x',
        })
        await updateContractRiskDAO(risk.id, { archivedStatus: 'handled' })
        const cleared = await updateContractRiskDAO(risk.id, { archivedStatus: null })
        expect(cleared.archivedStatus).toBeNull()
        expect(cleared.archivedAt).toBeNull()
    })

    it('list 按 reviewId 查询', async () => {
        await createContractRiskDAO({
            reviewId,
            source: 'ai',
            category: 'x',
            level: 'high',
            stance: 'balanced',
            problem: 'x',
            clauseText: 'x',
        })
        await createContractRiskDAO({
            reviewId,
            source: 'ai',
            category: 'y',
            level: 'medium',
            stance: 'strict',
            problem: 'y',
            clauseText: 'y',
        })
        const list = await listContractRisksDAO(reviewId)
        expect(list.length).toBe(2)
    })

    it('getById 能正确返回单条', async () => {
        const risk = await createContractRiskDAO({
            reviewId,
            source: 'ai',
            category: 'test',
            level: 'low',
            stance: 'lenient',
            problem: 'test problem',
            clauseText: 'test anchor',
        })
        const found = await getContractRiskByIdDAO(risk.id)
        expect(found?.id).toBe(risk.id)
        expect(found?.category).toBe('test')
    })

    it('getById 对不存在的 id 返回 null', async () => {
        const found = await getContractRiskByIdDAO(999999999)
        expect(found).toBeNull()
    })

    it('生产路径不再暴露物理删；fixtures 清理走 prisma 直删（同步级联清批注）', async () => {
        const risk = await createContractRiskDAO({
            reviewId,
            source: 'ai',
            category: 'to delete',
            level: 'low',
            stance: 'balanced',
            problem: 'x',
            clauseText: 'x',
        })
        // 测试场景的"清 fixtures"用法：直接走 prisma 而非 DAO，
        // 让生产代码无任何物理删入口（决策 11："批注永不物理删"）。
        await prisma.contractRisks.delete({ where: { id: risk.id } })
        const found = await getContractRiskByIdDAO(risk.id)
        expect(found).toBeNull()
    })
})
