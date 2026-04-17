/**
 * 初始化分析服务层测试
 *
 * **Feature: case-init-analysis**
 * **Validates: validateAndSortModules, getInitAnalysisStatusService, loadCompletedResultsService**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
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
    getTestPrisma,
    type CaseTestIds,
} from './test-db-helper'

import {
    validateAndSortModules,
    getInitAnalysisStatusService,
    loadCompletedResultsService,
} from '../../../server/services/case/initAnalysis.service'

describe('初始化分析服务层', () => {
    let testIds: CaseTestIds
    let testUser: Awaited<ReturnType<typeof createTestUser>>
    let testCaseType: Awaited<ReturnType<typeof createTestCaseType>>
    let testCase: Awaited<ReturnType<typeof createTestCase>>
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
        testModelProvider = await createTestModelProvider()
        testIds.modelProviderIds.push(testModelProvider.id)
        testModel = await createTestModel({ providerId: testModelProvider.id })
        testIds.modelIds.push(testModel.id)
    })

    afterEach(async () => {
        // 清理本轮创建的 session, analysis 和 node
        if (testIds.analysisIds.length > 0 || testIds.sessionIds.length > 0 || testIds.nodeIds.length > 0) {
            await cleanupTestData({
                ...createEmptyTestIds(),
                analysisIds: [...testIds.analysisIds],
                sessionIds: [...testIds.sessionIds],
                nodeIds: [...testIds.nodeIds],
            })
            testIds.analysisIds = []
            testIds.sessionIds = []
            testIds.nodeIds = []
        }
    })

    afterAll(async () => {
        await cleanupTestData(testIds)
        await disconnectTestDb()
    })

    // ==================== validateAndSortModules ====================

    describe('validateAndSortModules - 验证并排序模块', () => {
        it('应拒绝空的 selectedModules', () => {
            expect(() => validateAndSortModules([])).toThrow('请至少选择一个分析模块')
        })

        it('应拒绝非法模块名', () => {
            expect(() => validateAndSortModules(['invalid_module'])).toThrow('无效的分析模块: invalid_module')
        })

        it('应拒绝混合合法和非法模块名', () => {
            expect(() => validateAndSortModules(['summary', 'fake_module', 'chronicle'])).toThrow('无效的分析模块: fake_module')
        })

        it('应接受合法模块名并按固定顺序排列', () => {
            const result = validateAndSortModules(['evidence', 'summary', 'claim'])
            expect(result).toEqual(['summary', 'claim', 'evidence'])
        })

        it('应按固定顺序排列所有7个模块', () => {
            const result = validateAndSortModules(['evidence', 'defense', 'cause', 'trend', 'claim', 'chronicle', 'summary'])
            expect(result).toEqual(['summary', 'chronicle', 'claim', 'trend', 'cause', 'defense', 'evidence'])
        })

        it('应去重模块名', () => {
            const result = validateAndSortModules(['summary', 'summary', 'chronicle'])
            expect(result).toEqual(['summary', 'chronicle'])
        })

        it('单个合法模块应原样返回', () => {
            const result = validateAndSortModules(['trend'])
            expect(result).toEqual(['trend'])
        })
    })

    // ==================== getInitAnalysisStatusService ====================

    describe('getInitAnalysisStatusService - 获取初始化分析状态', () => {
        it('未开始时返回 not_started', async () => {
            const status = await getInitAnalysisStatusService(testCase.id, testUser.id)
            expect(status.status).toBe('not_started')
            expect(status.modules).toEqual([])
            expect(status.sessionId).toBeUndefined()
        })

        it('案件不存在时抛出错误', async () => {
            await expect(
                getInitAnalysisStatusService(999999, testUser.id)
            ).rejects.toThrow('案件不存在')
        })

        it('无权访问时抛出错误', async () => {
            const otherUser = await createTestUser()
            testIds.userIds.push(otherUser.id)

            await expect(
                getInitAnalysisStatusService(testCase.id, otherUser.id)
            ).rejects.toThrow('案件不存在')
        })

        it('进行中时返回 in_progress 和 sessionId', async () => {
            const session = await createTestSession({ caseId: testCase.id, type: 2, status: 1 })
            testIds.sessionIds.push(session.sessionId)

            // 当前 service 逻辑：只有当 session 存在并且至少有一个 agentRun 时，才会返回
            // in_progress；仅有空 session 会被视为 not_started（等待用户在前端选择模块）。
            // 这里创建一条 running 的 agentRun 以复现真正的"进行中"场景。
            const runningRun = await getTestPrisma().agentRuns.create({
                data: {
                    sessionId: session.sessionId,
                    threadId: session.sessionId,
                    userId: testUser.id,
                    caseId: testCase.id,
                    input: { message: 'test' },
                    status: 'running',
                },
            })

            try {
                const status = await getInitAnalysisStatusService(testCase.id, testUser.id)
                expect(status.status).toBe('in_progress')
                expect(status.sessionId).toBe(session.sessionId)
            } finally {
                // cleanup agentRun（sessionIds 清理会级联删除，但显式删除更稳妥）
                await getTestPrisma().agentRuns.delete({ where: { id: runningRun.id } }).catch(() => { /* noop */ })
            }
        })

        it('已完成时返回 completed 及各模块结果', async () => {
            const session = await createTestSession({ caseId: testCase.id, type: 2, status: 2 })
            testIds.sessionIds.push(session.sessionId)

            const node = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(node.id)

            const analysis = await createTestAnalysis({
                caseId: testCase.id,
                sessionId: session.sessionId,
                nodeId: node.id,
                analysisType: 'summary',
                analysisResult: '案件概要内容',
                status: 2,
            })
            testIds.analysisIds.push(analysis.id)

            const status = await getInitAnalysisStatusService(testCase.id, testUser.id)
            expect(status.status).toBe('completed')
            expect(status.sessionId).toBe(session.sessionId)

            const summaryModule = status.modules.find(m => m.name === 'summary')
            expect(summaryModule).toBeDefined()
            expect(summaryModule?.status).toBe('complete')
            expect(summaryModule?.result).toBe('案件概要内容')
        })

        it('失败的 session 返回 failed', async () => {
            const session = await createTestSession({ caseId: testCase.id, type: 2, status: 4 })
            testIds.sessionIds.push(session.sessionId)

            const status = await getInitAnalysisStatusService(testCase.id, testUser.id)
            expect(status.status).toBe('failed')
        })

        it('忽略 type=1 的普通对话 session', async () => {
            const normalSession = await createTestSession({ caseId: testCase.id, type: 1, status: 1 })
            testIds.sessionIds.push(normalSession.sessionId)

            const status = await getInitAnalysisStatusService(testCase.id, testUser.id)
            expect(status.status).toBe('not_started')
        })
    })

    // ==================== loadCompletedResultsService ====================

    describe('loadCompletedResultsService - 加载已完成模块结果', () => {
        it('无结果时返回空对象', async () => {
            const results = await loadCompletedResultsService(testCase.id)
            expect(results).toEqual({})
        })

        it('返回已完成模块的结果', async () => {
            const session = await createTestSession({ caseId: testCase.id, type: 2 })
            testIds.sessionIds.push(session.sessionId)

            const node1 = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(node1.id)
            const node2 = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(node2.id)

            const a1 = await createTestAnalysis({
                caseId: testCase.id,
                sessionId: session.sessionId,
                nodeId: node1.id,
                analysisType: 'summary',
                analysisResult: '概要结果',
                status: 2,
            })
            testIds.analysisIds.push(a1.id)

            const a2 = await createTestAnalysis({
                caseId: testCase.id,
                sessionId: session.sessionId,
                nodeId: node2.id,
                analysisType: 'chronicle',
                analysisResult: '大事记结果',
                status: 2,
            })
            testIds.analysisIds.push(a2.id)

            const results = await loadCompletedResultsService(testCase.id)
            expect(results.summary).toBe('概要结果')
            expect(results.chronicle).toBe('大事记结果')
        })

        it('不包含失败或进行中的模块结果', async () => {
            const session = await createTestSession({ caseId: testCase.id, type: 2 })
            testIds.sessionIds.push(session.sessionId)

            const nodeCompleted = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(nodeCompleted.id)
            const nodeFailed = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(nodeFailed.id)
            const nodeInProgress = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(nodeInProgress.id)

            const a1 = await createTestAnalysis({
                caseId: testCase.id,
                sessionId: session.sessionId,
                nodeId: nodeCompleted.id,
                analysisType: 'summary',
                analysisResult: '完成的结果',
                status: 2,
            })
            testIds.analysisIds.push(a1.id)

            const a2 = await createTestAnalysis({
                caseId: testCase.id,
                sessionId: session.sessionId,
                nodeId: nodeFailed.id,
                analysisType: 'claim',
                analysisResult: '失败的结果',
                status: 3, // FAILED
            })
            testIds.analysisIds.push(a2.id)

            const a3 = await createTestAnalysis({
                caseId: testCase.id,
                sessionId: session.sessionId,
                nodeId: nodeInProgress.id,
                analysisType: 'trend',
                analysisResult: null,
                status: 1, // IN_PROGRESS
            })
            testIds.analysisIds.push(a3.id)

            const results = await loadCompletedResultsService(testCase.id)
            expect(results.summary).toBe('完成的结果')
            expect(results.claim).toBeUndefined()
            expect(results.trend).toBeUndefined()
        })

        it('多版本时返回最新版本的结果', async () => {
            const session1 = await createTestSession({ caseId: testCase.id, type: 2 })
            testIds.sessionIds.push(session1.sessionId)
            const session2 = await createTestSession({ caseId: testCase.id, type: 2 })
            testIds.sessionIds.push(session2.sessionId)

            const node = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(node.id)

            const a1 = await createTestAnalysis({
                caseId: testCase.id,
                sessionId: session1.sessionId,
                nodeId: node.id,
                analysisType: 'summary',
                analysisResult: '旧版本结果',
                status: 2,
                version: 1,
            })
            testIds.analysisIds.push(a1.id)

            const a2 = await createTestAnalysis({
                caseId: testCase.id,
                sessionId: session2.sessionId,
                nodeId: node.id,
                analysisType: 'summary',
                analysisResult: '新版本结果',
                status: 2,
                version: 2,
            })
            testIds.analysisIds.push(a2.id)

            const results = await loadCompletedResultsService(testCase.id)
            expect(results.summary).toBe('新版本结果')
        })
    })
})
