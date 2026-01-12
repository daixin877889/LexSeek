/**
 * 案件分析服务层测试
 *
 * **Feature: server-test-coverage**
 * **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
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
    createTestAnalysis,
    createTestModelProvider,
    createTestModel,
    createEmptyTestIds,
    cleanupTestData,
    disconnectTestDb,
    type CaseTestIds,
} from './test-db-helper'
import { PBT_CONFIG, analysisDataArbitrary } from './test-generators'
import {
    saveAnalysisResultService,
    startAnalysisService,
    completeAnalysisService,
    getAnalysisByIdService,
    getSessionAnalysesService,
    getAnalysisVersionsService,
    getLatestAnalysisVersionService,
    updateAnalysisResultService,
    deleteAnalysisService,
} from '../../../server/services/case/analysis.service'

describe('案件分析服务层', () => {
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
        testUser = await createTestUser()
        testIds.userIds.push(testUser.id)
        testCaseType = await createTestCaseType({ status: 1 })
        testIds.caseTypeIds.push(testCaseType.id)
        testCase = await createTestCase({ userId: testUser.id, caseTypeId: testCaseType.id })
        testIds.caseIds.push(testCase.id)
        testSession = await createTestSession({ caseId: testCase.id })
        testIds.sessionIds.push(testSession.sessionId)
        // 创建模型提供商和模型
        testModelProvider = await createTestModelProvider()
        testIds.modelProviderIds.push(testModelProvider.id)
        testModel = await createTestModel({ providerId: testModelProvider.id })
        testIds.modelIds.push(testModel.id)
        // 创建节点
        testNode = await createTestNode({ modelId: testModel.id })
        testIds.nodeIds.push(testNode.id)
    })

    afterEach(async () => {
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


    describe('saveAnalysisResultService - 保存分析结果', () => {
        it('应该成功保存分析结果', async () => {
            const analysis = await saveAnalysisResultService({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: testNode.id,
                analysisType: 'test_analysis',
                analysisResult: '测试分析结果',
            })
            testIds.analysisIds.push(analysis.id)

            expect(analysis).toBeDefined()
            expect(analysis.id).toBeGreaterThan(0)
            expect(analysis.caseId).toBe(testCase.id)
            expect(analysis.sessionId).toBe(testSession.sessionId)
            expect(analysis.nodeId).toBe(testNode.id)
            expect(analysis.version).toBe(1)
            expect(analysis.status).toBe(2) // COMPLETED
        })

        it('应该在案件不存在时抛出错误', async () => {
            await expect(
                saveAnalysisResultService({
                    caseId: 999999,
                    sessionId: testSession.sessionId,
                    nodeId: testNode.id,
                    analysisType: 'test',
                    analysisResult: '测试',
                })
            ).rejects.toThrow('案件不存在')
        })

        it('应该在会话不存在时抛出错误', async () => {
            await expect(
                saveAnalysisResultService({
                    caseId: testCase.id,
                    sessionId: 'non_existent_session',
                    nodeId: testNode.id,
                    analysisType: 'test',
                    analysisResult: '测试',
                })
            ).rejects.toThrow('会话不存在')
        })

        it('应该自动递增版本号', async () => {
            const analysis1 = await saveAnalysisResultService({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: testNode.id,
                analysisType: 'test_version',
                analysisResult: '版本1',
            })
            testIds.analysisIds.push(analysis1.id)

            const analysis2 = await saveAnalysisResultService({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: testNode.id,
                analysisType: 'test_version',
                analysisResult: '版本2',
            })
            testIds.analysisIds.push(analysis2.id)

            expect(analysis2.version).toBe(analysis1.version + 1)
        })
    })

    describe('startAnalysisService - 开始分析', () => {
        it('应该创建进行中状态的分析记录', async () => {
            // 创建新节点避免冲突
            const newNode = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(newNode.id)

            const analysis = await startAnalysisService({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: newNode.id,
                analysisType: 'test_start',
            })
            testIds.analysisIds.push(analysis.id)

            expect(analysis.status).toBe(1) // IN_PROGRESS
            expect(analysis.analysisResult).toBeNull()
        })

        it('应该返回已存在的分析记录', async () => {
            const newNode = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(newNode.id)

            const first = await startAnalysisService({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: newNode.id,
                analysisType: 'test_existing',
            })
            testIds.analysisIds.push(first.id)

            const second = await startAnalysisService({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: newNode.id,
                analysisType: 'test_existing',
            })

            expect(second.id).toBe(first.id)
        })
    })

    describe('completeAnalysisService - 完成分析', () => {
        it('应该更新分析结果和状态', async () => {
            const newNode = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(newNode.id)

            const started = await startAnalysisService({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: newNode.id,
                analysisType: 'test_complete',
            })
            testIds.analysisIds.push(started.id)

            const completed = await completeAnalysisService(
                started.id,
                '完成的分析结果',
                '原始结果'
            )

            expect(completed.status).toBe(2) // COMPLETED
            expect(completed.analysisResult).toBe('完成的分析结果')
            expect(completed.originalResult).toBe('原始结果')
        })

        it('应该在分析记录不存在时抛出错误', async () => {
            await expect(
                completeAnalysisService(999999, '测试', null)
            ).rejects.toThrow('分析记录不存在')
        })
    })

    describe('getAnalysisByIdService - 获取分析详情', () => {
        it('应该返回存在的分析记录', async () => {
            const analysis = await createTestAnalysis({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: testNode.id,
            })
            testIds.analysisIds.push(analysis.id)

            const found = await getAnalysisByIdService(analysis.id)

            expect(found).toBeDefined()
            expect(found?.id).toBe(analysis.id)
        })

        it('应该返回 null 当分析记录不存在', async () => {
            const found = await getAnalysisByIdService(999999)
            expect(found).toBeNull()
        })
    })

    describe('getSessionAnalysesService - 获取会话分析结果', () => {
        it('应该返回会话的所有分析结果', async () => {
            // 创建新会话
            const newSession = await createTestSession({ caseId: testCase.id })
            testIds.sessionIds.push(newSession.sessionId)

            const node1 = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(node1.id)
            const node2 = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(node2.id)

            const a1 = await createTestAnalysis({
                caseId: testCase.id,
                sessionId: newSession.sessionId,
                nodeId: node1.id,
            })
            testIds.analysisIds.push(a1.id)

            const a2 = await createTestAnalysis({
                caseId: testCase.id,
                sessionId: newSession.sessionId,
                nodeId: node2.id,
            })
            testIds.analysisIds.push(a2.id)

            const result = await getSessionAnalysesService(newSession.sessionId)

            expect(result.length).toBeGreaterThanOrEqual(2)
            expect(result.some(a => a.id === a1.id)).toBe(true)
            expect(result.some(a => a.id === a2.id)).toBe(true)
        })
    })

    describe('getAnalysisVersionsService - 获取分析版本', () => {
        it('应该返回节点的所有版本', async () => {
            const newNode = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(newNode.id)

            const v1 = await saveAnalysisResultService({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: newNode.id,
                analysisType: 'test_versions',
                analysisResult: '版本1',
            })
            testIds.analysisIds.push(v1.id)

            const v2 = await saveAnalysisResultService({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: newNode.id,
                analysisType: 'test_versions',
                analysisResult: '版本2',
            })
            testIds.analysisIds.push(v2.id)

            const versions = await getAnalysisVersionsService(testCase.id, newNode.id)

            expect(versions.length).toBeGreaterThanOrEqual(2)
            // 应该按版本号降序排列
            expect(versions[0].version).toBeGreaterThan(versions[1].version)
        })
    })

    describe('getLatestAnalysisVersionService - 获取最新版本', () => {
        it('应该返回最新版本的分析结果', async () => {
            const newNode = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(newNode.id)

            await saveAnalysisResultService({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: newNode.id,
                analysisType: 'test_latest',
                analysisResult: '旧版本',
            }).then(a => testIds.analysisIds.push(a.id))

            const latest = await saveAnalysisResultService({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: newNode.id,
                analysisType: 'test_latest',
                analysisResult: '最新版本',
            })
            testIds.analysisIds.push(latest.id)

            const found = await getLatestAnalysisVersionService(testCase.id, newNode.id)

            expect(found?.id).toBe(latest.id)
            expect(found?.analysisResult).toBe('最新版本')
        })
    })

    describe('updateAnalysisResultService - 更新分析结果', () => {
        it('应该成功更新分析结果', async () => {
            const analysis = await createTestAnalysis({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: testNode.id,
                analysisResult: '原始结果',
            })
            testIds.analysisIds.push(analysis.id)

            const updated = await updateAnalysisResultService(
                analysis.id,
                '更新后的结果',
                '更新后的原始结果'
            )

            expect(updated.analysisResult).toBe('更新后的结果')
            expect(updated.originalResult).toBe('更新后的原始结果')
        })
    })

    describe('deleteAnalysisService - 删除分析结果', () => {
        it('应该成功软删除分析结果', async () => {
            const analysis = await createTestAnalysis({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: testNode.id,
            })
            testIds.analysisIds.push(analysis.id)

            await deleteAnalysisService(analysis.id)

            const found = await getAnalysisByIdService(analysis.id)
            expect(found).toBeNull()
        })

        it('应该在分析记录不存在时抛出错误', async () => {
            await expect(deleteAnalysisService(999999)).rejects.toThrow('分析记录不存在')
        })
    })

    // ==================== 属性测试 ====================

    describe('属性测试', () => {
        describe('Property 10: 分析结果版本递增正确性', () => {
            it('每次保存分析结果应创建新版本，版本号应递增', async () => {
                await fc.assert(
                    fc.asyncProperty(
                        fc.integer({ min: 2, max: 5 }),
                        async (versionCount) => {
                            const newNode = await createTestNode({ modelId: testModel.id })
                            testIds.nodeIds.push(newNode.id)

                            const versions: number[] = []

                            for (let i = 0; i < versionCount; i++) {
                                const analysis = await saveAnalysisResultService({
                                    caseId: testCase.id,
                                    sessionId: testSession.sessionId,
                                    nodeId: newNode.id,
                                    analysisType: 'test_property',
                                    analysisResult: `版本${i + 1}`,
                                })
                                testIds.analysisIds.push(analysis.id)
                                versions.push(analysis.version)
                            }

                            // 验证版本号递增
                            for (let i = 1; i < versions.length; i++) {
                                expect(versions[i]).toBe(versions[i - 1] + 1)
                            }

                            return true
                        }
                    ),
                    { numRuns: 20 } // 减少运行次数避免创建过多数据
                )
            })
        })
    })
})
