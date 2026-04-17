/**
 * 初始化分析服务层 - 覆盖率缺口补充测试
 *
 * 覆盖目标（相对 initAnalysis.service.ts）：
 * 1. 第 97 行：传入 sessionId 但所有 sessions 都不是 type=2（只有 type=3 模块对话），回退仍找不到 → 返回 not_started
 * 2. 第 131 行：primarySession 从未有 run 且 status=1（刚通过 init-session 创建的空 session） → 返回 not_started
 * 3. 第 147-158 行：防御性状态修正 —— session.status=1 但无活跃 run/无 interrupt，selectedModules 全部达到终态时自动修复为 completed
 *
 * **Feature: case-init-analysis**
 * **Validates: getInitAnalysisStatusService 边缘分支**
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

import { getInitAnalysisStatusService } from '../../../server/services/case/initAnalysis.service'

describe('初始化分析服务层 - 覆盖率缺口补充', () => {
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

    /** 用例间清理 agentRuns / analyses / sessions / nodes，避免互相干扰 */
    afterEach(async () => {
        if (testIds.sessionIds.length > 0) {
            await getTestPrisma().agentRuns.deleteMany({
                where: { sessionId: { in: testIds.sessionIds } },
            })
        }
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

    // ==================== 第 97 行分支：sessionId 不匹配任何 type=2 session ====================

    describe('传入 sessionId 但全部 sessions 都不是 type=2', () => {
        it('应返回 not_started 并原样回传传入的 sessionId（附带跨 session 聚合 modules/result）', async () => {
            // 只创建一条 type=3（模块对话）session —— getInitAnalysisStatusService 内部
            // sessions.find(s => s.type === 2) 会返回 undefined，进入 97 行分支
            const type3Session = await createTestSession({
                caseId: testCase.id,
                type: 3,
                status: 1,
            })
            testIds.sessionIds.push(type3Session.sessionId)

            // 可选：在 type=3 session 上构造一条已完成的分析结果，
            // 验证 97 行返回的 result 仍然来自跨 session 聚合（buildResultMap）
            const node = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(node.id)
            const analysis = await createTestAnalysis({
                caseId: testCase.id,
                sessionId: type3Session.sessionId,
                nodeId: node.id,
                analysisType: 'summary',
                analysisResult: '跨 session 聚合的概要',
                status: 2,
                isActive: true,
            })
            testIds.analysisIds.push(analysis.id)

            // 传入一个不匹配任何 type=2 session 的 sessionId
            const unmatchedSessionId = 'nonexistent-session-id-for-type2-fallback'
            const status = await getInitAnalysisStatusService(
                testCase.id,
                testUser.id,
                unmatchedSessionId,
            )

            expect(status.status).toBe('not_started')
            expect(status.sessionId).toBe(unmatchedSessionId)
            expect(status.hasPendingInterrupt).toBe(false)
            expect(status.modules).toHaveLength(7)
            expect(status.result?.summary).toBe('跨 session 聚合的概要')
            const summaryModule = status.modules.find(m => m.name === 'summary')
            expect(summaryModule?.status).toBe('complete')
            expect(summaryModule?.result).toBe('跨 session 聚合的概要')
        })
    })

    // ==================== 第 131 行分支：primarySession 从未有 run 且 status=1 ====================

    describe('primarySession 从未创建任何 agentRun', () => {
        it('应返回 not_started 并在 sessionId 中回传 primarySession.sessionId', async () => {
            // 创建一条空 type=2 session：status=1 且没有任何 agentRun
            const emptySession = await createTestSession({
                caseId: testCase.id,
                type: 2,
                status: 1,
            })
            testIds.sessionIds.push(emptySession.sessionId)

            // 不创建 agentRun，从而触发 131 行分支
            const status = await getInitAnalysisStatusService(testCase.id, testUser.id)

            expect(status.status).toBe('not_started')
            expect(status.sessionId).toBe(emptySession.sessionId)
            expect(status.hasPendingInterrupt).toBe(false)
            expect(status.modules).toHaveLength(7)
            // 未开始时 result 应为空对象
            expect(status.result).toEqual({})
        })

        it('同样的场景下传入 sessionId 参数仍应触发 not_started 短路', async () => {
            const emptySession = await createTestSession({
                caseId: testCase.id,
                type: 2,
                status: 1,
            })
            testIds.sessionIds.push(emptySession.sessionId)

            const status = await getInitAnalysisStatusService(
                testCase.id,
                testUser.id,
                emptySession.sessionId,
            )

            expect(status.status).toBe('not_started')
            expect(status.sessionId).toBe(emptySession.sessionId)
        })
    })

    // ==================== 第 147-158 行分支：防御性状态修正 ====================

    describe('防御性状态修正 - session.status=1 但 selectedModules 全部终态', () => {
        it('应自动把 session.status 修正为 2 并返回 completed', async () => {
            // primarySession：status=1，metadata 包含 selectedModules
            const primarySession = await getTestPrisma().caseSessions.create({
                data: {
                    sessionId: `self-heal-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    caseId: testCase.id,
                    type: 2,
                    status: 1,
                    metadata: { selectedModules: ['summary', 'chronicle'] },
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testIds.sessionIds.push(primarySession.sessionId)

            // 创建节点和两个 analyses：一个 complete(2)、一个 failed(3)
            const node1 = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(node1.id)
            const node2 = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(node2.id)

            const a1 = await createTestAnalysis({
                caseId: testCase.id,
                sessionId: primarySession.sessionId,
                nodeId: node1.id,
                analysisType: 'summary',
                analysisResult: '概要内容',
                status: 2,
            })
            testIds.analysisIds.push(a1.id)

            const a2 = await createTestAnalysis({
                caseId: testCase.id,
                sessionId: primarySession.sessionId,
                nodeId: node2.id,
                analysisType: 'chronicle',
                analysisResult: null,
                status: 3, // FAILED
            })
            testIds.analysisIds.push(a2.id)

            // 需要有至少一条非活跃、非 interrupt 的 agentRun，
            // 避免走 "primarySession 从未有 run" 的 131 行短路
            const completedRun = await getTestPrisma().agentRuns.create({
                data: {
                    sessionId: primarySession.sessionId,
                    threadId: primarySession.sessionId,
                    userId: testUser.id,
                    caseId: testCase.id,
                    input: { message: 'x' },
                    status: 'completed',
                },
            })

            try {
                const status = await getInitAnalysisStatusService(testCase.id, testUser.id)

                expect(status.status).toBe('completed')
                expect(status.sessionId).toBe(primarySession.sessionId)
                expect(status.selectedModules).toEqual(['summary', 'chronicle'])

                // 验证数据库里 status 已被修正为 2
                const reloaded = await getTestPrisma().caseSessions.findUnique({
                    where: { sessionId: primarySession.sessionId },
                })
                expect(reloaded!.status).toBe(2)
            } finally {
                await getTestPrisma().agentRuns.delete({ where: { id: completedRun.id } }).catch(() => { /* noop */ })
            }
        })

        it('selectedModules 未全部终态时不应触发自动修复（仍返回 in_progress）', async () => {
            const primarySession = await getTestPrisma().caseSessions.create({
                data: {
                    sessionId: `no-heal-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    caseId: testCase.id,
                    type: 2,
                    status: 1,
                    // 声明选中 2 个模块，但只完成 1 个
                    metadata: { selectedModules: ['summary', 'chronicle'] },
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testIds.sessionIds.push(primarySession.sessionId)

            const node1 = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(node1.id)

            // 只为 summary 创建完成记录，chronicle 处于 idle（无记录）状态
            const a1 = await createTestAnalysis({
                caseId: testCase.id,
                sessionId: primarySession.sessionId,
                nodeId: node1.id,
                analysisType: 'summary',
                analysisResult: '概要内容',
                status: 2,
            })
            testIds.analysisIds.push(a1.id)

            const completedRun = await getTestPrisma().agentRuns.create({
                data: {
                    sessionId: primarySession.sessionId,
                    threadId: primarySession.sessionId,
                    userId: testUser.id,
                    caseId: testCase.id,
                    input: { message: 'x' },
                    status: 'completed',
                },
            })

            try {
                const status = await getInitAnalysisStatusService(testCase.id, testUser.id)

                // chronicle 仍处于 idle，未全部终态 → 不自动修复
                expect(status.status).toBe('in_progress')

                const reloaded = await getTestPrisma().caseSessions.findUnique({
                    where: { sessionId: primarySession.sessionId },
                })
                expect(reloaded!.status).toBe(1)
            } finally {
                await getTestPrisma().agentRuns.delete({ where: { id: completedRun.id } }).catch(() => { /* noop */ })
            }
        })

        it('有活跃 run 时不应触发自动修复', async () => {
            const primarySession = await getTestPrisma().caseSessions.create({
                data: {
                    sessionId: `active-run-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    caseId: testCase.id,
                    type: 2,
                    status: 1,
                    metadata: { selectedModules: ['summary'] },
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testIds.sessionIds.push(primarySession.sessionId)

            const node = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(node.id)
            const a1 = await createTestAnalysis({
                caseId: testCase.id,
                sessionId: primarySession.sessionId,
                nodeId: node.id,
                analysisType: 'summary',
                analysisResult: '概要内容',
                status: 2,
            })
            testIds.analysisIds.push(a1.id)

            const runningRun = await getTestPrisma().agentRuns.create({
                data: {
                    sessionId: primarySession.sessionId,
                    threadId: primarySession.sessionId,
                    userId: testUser.id,
                    caseId: testCase.id,
                    input: { message: 'x' },
                    status: 'running',
                },
            })

            try {
                const status = await getInitAnalysisStatusService(testCase.id, testUser.id)
                // 存在活跃 run → 不进入自动修复分支
                expect(status.status).toBe('in_progress')
            } finally {
                await getTestPrisma().agentRuns.delete({ where: { id: runningRun.id } }).catch(() => { /* noop */ })
            }
        })

        it('存在 interrupted run 时不应触发自动修复（应返回 in_progress 且 hasPendingInterrupt=true）', async () => {
            const primarySession = await getTestPrisma().caseSessions.create({
                data: {
                    sessionId: `interrupted-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    caseId: testCase.id,
                    type: 2,
                    status: 1,
                    metadata: { selectedModules: ['summary'] },
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testIds.sessionIds.push(primarySession.sessionId)

            const node = await createTestNode({ modelId: testModel.id })
            testIds.nodeIds.push(node.id)
            const a1 = await createTestAnalysis({
                caseId: testCase.id,
                sessionId: primarySession.sessionId,
                nodeId: node.id,
                analysisType: 'summary',
                analysisResult: '概要内容',
                status: 2,
            })
            testIds.analysisIds.push(a1.id)

            const interruptedRun = await getTestPrisma().agentRuns.create({
                data: {
                    sessionId: primarySession.sessionId,
                    threadId: primarySession.sessionId,
                    userId: testUser.id,
                    caseId: testCase.id,
                    input: { message: 'x' },
                    status: 'interrupted',
                },
            })

            try {
                const status = await getInitAnalysisStatusService(testCase.id, testUser.id)
                expect(status.status).toBe('in_progress')
                expect(status.hasPendingInterrupt).toBe(true)
            } finally {
                await getTestPrisma().agentRuns.delete({ where: { id: interruptedRun.id } }).catch(() => { /* noop */ })
            }
        })
    })
})
