/**
 * 案件分析 DAO 层覆盖率补充测试
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
    AnalysisStatus,
} from '../../../server/services/case/analysis.dao'

describe('案件分析 DAO 层 - 覆盖率补充', () => {
    let testIds: CaseTestIds
    let testCase: any
    let testSession: any
    let testNode: any

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
        if (testIds.analysisIds.length > 0) {
            const p = (globalThis as any).prisma
            await p.caseAnalyses.deleteMany({ where: { id: { in: testIds.analysisIds } } })
        }
        await cleanupTestData(testIds)
        await disconnectTestDb()
    })

    const createAndTrack = async (data: Parameters<typeof createAnalysisDao>[0]) => {
        const analysis = await createAnalysisDao(data)
        testIds.analysisIds.push(analysis.id)
        return analysis
    }

    describe('findAnalysisByIdDao', () => {
        it('应返回分析结果（含关联数据）', async () => {
            const a = await createAndTrack({ caseId: testCase.id, sessionId: testSession.sessionId, nodeId: testNode.id, analysisType: 'rel_test' })
            const found = await findAnalysisByIdDao(a.id, true)
            expect(found).not.toBeNull()
            expect(found!.node).toBeDefined()
            expect(found!.case).toBeDefined()
        })

        it('不存在的 ID 应返回 null', async () => {
            expect(await findAnalysisByIdDao(999999)).toBeNull()
        })
    })

    describe('findManyAnalysesDao', () => {
        it('应按 caseId 筛选', async () => {
            await createAndTrack({ caseId: testCase.id, sessionId: testSession.sessionId, nodeId: testNode.id, analysisType: 'list_caseId' })
            const result = await findManyAnalysesDao({ caseId: testCase.id })
            expect(result.list.length).toBeGreaterThanOrEqual(1)
        })

        it('应按 sessionId 筛选', async () => {
            const result = await findManyAnalysesDao({ sessionId: testSession.sessionId })
            expect(result.list.length).toBeGreaterThanOrEqual(1)
        })

        it('应按 analysisType 筛选', async () => {
            const result = await findManyAnalysesDao({ analysisType: 'list_caseId' })
            for (const a of result.list) expect(a.analysisType).toBe('list_caseId')
        })

        it('应按 status 筛选', async () => {
            const result = await findManyAnalysesDao({ status: AnalysisStatus.IN_PROGRESS })
            for (const a of result.list) expect(a.status).toBe(AnalysisStatus.IN_PROGRESS)
        })

        it('应支持分页', async () => {
            const result = await findManyAnalysesDao({ caseId: testCase.id, page: 1, pageSize: 1 })
            expect(result.list.length).toBeLessThanOrEqual(1)
        })
    })

    describe('findAnalysesBySessionIdDao', () => {
        it('应返回结果（含 node 信息）', async () => {
            const result = await findAnalysesBySessionIdDao(testSession.sessionId)
            expect(result.length).toBeGreaterThanOrEqual(1)
            for (const a of result) expect(a.node).toBeDefined()
        })

        it('不存在的会话应返回空数组', async () => {
            expect(await findAnalysesBySessionIdDao('non-existent')).toEqual([])
        })
    })

    describe('版本管理', () => {
        it('getNextVersionDao - 无版本时应返回 1', async () => {
            expect(await getNextVersionDao(999999, 999999)).toBe(1)
        })

        it('getNextVersionDao - 应返回最新版本 + 1', async () => {
            await createAndTrack({ caseId: testCase.id, sessionId: testSession.sessionId, nodeId: testNode.id, analysisType: 'ver', version: 5 })
            expect(await getNextVersionDao(testCase.id, testNode.id)).toBeGreaterThanOrEqual(6)
        })

        it('findAnalysisVersionsDao - 应降序返回', async () => {
            const versions = await findAnalysisVersionsDao(testCase.id, testNode.id)
            expect(versions.length).toBeGreaterThanOrEqual(1)
            for (let i = 1; i < versions.length; i++) {
                expect(versions[i]!.version).toBeLessThanOrEqual(versions[i - 1]!.version)
            }
        })

        it('findLatestAnalysisVersionDao - 应返回最新版本', async () => {
            expect(await findLatestAnalysisVersionDao(testCase.id, testNode.id)).not.toBeNull()
        })

        it('findLatestAnalysisVersionDao - 不存在时返回 null', async () => {
            expect(await findLatestAnalysisVersionDao(999999, 999999)).toBeNull()
        })
    })

    describe('findAnalysisBySessionAndNodeDao', () => {
        it('应找到匹配的分析结果', async () => {
            expect(await findAnalysisBySessionAndNodeDao(testSession.sessionId, testNode.id)).not.toBeNull()
        })

        it('应按 status 过滤', async () => {
            const result = await findAnalysisBySessionAndNodeDao(testSession.sessionId, testNode.id, AnalysisStatus.IN_PROGRESS)
            if (result) expect(result.status).toBe(AnalysisStatus.IN_PROGRESS)
        })

        it('不存在时返回 null', async () => {
            expect(await findAnalysisBySessionAndNodeDao('non-existent', 999999)).toBeNull()
        })
    })

    describe('findLatestAnalysisBySessionAndNodeDao', () => {
        it('应返回最新分析记录', async () => {
            expect(await findLatestAnalysisBySessionAndNodeDao(testSession.sessionId, testNode.id)).not.toBeNull()
        })

        it('不存在时返回 null', async () => {
            expect(await findLatestAnalysisBySessionAndNodeDao('non-existent', 999999)).toBeNull()
        })
    })

    describe('updateAnalysisDao', () => {
        it('应更新 analysisResult', async () => {
            const a = await createAndTrack({ caseId: testCase.id, sessionId: testSession.sessionId, nodeId: testNode.id, analysisType: 'upd_result' })
            expect((await updateAnalysisDao(a.id, { analysisResult: '更新后' })).analysisResult).toBe('更新后')
        })

        it('应更新 status/isActive/tokenCount/tokens/pointDeducted', async () => {
            const a = await createAndTrack({ caseId: testCase.id, sessionId: testSession.sessionId, nodeId: testNode.id, analysisType: 'upd_fields' })
            const updated = await updateAnalysisDao(a.id, { status: AnalysisStatus.COMPLETED, isActive: false, tokenCount: 100, tokens: 50000, pointDeducted: true })
            expect(updated.status).toBe(AnalysisStatus.COMPLETED)
            expect(updated.tokenCount).toBe(100)
            expect(updated.pointDeducted).toBe(true)
        })
    })

    describe('softDeleteAnalysisDao', () => {
        it('应软删除单条分析结果', async () => {
            const a = await createAndTrack({ caseId: testCase.id, sessionId: testSession.sessionId, nodeId: testNode.id, analysisType: 'del_single' })
            await softDeleteAnalysisDao(a.id)
            expect(await findAnalysisByIdDao(a.id)).toBeNull()
        })
    })

    describe('softDeleteAnalysesBySessionDao', () => {
        it('应批量软删除', async () => {
            const ns = await createTestSession({ caseId: testCase.id })
            testIds.sessionIds.push(ns.sessionId)
            const a1 = await createAndTrack({ caseId: testCase.id, sessionId: ns.sessionId, nodeId: testNode.id, analysisType: 'batch_del_1' })
            const a2 = await createAndTrack({ caseId: testCase.id, sessionId: ns.sessionId, nodeId: testNode.id, analysisType: 'batch_del_2' })
            await softDeleteAnalysesBySessionDao(ns.sessionId)
            expect(await findAnalysisByIdDao(a1.id)).toBeNull()
            expect(await findAnalysisByIdDao(a2.id)).toBeNull()
        })
    })

    describe('findAnalysisHistoryByCaseIdDao', () => {
        it('应返回 Map', async () => {
            expect(await findAnalysisHistoryByCaseIdDao(testCase.id)).toBeInstanceOf(Map)
        })

        it('不存在的案件返回空 Map', async () => {
            expect((await findAnalysisHistoryByCaseIdDao(999999)).size).toBe(0)
        })
    })

    describe('countAnalysesByCaseIdDao', () => {
        it('应返回数量', async () => {
            expect(await countAnalysesByCaseIdDao(testCase.id)).toBeGreaterThanOrEqual(0)
        })

        it('应按 status 筛选', async () => {
            expect(typeof await countAnalysesByCaseIdDao(testCase.id, AnalysisStatus.IN_PROGRESS)).toBe('number')
        })
    })

    describe('版本激活管理', () => {
        it('activateVersionDao - 应激活指定版本', async () => {
            // 先清空所有激活版本
            await deactivateVersionsDao(testCase.id, testNode.id)

            const a1 = await createAndTrack({ caseId: testCase.id, sessionId: testSession.sessionId, nodeId: testNode.id, analysisType: 'activate_a', version: 100, isActive: true })
            await deactivateVersionsDao(testCase.id, testNode.id)

            const a2 = await createAndTrack({ caseId: testCase.id, sessionId: testSession.sessionId, nodeId: testNode.id, analysisType: 'activate_b', version: 101, isActive: false })
            await activateVersionDao(a2.id, testCase.id, testNode.id)

            expect((await findAnalysisByIdDao(a1.id))!.isActive).toBe(false)
            expect((await findAnalysisByIdDao(a2.id))!.isActive).toBe(true)
        })

        it('deactivateVersionsDao - 应取消所有激活版本', async () => {
            await deactivateVersionsDao(testCase.id, testNode.id)
            const a = await createAndTrack({ caseId: testCase.id, sessionId: testSession.sessionId, nodeId: testNode.id, analysisType: 'deact', version: 200, isActive: true })
            await deactivateVersionsDao(testCase.id, testNode.id)
            expect((await findAnalysisByIdDao(a.id))!.isActive).toBe(false)
        })

        it('findActiveAnalysisVersionDao - 应返回激活版本', async () => {
            await deactivateVersionsDao(testCase.id, testNode.id)
            await createAndTrack({ caseId: testCase.id, sessionId: testSession.sessionId, nodeId: testNode.id, analysisType: 'find_act', version: 300, isActive: true })
            expect(await findActiveAnalysisVersionDao(testCase.id, testNode.id)).not.toBeNull()
        })

        it('findActiveAnalysisVersionDao - 无激活版本返回 null', async () => {
            expect(await findActiveAnalysisVersionDao(999999, 999999)).toBeNull()
        })
    })
})
