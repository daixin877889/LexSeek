/**
 * 案件分析 DAO 层 - 覆盖率缺口补充测试
 *
 * 覆盖目标：
 * 1. findStaleInProgressAnalysesDao 正常路径（616-629 行）
 * 2. batchUpdateAnalysisStatusDao 正常路径（644-652 行）
 * 3. 各 DAO 函数的 catch 分支（通过故障注入 Proxy 触发 Prisma 访问异常）
 *
 * **Feature: server-test-coverage**
 * **Validates: Requirements 8.1, 8.2, 9.6, 9.7**
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import './test-setup'
import {
    createTestUser,
    createTestCaseType,
    createTestCase,
    createTestSession,
    createTestNode,
    createTestModel,
    createTestModelProvider,
    createEmptyTestIds,
    cleanupTestData,
    disconnectTestDb,
    getTestPrisma,
    type CaseTestIds,
} from './test-db-helper'
import {
    createAnalysisDao,
    findAnalysisByIdDao,
    findManyAnalysesDao,
    findAnalysesBySessionIdDao,
    findAnalysisVersionsDao,
    findLatestAnalysisVersionDao,
    findAnalysisBySessionAndNodeDao,
    findLatestAnalysisBySessionAndNodeDao,
    getNextVersionDao,
    updateAnalysisDao,
    softDeleteAnalysisDao,
    softDeleteAnalysesBySessionDao,
    findAnalysisHistoryByCaseIdDao,
    countAnalysesByCaseIdDao,
    deactivateVersionsDao,
    activateVersionDao,
    findActiveAnalysisVersionDao,
    findStaleInProgressAnalysesDao,
    batchUpdateAnalysisStatusDao,
    AnalysisStatus,
} from '../../../server/services/case/analysis.dao'

/**
 * 使用故障注入 Proxy 替换 globalThis.prisma，
 * 在 fn() 期间 Prisma 的任意属性访问都会抛出 fault 错误，
 * 从而触发目标 DAO 的 catch 分支，执行完毕后恢复原 prisma。
 */
async function withFaultyPrisma(fn: () => Promise<unknown>): Promise<void> {
    const originalPrisma = (globalThis as any).prisma
    ;(globalThis as any).prisma = new Proxy({}, {
        get: () => {
            throw new Error('fault')
        },
    })
    try {
        await fn()
    } finally {
        ;(globalThis as any).prisma = originalPrisma
    }
}

