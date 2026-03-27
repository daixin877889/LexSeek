/**
 * 案件分析结果 DAO 层测试
 *
 * **Feature: server-test-coverage**
 * **Validates: Requirements 8.1, 8.2, 9.6, 9.7**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import * as fc from 'fast-check'
import './test-setup'
import {
    createTestUser,
    createTestCaseType,
    createTestCase,
    createTestSession,
    createTestNode,
    createTestModelProvider,
    createTestModel,
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
    getNextVersionDao,
    updateAnalysisDao,
    softDeleteAnalysisDao,
    softDeleteAnalysesBySessionDao,
    findAnalysisHistoryByCaseIdDao,
    countAnalysesByCaseIdDao,
    AnalysisStatus,
} from '../../../server/services/case/analysis.dao'
import { v7 as uuidv7 } from 'uuid'

// 属性测试配置
const PBT_CONFIG = { seed: 42, deterministic: true }

describe('案件分析结果 DAO 层', () => {
    let testIds: CaseTestIds
    let testUser: Awaited<ReturnType<typeof createTestUser>>
    let testCaseType: Awaited<ReturnType<typeof createTestCaseType>>
    let testCase: Awaited<ReturnType<typeof createTestCase>>
    let testSession: Awaited<ReturnType<typeof createTestSession>>
    let testNode: Awaited<ReturnType<typeof createTestNode>>
    let testModelProvider: Awaited<ReturnType<typeof createTestModelProvider>>
    let testModel: Awaited<ReturnType<typeof createTestModel>>

    beforeAll(async () => {
        testIds = createEmptyTestIds()

        // 创建基础测试数据
        testUser = await createTestUser()
        testIds.userIds.push(testUser.id)

        testCaseType = await createTestCaseType({ status: 1 })
        testIds.caseTypeIds.push(testCaseType.id)

        testCase = await createTestCase({
            userId: testUser.id,
            caseTypeId: testCaseType.id,
        })
        testIds.caseIds.push(testCase.id)

        testSession = await createTestSession({ caseId: testCase.id })
        testIds.sessionIds.push(testSession.sessionId)

        // 创建模型和节点
        testModelProvider = await createTestModelProvider()
        testIds.modelProviderIds.push(testModelProvider.id)

        testModel = await createTestModel({ providerId: testModelProvider.id })
        testIds.modelIds.push(testModel.id)

        testNode = await createTestNode({ modelId: testModel.id })
        testIds.nodeIds.push(testNode.id)
    })

    afterEach(async () => {
        // 清理每个测试创建的分析结果
        if (testIds.analysisIds.length > 0) {
            await cleanupTestData({
                ...createEmptyTestIds(),
                analysisIds: [...testIds.analysisIds],
            })
            testIds.analysisIds = []
        }
    })

    afterAll(async () => {
        await cleanupTestData(testIds)
        await disconnectTestDb()
    })

    // ==================== createAnalysisDao ====================

    describe('createAnalysisDao - 创建分析结果', () => {
        it('应该成功创建分析结果', async () => {
            const analysis = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: testNode.id,
                analysisType: 'fact_analysis',
                analysisResult: '事实分析内容',
                status: AnalysisStatus.IN_PROGRESS,
            })
            testIds.analysisIds.push(analysis.id)

            expect(analysis).toBeDefined()
            expect(analysis.id).toBeGreaterThan(0)
            expect(analysis.caseId).toBe(testCase.id)
            expect(analysis.sessionId).toBe(testSession.sessionId)
            expect(analysis.nodeId).toBe(testNode.id)
            expect(analysis.analysisType).toBe('fact_analysis')
            expect(analysis.analysisResult).toBe('事实分析内容')
            expect(analysis.version).toBe(1)
            expect(analysis.status).toBe(AnalysisStatus.IN_PROGRESS)
            expect(analysis.deletedAt).toBeNull()
        })

        it('应该支持设置版本号', async () => {
            const analysis = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: testNode.id,
                analysisType: 'version_test',
                version: 5,
            })
            testIds.analysisIds.push(analysis.id)

            expect(analysis.version).toBe(5)
        })

        it('应该默认状态为进行中', async () => {
            const analysis = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: testNode.id,
                analysisType: 'default_status_test',
            })
            testIds.analysisIds.push(analysis.id)

            expect(analysis.status).toBe(AnalysisStatus.IN_PROGRESS)
        })

        it('应该支持设置已完成状态', async () => {
            const analysis = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: testNode.id,
                analysisType: 'completed_test',
                analysisResult: '已完成内容',
                originalResult: '原始内容',
                status: AnalysisStatus.COMPLETED,
            })
            testIds.analysisIds.push(analysis.id)

            expect(analysis.status).toBe(AnalysisStatus.COMPLETED)
            expect(analysis.analysisResult).toBe('已完成内容')
            expect(analysis.originalResult).toBe('原始内容')
        })
    })

    // ==================== findAnalysisByIdDao ====================

    describe('findAnalysisByIdDao - 通过 ID 查询分析结果', () => {
        it('应该返回存在的分析结果', async () => {
            const analysis = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: testNode.id,
                analysisType: 'find_by_id_test',
            })
            testIds.analysisIds.push(analysis.id)

            const found = await findAnalysisByIdDao(analysis.id)

            expect(found).toBeDefined()
            expect(found!.id).toBe(analysis.id)
            expect(found!.caseId).toBe(testCase.id)
        })

        it('应该返回 null 当分析结果不存在', async () => {
            const found = await findAnalysisByIdDao(999999)
            expect(found).toBeNull()
        })

        it('应该支持包含关联数据', async () => {
            const analysis = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: testNode.id,
                analysisType: 'with_relations_test',
            })
            testIds.analysisIds.push(analysis.id)

            const found = await findAnalysisByIdDao(analysis.id, true)

            expect(found).toBeDefined()
            expect(found!.node).toBeDefined()
            expect(found!.node!.id).toBe(testNode.id)
            expect(found!.case).toBeDefined()
            expect(found!.case!.id).toBe(testCase.id)
        })

        it('应该自动过滤已删除的分析结果', async () => {
            const analysis = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: testNode.id,
                analysisType: 'soft_delete_filter_test',
            })
            testIds.analysisIds.push(analysis.id)

            await softDeleteAnalysisDao(analysis.id)

            const found = await findAnalysisByIdDao(analysis.id)
            expect(found).toBeNull()
        })
    })

    // ==================== findManyAnalysesDao ====================

    describe('findManyAnalysesDao - 分页查询分析结果列表', () => {
        it('应该返回分页的分析结果列表', async () => {
            // 创建多个分析结果
            const node2 = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(node2.id)

            const session2 = await createTestSession({ caseId: testCase.id })
            testIds.sessionIds.push(session2.sessionId)

            for (let i = 0; i < 3; i++) {
                const analysis = await createAnalysisDao({
                    caseId: testCase.id,
                    sessionId: session2.sessionId,
                    nodeId: node2.id,
                    analysisType: `list_test_${i}`,
                })
                testIds.analysisIds.push(analysis.id)
            }

            const result = await findManyAnalysesDao({
                caseId: testCase.id,
                page: 1,
                pageSize: 10,
            })

            expect(result.list).toBeDefined()
            expect(Array.isArray(result.list)).toBe(true)
            expect(result.total).toBeGreaterThanOrEqual(3)
        })

        it('应该支持按会话 ID 筛选', async () => {
            const newSession = await createTestSession({ caseId: testCase.id })
            testIds.sessionIds.push(newSession.sessionId)

            const newNode = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(newNode.id)

            const analysis = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: newSession.sessionId,
                nodeId: newNode.id,
                analysisType: 'session_filter_test',
            })
            testIds.analysisIds.push(analysis.id)

            const result = await findManyAnalysesDao({
                sessionId: newSession.sessionId,
            })

            expect(result.list.every(a => a.sessionId === newSession.sessionId)).toBe(true)
        })

        it('应该支持按节点 ID 筛选', async () => {
            const newNode = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(newNode.id)

            const analysis = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: newNode.id,
                analysisType: 'node_filter_test',
            })
            testIds.analysisIds.push(analysis.id)

            const result = await findManyAnalysesDao({
                nodeId: newNode.id,
            })

            expect(result.list.every(a => a.nodeId === newNode.id)).toBe(true)
        })

        it('应该支持按分析类型筛选', async () => {
            const analysis = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: testNode.id,
                analysisType: 'specific_analysis_type',
            })
            testIds.analysisIds.push(analysis.id)

            const result = await findManyAnalysesDao({
                analysisType: 'specific_analysis_type',
            })

            expect(result.list.every(a => a.analysisType === 'specific_analysis_type')).toBe(true)
        })

        it('应该支持按状态筛选', async () => {
            const inProgressAnalysis = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: testNode.id,
                analysisType: 'status_filter_test',
                status: AnalysisStatus.IN_PROGRESS,
            })
            testIds.analysisIds.push(inProgressAnalysis.id)

            const completedAnalysis = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: testNode.id,
                analysisType: 'status_filter_test_2',
                status: AnalysisStatus.COMPLETED,
            })
            testIds.analysisIds.push(completedAnalysis.id)

            const result = await findManyAnalysesDao({
                status: AnalysisStatus.COMPLETED,
            })

            expect(result.list.every(a => a.status === AnalysisStatus.COMPLETED)).toBe(true)
        })

        it('应该支持分页参数', async () => {
            const result = await findManyAnalysesDao({
                caseId: testCase.id,
                page: 1,
                pageSize: 2,
            })

            expect(result.list.length).toBeLessThanOrEqual(2)
        })
    })

    // ==================== findAnalysesBySessionIdDao ====================

    describe('findAnalysesBySessionIdDao - 查询会话的所有分析结果', () => {
        it('应该返回会话的所有分析结果', async () => {
            const newSession = await createTestSession({ caseId: testCase.id })
            testIds.sessionIds.push(newSession.sessionId)

            const node1 = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(node1.id)
            const node2 = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(node2.id)

            const a1 = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: newSession.sessionId,
                nodeId: node1.id,
                analysisType: 'session_analyses_test_1',
            })
            testIds.analysisIds.push(a1.id)

            const a2 = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: newSession.sessionId,
                nodeId: node2.id,
                analysisType: 'session_analyses_test_2',
            })
            testIds.analysisIds.push(a2.id)

            const result = await findAnalysesBySessionIdDao(newSession.sessionId)

            expect(result.length).toBeGreaterThanOrEqual(2)
            expect(result.some(a => a.id === a1.id)).toBe(true)
            expect(result.some(a => a.id === a2.id)).toBe(true)
        })

        it('应该返回空数组当会话没有分析结果', async () => {
            const result = await findAnalysesBySessionIdDao('non_existent_session')
            expect(result).toEqual([])
        })

        it('应该包含关联的节点数据', async () => {
            const analysis = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: testNode.id,
                analysisType: 'session_with_node_test',
            })
            testIds.analysisIds.push(analysis.id)

            const result = await findAnalysesBySessionIdDao(testSession.sessionId)

            const found = result.find(a => a.id === analysis.id)
            expect(found).toBeDefined()
            expect(found!.node).toBeDefined()
        })
    })

    // ==================== findAnalysisVersionsDao ====================

    describe('findAnalysisVersionsDao - 查询某节点的所有版本', () => {
        it('应该返回节点的所有版本按版本号降序', async () => {
            const newNode = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(newNode.id)

            const v1 = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: newNode.id,
                analysisType: 'version_query_test',
                version: 1,
            })
            testIds.analysisIds.push(v1.id)

            const v2 = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: newNode.id,
                analysisType: 'version_query_test',
                version: 2,
            })
            testIds.analysisIds.push(v2.id)

            const v3 = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: newNode.id,
                analysisType: 'version_query_test',
                version: 3,
            })
            testIds.analysisIds.push(v3.id)

            const versions = await findAnalysisVersionsDao(testCase.id, newNode.id)

            expect(versions.length).toBeGreaterThanOrEqual(3)
            // 按版本号降序排列
            expect(versions[0].version).toBeGreaterThanOrEqual(versions[1].version)
        })

        it('应该返回空数组当节点没有分析结果', async () => {
            const result = await findAnalysisVersionsDao(testCase.id, 999999)
            expect(result).toEqual([])
        })
    })

    // ==================== findLatestAnalysisVersionDao ====================

    describe('findLatestAnalysisVersionDao - 查询最新版本', () => {
        it('应该返回版本号最大的分析结果', async () => {
            const newNode = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(newNode.id)

            const v1 = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: newNode.id,
                analysisType: 'latest_version_test',
                version: 1,
            })
            testIds.analysisIds.push(v1.id)

            const v2 = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: newNode.id,
                analysisType: 'latest_version_test',
                version: 2,
            })
            testIds.analysisIds.push(v2.id)

            const latest = await findLatestAnalysisVersionDao(testCase.id, newNode.id)

            expect(latest).toBeDefined()
            expect(latest!.version).toBeGreaterThanOrEqual(2)
        })

        it('应该返回 null 当节点没有分析结果', async () => {
            const result = await findLatestAnalysisVersionDao(testCase.id, 999999)
            expect(result).toBeNull()
        })
    })

    // ==================== findAnalysisBySessionAndNodeDao ====================

    describe('findAnalysisBySessionAndNodeDao - 查询会话中某节点的分析结果', () => {
        it('应该返回会话中某节点的分析结果', async () => {
            const analysis = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: testNode.id,
                analysisType: 'session_node_test',
            })
            testIds.analysisIds.push(analysis.id)

            const found = await findAnalysisBySessionAndNodeDao(
                testSession.sessionId,
                testNode.id
            )

            expect(found).toBeDefined()
            expect(found!.id).toBe(analysis.id)
        })

        it('应该返回 null 当会话中该节点没有分析结果', async () => {
            const result = await findAnalysisBySessionAndNodeDao(
                testSession.sessionId,
                999999
            )
            expect(result).toBeNull()
        })

        it('应该返回 null 当该会话没有分析结果', async () => {
            const result = await findAnalysisBySessionAndNodeDao(
                'non_existent_session',
                testNode.id
            )
            expect(result).toBeNull()
        })
    })

    // ==================== getNextVersionDao ====================

    describe('getNextVersionDao - 获取下一个版本号', () => {
        it('新节点应该返回 1', async () => {
            const newNode = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(newNode.id)

            const nextVersion = await getNextVersionDao(testCase.id, newNode.id)

            expect(nextVersion).toBe(1)
        })

        it('有多个版本时应该返回下一个版本号', async () => {
            const newNode = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(newNode.id)

            // 创建第一个版本
            await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: newNode.id,
                analysisType: 'next_version_test',
                version: 1,
            })
            // 不加入 testIds，手动清理

            // 通过 DAO 创建更多版本
            const v1 = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: newNode.id,
                analysisType: 'next_version_test',
                version: 1,
            })
            testIds.analysisIds.push(v1.id)

            const v2 = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: newNode.id,
                analysisType: 'next_version_test',
                version: 2,
            })
            testIds.analysisIds.push(v2.id)

            const nextVersion = await getNextVersionDao(testCase.id, newNode.id)

            expect(nextVersion).toBe(3)
        })
    })

    // ==================== updateAnalysisDao ====================

    describe('updateAnalysisDao - 更新分析结果', () => {
        it('应该成功更新分析结果', async () => {
            const analysis = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: testNode.id,
                analysisType: 'update_test',
                analysisResult: '原始结果',
                status: AnalysisStatus.IN_PROGRESS,
            })
            testIds.analysisIds.push(analysis.id)

            const updated = await updateAnalysisDao(analysis.id, {
                analysisResult: '更新后的结果',
                status: AnalysisStatus.COMPLETED,
            })

            expect(updated.analysisResult).toBe('更新后的结果')
            expect(updated.status).toBe(AnalysisStatus.COMPLETED)
        })

        it('应该更新 originalResult', async () => {
            const analysis = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: testNode.id,
                analysisType: 'update_original_test',
            })
            testIds.analysisIds.push(analysis.id)

            const updated = await updateAnalysisDao(analysis.id, {
                originalResult: '解密后的原始内容',
            })

            expect(updated.originalResult).toBe('解密后的原始内容')
        })

        it('应该更新 updatedAt 时间戳', async () => {
            const analysis = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: testNode.id,
                analysisType: 'update_timestamp_test',
            })
            testIds.analysisIds.push(analysis.id)

            const originalUpdatedAt = analysis.updatedAt

            // 等待一小段时间确保时间戳不同
            await new Promise(resolve => setTimeout(resolve, 10))

            const updated = await updateAnalysisDao(analysis.id, {
                analysisResult: '时间戳测试',
            })

            expect(updated.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime())
        })

        it('应该只更新提供的字段', async () => {
            const analysis = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: testNode.id,
                analysisType: 'partial_update_test',
                analysisResult: '原始结果',
            })
            testIds.analysisIds.push(analysis.id)

            const updated = await updateAnalysisDao(analysis.id, {
                status: AnalysisStatus.COMPLETED,
            })

            expect(updated.analysisResult).toBe('原始结果')
            expect(updated.status).toBe(AnalysisStatus.COMPLETED)
        })
    })

    // ==================== softDeleteAnalysisDao ====================

    describe('softDeleteAnalysisDao - 软删除分析结果', () => {
        it('应该设置 deletedAt 时间戳', async () => {
            const analysis = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: testNode.id,
                analysisType: 'soft_delete_test',
            })
            testIds.analysisIds.push(analysis.id)

            expect(analysis.deletedAt).toBeNull()

            await softDeleteAnalysisDao(analysis.id)

            // 重新查询
            const found = await findAnalysisByIdDao(analysis.id)
            expect(found).toBeNull()

            // 直接查询数据库确认 deletedAt 被设置
            const { getTestPrisma } = await import('./test-db-helper')
            const raw = await getTestPrisma().caseAnalyses.findUnique({
                where: { id: analysis.id },
            })
            expect(raw).toBeDefined()
            expect(raw!.deletedAt).not.toBeNull()
        })

        it('软删除后不应被其他 DAO 查询返回', async () => {
            const analysis = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: testNode.id,
                analysisType: 'soft_delete_filter_test',
            })
            testIds.analysisIds.push(analysis.id)

            await softDeleteAnalysisDao(analysis.id)

            // findById 不返回
            const byId = await findAnalysisByIdDao(analysis.id)
            expect(byId).toBeNull()

            // findMany 不返回
            const byList = await findManyAnalysesDao({ caseId: testCase.id })
            expect(byList.list.every(a => a.id !== analysis.id)).toBe(true)
        })
    })

    // ==================== softDeleteAnalysesBySessionDao ====================

    describe('softDeleteAnalysesBySessionDao - 批量软删除会话分析结果', () => {
        it('应该批量软删除会话的所有分析结果', async () => {
            const newSession = await createTestSession({ caseId: testCase.id })
            testIds.sessionIds.push(newSession.sessionId)

            const node1 = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(node1.id)
            const node2 = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(node2.id)

            const a1 = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: newSession.sessionId,
                nodeId: node1.id,
                analysisType: 'batch_delete_test_1',
            })
            testIds.analysisIds.push(a1.id)

            const a2 = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: newSession.sessionId,
                nodeId: node2.id,
                analysisType: 'batch_delete_test_2',
            })
            testIds.analysisIds.push(a2.id)

            await softDeleteAnalysesBySessionDao(newSession.sessionId)

            // 验证两个分析结果都被软删除
            const found1 = await findAnalysisByIdDao(a1.id)
            const found2 = await findAnalysisByIdDao(a2.id)

            expect(found1).toBeNull()
            expect(found2).toBeNull()
        })

        it('不应影响其他会话的分析结果', async () => {
            const session1 = await createTestSession({ caseId: testCase.id })
            testIds.sessionIds.push(session1.sessionId)
            const session2 = await createTestSession({ caseId: testCase.id })
            testIds.sessionIds.push(session2.sessionId)

            const analysis1 = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: session1.sessionId,
                nodeId: testNode.id,
                analysisType: 'preserve_session_test_1',
            })
            testIds.analysisIds.push(analysis1.id)

            const analysis2 = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: session2.sessionId,
                nodeId: testNode.id,
                analysisType: 'preserve_session_test_2',
            })
            testIds.analysisIds.push(analysis2.id)

            await softDeleteAnalysesBySessionDao(session1.sessionId)

            // session2 的分析结果应该保留
            const found2 = await findAnalysisByIdDao(analysis2.id)
            expect(found2).not.toBeNull()
        })
    })

    // ==================== findAnalysisHistoryByCaseIdDao ====================

    describe('findAnalysisHistoryByCaseIdDao - 按节点分组的分析历史', () => {
        it('应该按 nodeId 分组返回分析历史 Map', async () => {
            const node1 = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(node1.id)
            const node2 = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(node2.id)

            const a1 = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: node1.id,
                analysisType: 'history_test',
                version: 1,
            })
            testIds.analysisIds.push(a1.id)

            const a2 = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: node1.id,
                analysisType: 'history_test',
                version: 2,
            })
            testIds.analysisIds.push(a2.id)

            const a3 = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: node2.id,
                analysisType: 'history_test',
                version: 1,
            })
            testIds.analysisIds.push(a3.id)

            const historyMap = await findAnalysisHistoryByCaseIdDao(testCase.id)

            expect(historyMap instanceof Map).toBe(true)
            expect(historyMap.has(node1.id)).toBe(true)
            expect(historyMap.has(node2.id)).toBe(true)
            expect(historyMap.get(node1.id)!.length).toBeGreaterThanOrEqual(2)
            expect(historyMap.get(node2.id)!.length).toBeGreaterThanOrEqual(1)
        })

        it('应该返回空 Map 当案件没有分析结果', async () => {
            const result = await findAnalysisHistoryByCaseIdDao(999999)
            expect(result instanceof Map).toBe(true)
            expect(result.size).toBe(0)
        })

        it('应该按节点内版本号降序排列', async () => {
            const newNode = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(newNode.id)

            await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: newNode.id,
                analysisType: 'history_version_order_test',
                version: 1,
            })
            await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: newNode.id,
                analysisType: 'history_version_order_test',
                version: 3,
            })
            await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: newNode.id,
                analysisType: 'history_version_order_test',
                version: 2,
            })

            const historyMap = await findAnalysisHistoryByCaseIdDao(testCase.id)
            const nodeHistory = historyMap.get(newNode.id)

            expect(nodeHistory).toBeDefined()
            expect(nodeHistory![0].version).toBeGreaterThanOrEqual(nodeHistory![1].version)
        })
    })

    // ==================== countAnalysesByCaseIdDao ====================

    describe('countAnalysesByCaseIdDao - 统计分析', () => {
        it('应该返回案件的分析结果总数', async () => {
            const node1 = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(node1.id)
            const node2 = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(node2.id)

            const a1 = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: node1.id,
                analysisType: 'count_test_1',
            })
            testIds.analysisIds.push(a1.id)

            const a2 = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: node2.id,
                analysisType: 'count_test_2',
            })
            testIds.analysisIds.push(a2.id)

            const count = await countAnalysesByCaseIdDao(testCase.id)

            expect(count).toBeGreaterThanOrEqual(2)
        })

        it('应该支持按状态筛选统计', async () => {
            const inProgress = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: testNode.id,
                analysisType: 'count_status_test',
                status: AnalysisStatus.IN_PROGRESS,
            })
            testIds.analysisIds.push(inProgress.id)

            const completed = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: testNode.id,
                analysisType: 'count_status_test',
                status: AnalysisStatus.COMPLETED,
            })
            testIds.analysisIds.push(completed.id)

            const totalCount = await countAnalysesByCaseIdDao(testCase.id)
            const completedCount = await countAnalysesByCaseIdDao(
                testCase.id,
                AnalysisStatus.COMPLETED
            )
            const inProgressCount = await countAnalysesByCaseIdDao(
                testCase.id,
                AnalysisStatus.IN_PROGRESS
            )

            expect(totalCount).toBeGreaterThanOrEqual(completedCount + inProgressCount)
        })

        it('应该返回 0 当案件没有分析结果', async () => {
            const count = await countAnalysesByCaseIdDao(999999)
            expect(count).toBe(0)
        })

        it('应该自动过滤已删除的分析结果', async () => {
            const analysis = await createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: testNode.id,
                analysisType: 'count_deleted_test',
            })
            testIds.analysisIds.push(analysis.id)

            const countBefore = await countAnalysesByCaseIdDao(testCase.id)

            await softDeleteAnalysisDao(analysis.id)

            const countAfter = await countAnalysesByCaseIdDao(testCase.id)

            expect(countAfter).toBeLessThan(countBefore)
        })
    })

    // ==================== 属性测试 ====================

    describe('属性测试', () => {
        describe('Property 1: 创建-查询往返一致性', () => {
            it('创建分析结果后通过 ID 查询应返回等价的数据', async () => {
                const node = await createTestNode({ modelId: testModel.id })
                testIds.nodeIds.push(node.id)
                const session = await createTestSession({ caseId: testCase.id })
                testIds.sessionIds.push(session.sessionId)

                await fc.assert(
                    fc.asyncProperty(
                        fc.record({
                            analysisType: fc.string({ minLength: 1, maxLength: 50 }),
                            analysisResult: fc.string({ maxLength: 200 }),
                            status: fc.constantFrom(
                                AnalysisStatus.IN_PROGRESS,
                                AnalysisStatus.COMPLETED,
                                AnalysisStatus.FAILED
                            ),
                        }),
                        async ({ analysisType, analysisResult, status }) => {
                            const created = await createAnalysisDao({
                                caseId: testCase.id,
                                sessionId: session.sessionId,
                                nodeId: node.id,
                                analysisType,
                                analysisResult,
                                status,
                            })
                            testIds.analysisIds.push(created.id)

                            const found = await findAnalysisByIdDao(created.id)

                            expect(found).not.toBeNull()
                            expect(found!.caseId).toBe(testCase.id)
                            expect(found!.sessionId).toBe(session.sessionId)
                            expect(found!.nodeId).toBe(node.id)
                            expect(found!.analysisType).toBe(analysisType)
                            expect(found!.status).toBe(status)

                            return true
                        }
                    ),
                    PBT_CONFIG
                )
            })
        })

        describe('Property 2: 版本号递增单调性', () => {
            it('对于同一 caseId 和 nodeId，连续创建的分析结果版本号应严格递增', async () => {
                const node = await createTestNode({ modelId: testModel.id })
                testIds.nodeIds.push(node.id)
                const session = await createTestSession({ caseId: testCase.id })
                testIds.sessionIds.push(session.sessionId)

                await fc.assert(
                    fc.asyncProperty(
                        fc.integer({ min: 2, max: 5 }),
                        async (count) => {
                            const versions: number[] = []

                            for (let i = 0; i < count; i++) {
                                // 正确模式：先获取下一个版本号，再创建分析结果
                                const nextVersion = await getNextVersionDao(testCase.id, node.id)
                                const analysis = await createAnalysisDao({
                                    caseId: testCase.id,
                                    sessionId: session.sessionId,
                                    nodeId: node.id,
                                    analysisType: 'version_monotonicity_test',
                                    version: nextVersion,
                                })
                                testIds.analysisIds.push(analysis.id)
                                versions.push(analysis.version)
                            }

                            // 验证版本号严格递增
                            for (let i = 1; i < versions.length; i++) {
                                expect(versions[i]).toBe(versions[i - 1] + 1)
                            }

                            return true
                        }
                    ),
                    { seed: 42, deterministic: true, numRuns: 15 }
                )
            })
        })

        describe('Property 3: 软删除过滤正确性', () => {
            it('软删除后所有查询操作应自动过滤该记录', async () => {
                const node = await createTestNode({ modelId: testModel.id })
                testIds.nodeIds.push(node.id)
                const session = await createTestSession({ caseId: testCase.id })
                testIds.sessionIds.push(session.sessionId)

                await fc.assert(
                    fc.asyncProperty(
                        fc.string({ minLength: 1, maxLength: 30 }),
                        async (analysisType) => {
                            const analysis = await createAnalysisDao({
                                caseId: testCase.id,
                                sessionId: session.sessionId,
                                nodeId: node.id,
                                analysisType,
                            })
                            testIds.analysisIds.push(analysis.id)

                            // 软删除
                            await softDeleteAnalysisDao(analysis.id)

                            // 验证各种查询都不返回该记录
                            const byId = await findAnalysisByIdDao(analysis.id)
                            expect(byId).toBeNull()

                            const list = await findManyAnalysesDao({
                                caseId: testCase.id,
                            })
                            expect(list.list.every(a => a.id !== analysis.id)).toBe(true)

                            const count = await countAnalysesByCaseIdDao(testCase.id)
                            expect(list.total).toBeLessThan(count + 1)

                            return true
                        }
                    ),
                    PBT_CONFIG
                )
            })
        })

        describe('Property 4: 分组 Map 键值正确性', () => {
            it('findAnalysisHistoryByCaseIdDao 返回的 Map 应包含所有相关 nodeId', async () => {
                const node1 = await createTestNode({ modelId: testModel.id })
                testIds.nodeIds.push(node1.id)
                const node2 = await createTestNode({ modelId: testModel.id })
                testIds.nodeIds.push(node2.id)

                await fc.assert(
                    fc.asyncProperty(
                        fc.record({
                            a1Type: fc.string({ minLength: 1, maxLength: 20 }),
                            a2Type: fc.string({ minLength: 1, maxLength: 20 }),
                        }),
                        async ({ a1Type, a2Type }) => {
                            await createAnalysisDao({
                                caseId: testCase.id,
                                sessionId: testSession.sessionId,
                                nodeId: node1.id,
                                analysisType: a1Type,
                            })
                            await createAnalysisDao({
                                caseId: testCase.id,
                                sessionId: testSession.sessionId,
                                nodeId: node2.id,
                                analysisType: a2Type,
                            })

                            const historyMap = await findAnalysisHistoryByCaseIdDao(
                                testCase.id
                            )

                            expect(historyMap.has(node1.id)).toBe(true)
                            expect(historyMap.has(node2.id)).toBe(true)

                            return true
                        }
                    ),
                    PBT_CONFIG
                )
            })
        })
    })
})