describe('案件分析 DAO 层 - 覆盖率缺口补充', () => {
    let testIds: CaseTestIds
    let testCase: Awaited<ReturnType<typeof createTestCase>>
    let testSession: Awaited<ReturnType<typeof createTestSession>>
    let testNode: Awaited<ReturnType<typeof createTestNode>>

    beforeAll(async () => {
        testIds = createEmptyTestIds()
        const testUser = await createTestUser()
        testIds.userIds.push(testUser.id)
        const testCaseType = await createTestCaseType({ status: 1 })
        testIds.caseTypeIds.push(testCaseType.id)
        testCase = await createTestCase({ userId: testUser.id, caseTypeId: testCaseType.id })
        testIds.caseIds.push(testCase.id)
        testSession = await createTestSession({ caseId: testCase.id })
        testIds.sessionIds.push(testSession.sessionId)
        const provider = await createTestModelProvider()
        testIds.modelProviderIds.push(provider.id)
        const model = await createTestModel({ providerId: provider.id })
        testIds.modelIds.push(model.id)
        testNode = await createTestNode({ modelId: model.id })
        testIds.nodeIds.push(testNode.id)
    })

    afterAll(async () => {
        // 清理本轮创建的 analyses（即使 id 已在 testIds 中，也二次确认清理）
        if (testIds.analysisIds.length > 0) {
            await getTestPrisma().caseAnalyses.deleteMany({
                where: { id: { in: testIds.analysisIds } },
            })
        }
        await cleanupTestData(testIds)
        await disconnectTestDb()
    })

    // ==================== findStaleInProgressAnalysesDao ====================

    describe('findStaleInProgressAnalysesDao - 查询超时 IN_PROGRESS 记录', () => {
        it('应返回 updatedAt 早于阈值的 IN_PROGRESS 记录 ID 列表', async () => {
            // 创建一条 IN_PROGRESS 记录
            const stale = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: testNode.id,
                analysisType: 'stale_test',
                status: AnalysisStatus.IN_PROGRESS,
            })
            testIds.analysisIds.push(stale.id)

            // 手动把 updatedAt 回拨到远古时间，模拟僵死
            const ancient = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30) // 30 天前
            await getTestPrisma().caseAnalyses.update({
                where: { id: stale.id },
                data: { updatedAt: ancient },
            })

            // 阈值 1 小时：应包含这条记录
            const ids = await findStaleInProgressAnalysesDao(1000 * 60 * 60)
            expect(ids).toContain(stale.id)
        })

        it('新鲜的 IN_PROGRESS 记录不应被视为超时', async () => {
            const fresh = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: testNode.id,
                analysisType: 'fresh_test',
                status: AnalysisStatus.IN_PROGRESS,
            })
            testIds.analysisIds.push(fresh.id)

            // 阈值 1 小时：刚刚创建的记录不应被视为超时
            const ids = await findStaleInProgressAnalysesDao(1000 * 60 * 60)
            expect(ids).not.toContain(fresh.id)
        })

        it('已完成的记录不应被视为超时', async () => {
            const completed = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: testNode.id,
                analysisType: 'stale_completed_test',
                status: AnalysisStatus.COMPLETED,
            })
            testIds.analysisIds.push(completed.id)

            const ancient = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30)
            await getTestPrisma().caseAnalyses.update({
                where: { id: completed.id },
                data: { updatedAt: ancient },
            })

            const ids = await findStaleInProgressAnalysesDao(1000 * 60 * 60)
            expect(ids).not.toContain(completed.id)
        })

        it('已软删除的记录不应被视为超时', async () => {
            const deleted = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: testNode.id,
                analysisType: 'stale_deleted_test',
                status: AnalysisStatus.IN_PROGRESS,
            })
            testIds.analysisIds.push(deleted.id)

            const ancient = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30)
            await getTestPrisma().caseAnalyses.update({
                where: { id: deleted.id },
                data: { updatedAt: ancient, deletedAt: new Date() },
            })

            const ids = await findStaleInProgressAnalysesDao(1000 * 60 * 60)
            expect(ids).not.toContain(deleted.id)
        })

        it('Prisma 异常时应抛出错误（catch 分支）', async () => {
            await withFaultyPrisma(async () => {
                await expect(findStaleInProgressAnalysesDao(1000)).rejects.toThrow('fault')
            })
        })
    })

    // ==================== batchUpdateAnalysisStatusDao ====================

    describe('batchUpdateAnalysisStatusDao - 批量更新状态', () => {
        it('应批量更新状态并返回影响行数', async () => {
            const a1 = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: testNode.id,
                analysisType: 'batch_update_1',
                status: AnalysisStatus.IN_PROGRESS,
            })
            testIds.analysisIds.push(a1.id)

            const a2 = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: testNode.id,
                analysisType: 'batch_update_2',
                status: AnalysisStatus.IN_PROGRESS,
            })
            testIds.analysisIds.push(a2.id)

            const count = await batchUpdateAnalysisStatusDao([a1.id, a2.id], AnalysisStatus.FAILED)
            expect(count).toBe(2)

            const reloaded1 = await findAnalysisByIdDao(a1.id)
            const reloaded2 = await findAnalysisByIdDao(a2.id)
            expect(reloaded1!.status).toBe(AnalysisStatus.FAILED)
            expect(reloaded2!.status).toBe(AnalysisStatus.FAILED)
        })

        it('传入空数组时应返回 0', async () => {
            const count = await batchUpdateAnalysisStatusDao([], AnalysisStatus.COMPLETED)
            expect(count).toBe(0)
        })

        it('不存在的 ID 不会影响结果（返回 0）', async () => {
            const count = await batchUpdateAnalysisStatusDao([-1, -2], AnalysisStatus.COMPLETED)
            expect(count).toBe(0)
        })

        it('Prisma 异常时应抛出错误（catch 分支）', async () => {
            await withFaultyPrisma(async () => {
                await expect(
                    batchUpdateAnalysisStatusDao([1], AnalysisStatus.FAILED),
                ).rejects.toThrow('fault')
            })
        })
    })

    // ==================== catch 分支补充（故障注入） ====================

    describe('catch 分支 - Prisma 故障时应抛出原始错误', () => {
        it('createAnalysisDao 不带 tx 时，Prisma 异常应抛出', async () => {
            await withFaultyPrisma(async () => {
                await expect(
                    createAnalysisDao({
                        caseId: testCase.id,
                        sessionId: testSession.sessionId,
                        nodeId: testNode.id,
                        analysisType: 'faulty',
                    }),
                ).rejects.toThrow('fault')
            })
        })

        it('findAnalysisByIdDao 异常应抛出', async () => {
            await withFaultyPrisma(async () => {
                await expect(findAnalysisByIdDao(1)).rejects.toThrow('fault')
            })
        })

        it('findAnalysisByIdDao 带 includeRelations 异常应抛出', async () => {
            await withFaultyPrisma(async () => {
                await expect(findAnalysisByIdDao(1, true)).rejects.toThrow('fault')
            })
        })

        it('findManyAnalysesDao 异常应抛出', async () => {
            await withFaultyPrisma(async () => {
                await expect(findManyAnalysesDao({ caseId: 1 })).rejects.toThrow('fault')
            })
        })

        it('findAnalysesBySessionIdDao 异常应抛出', async () => {
            await withFaultyPrisma(async () => {
                await expect(findAnalysesBySessionIdDao('x')).rejects.toThrow('fault')
            })
        })

        it('findAnalysisVersionsDao 异常应抛出', async () => {
            await withFaultyPrisma(async () => {
                await expect(findAnalysisVersionsDao(1, 1)).rejects.toThrow('fault')
            })
        })

        it('findLatestAnalysisVersionDao 异常应抛出', async () => {
            await withFaultyPrisma(async () => {
                await expect(findLatestAnalysisVersionDao(1, 1)).rejects.toThrow('fault')
            })
        })

        it('findAnalysisBySessionAndNodeDao 异常应抛出', async () => {
            await withFaultyPrisma(async () => {
                await expect(findAnalysisBySessionAndNodeDao('x', 1)).rejects.toThrow('fault')
            })
        })

        it('findAnalysisBySessionAndNodeDao 带 status 参数异常应抛出', async () => {
            await withFaultyPrisma(async () => {
                await expect(
                    findAnalysisBySessionAndNodeDao('x', 1, AnalysisStatus.COMPLETED),
                ).rejects.toThrow('fault')
            })
        })

        it('findLatestAnalysisBySessionAndNodeDao 异常应抛出', async () => {
            await withFaultyPrisma(async () => {
                await expect(findLatestAnalysisBySessionAndNodeDao('x', 1)).rejects.toThrow('fault')
            })
        })

        it('getNextVersionDao 不带 tx 时异常应抛出', async () => {
            await withFaultyPrisma(async () => {
                await expect(getNextVersionDao(1, 1)).rejects.toThrow('fault')
            })
        })

        it('updateAnalysisDao 不带 tx 时异常应抛出', async () => {
            await withFaultyPrisma(async () => {
                await expect(updateAnalysisDao(1, { status: AnalysisStatus.COMPLETED })).rejects.toThrow('fault')
            })
        })

        it('softDeleteAnalysisDao 不带 tx 时异常应抛出', async () => {
            await withFaultyPrisma(async () => {
                await expect(softDeleteAnalysisDao(1)).rejects.toThrow('fault')
            })
        })

        it('softDeleteAnalysesBySessionDao 不带 tx 时异常应抛出', async () => {
            await withFaultyPrisma(async () => {
                await expect(softDeleteAnalysesBySessionDao('x')).rejects.toThrow('fault')
            })
        })

        it('findAnalysisHistoryByCaseIdDao 异常应抛出', async () => {
            await withFaultyPrisma(async () => {
                await expect(findAnalysisHistoryByCaseIdDao(1)).rejects.toThrow('fault')
            })
        })

        it('countAnalysesByCaseIdDao 异常应抛出', async () => {
            await withFaultyPrisma(async () => {
                await expect(countAnalysesByCaseIdDao(1)).rejects.toThrow('fault')
            })
        })

        it('deactivateVersionsDao 不带 tx 时异常应抛出', async () => {
            await withFaultyPrisma(async () => {
                await expect(deactivateVersionsDao(1, 1)).rejects.toThrow('fault')
            })
        })

        it('activateVersionDao 不带 tx 时异常应抛出', async () => {
            await withFaultyPrisma(async () => {
                await expect(activateVersionDao(1, 1, 1)).rejects.toThrow('fault')
            })
        })

        it('findActiveAnalysisVersionDao 异常应抛出', async () => {
            await withFaultyPrisma(async () => {
                await expect(findActiveAnalysisVersionDao(1, 1)).rejects.toThrow('fault')
            })
        })
    })

    // ==================== activateVersionDao 支持传入 tx ====================

    describe('activateVersionDao - 支持传入事务客户端', () => {
        it('应在外部事务中执行（覆盖 tx 分支）', async () => {
            // 创建一条目标记录
            const target = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: testNode.id,
                analysisType: 'activate_with_tx',
                isActive: false,
                version: 500,
            })
            testIds.analysisIds.push(target.id)

            await getTestPrisma().$transaction(async (tx) => {
                await activateVersionDao(target.id, testCase.id, testNode.id, tx as any)
            })

            const reloaded = await findAnalysisByIdDao(target.id)
            expect(reloaded!.isActive).toBe(true)
        })
    })

    // ==================== createAnalysisDao / updateAnalysisDao / softDeleteAnalysisDao / softDeleteAnalysesBySessionDao / deactivateVersionsDao / getNextVersionDao 传 tx 时的 catch 分支 ====================

    describe('catch 分支 - 传入损坏的 tx 客户端时应抛错', () => {
        const faultyTx = new Proxy({}, {
            get: () => {
                throw new Error('fault-tx')
            },
        }) as any

        it('createAnalysisDao(tx) 异常应抛出', async () => {
            await expect(
                createAnalysisDao(
                    {
                        caseId: testCase.id,
                        sessionId: testSession.sessionId,
                        nodeId: testNode.id,
                        analysisType: 'faulty_tx',
                    },
                    faultyTx,
                ),
            ).rejects.toThrow('fault-tx')
        })

        it('getNextVersionDao(tx) 异常应抛出', async () => {
            await expect(getNextVersionDao(1, 1, faultyTx)).rejects.toThrow('fault-tx')
        })

        it('updateAnalysisDao(tx) 异常应抛出', async () => {
            await expect(
                updateAnalysisDao(1, { status: AnalysisStatus.COMPLETED }, faultyTx),
            ).rejects.toThrow('fault-tx')
        })

        it('softDeleteAnalysisDao(tx) 异常应抛出', async () => {
            await expect(softDeleteAnalysisDao(1, faultyTx)).rejects.toThrow('fault-tx')
        })

        it('softDeleteAnalysesBySessionDao(tx) 异常应抛出', async () => {
            await expect(softDeleteAnalysesBySessionDao('x', faultyTx)).rejects.toThrow('fault-tx')
        })

        it('deactivateVersionsDao(tx) 异常应抛出', async () => {
            await expect(deactivateVersionsDao(1, 1, faultyTx)).rejects.toThrow('fault-tx')
        })

        it('activateVersionDao(tx) 异常应抛出', async () => {
            await expect(activateVersionDao(1, 1, 1, faultyTx)).rejects.toThrow('fault-tx')
        })
    })
})
