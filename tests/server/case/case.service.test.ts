/**
 * 案件服务层测试
 *
 * **Feature: server-test-coverage**
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import * as fc from 'fast-check'
import './test-setup'
import {
    createTestUser,
    createTestCaseType,
    createTestCase,
    createTestSession,
    createEmptyTestIds,
    cleanupTestData,
    disconnectTestDb,
    type CaseTestIds,
} from './test-db-helper'
import { PBT_CONFIG, caseDataArbitrary } from './test-generators'
import {
    createCaseService,
    getCaseByIdService,
    getCaseBySessionIdService,
    getUserCasesService,
    updateCaseService,
    updateCaseStatusService,
    deleteCaseService,
    checkCaseOwnershipService,
    validateCaseAccessService,
    completeCaseAnalysisService,
    resumeSessionService,
    createNewSessionService,
} from '../../../server/services/case/case.service'
import { CaseStatus, SessionStatus } from '../../../shared/types/case'

describe('案件服务层', () => {
    let testIds: CaseTestIds
    let testUser: Awaited<ReturnType<typeof createTestUser>>
    let testCaseType: Awaited<ReturnType<typeof createTestCaseType>>

    beforeAll(async () => {
        testIds = createEmptyTestIds()
        testUser = await createTestUser()
        testIds.userIds.push(testUser.id)
        testCaseType = await createTestCaseType({ status: 1 })
        testIds.caseTypeIds.push(testCaseType.id)
    })

    afterEach(async () => {
        const caseIdsToClean = [...testIds.caseIds]
        const sessionIdsToClean = [...testIds.sessionIds]

        if (sessionIdsToClean.length > 0 || caseIdsToClean.length > 0) {
            await cleanupTestData({
                ...createEmptyTestIds(),
                caseIds: caseIdsToClean,
                sessionIds: sessionIdsToClean,
            })
        }

        testIds.caseIds = []
        testIds.sessionIds = []
    })

    afterAll(async () => {
        await cleanupTestData(testIds)
        await disconnectTestDb()
    })


    describe('createCaseService - 创建案件', () => {
        it('应该成功创建案件并返回 sessionId', async () => {
            const result = await createCaseService({
                title: '测试案件_服务层创建',
                content: '测试内容',
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })

            testIds.caseIds.push(result.caseId)
            testIds.sessionIds.push(result.sessionId)

            expect(result.caseId).toBeGreaterThan(0)
            expect(result.sessionId).toBeDefined()
            expect(result.sessionId.length).toBeGreaterThan(0)
            expect(result.case).toBeDefined()
            expect(result.session).toBeDefined()
        })

        it('应该在案件类型不存在时抛出错误', async () => {
            await expect(
                createCaseService({
                    title: '测试案件_无效类型',
                    content: '测试内容',
                    userId: testUser.id,
                    caseTypeId: 999999,
                })
            ).rejects.toThrow('案件类型不存在')
        })

        it('应该在案件类型禁用时抛出错误', async () => {
            const disabledType = await createTestCaseType({ status: 0 })
            testIds.caseTypeIds.push(disabledType.id)

            await expect(
                createCaseService({
                    title: '测试案件_禁用类型',
                    content: '测试内容',
                    userId: testUser.id,
                    caseTypeId: disabledType.id,
                })
            ).rejects.toThrow('案件类型已禁用')
        })
    })

    describe('getCaseByIdService - 获取案件详情', () => {
        it('应该返回存在的案件', async () => {
            const created = await createCaseService({
                title: '测试案件_获取详情',
                content: '测试内容',
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(created.caseId)
            testIds.sessionIds.push(created.sessionId)

            const found = await getCaseByIdService(created.caseId)

            expect(found).toBeDefined()
            expect(found?.id).toBe(created.caseId)
            expect(found?.caseType).toBeDefined()
        })

        it('应该返回 null 当案件不存在', async () => {
            const found = await getCaseByIdService(999999)
            expect(found).toBeNull()
        })
    })

    describe('getCaseBySessionIdService - 通过会话 ID 获取案件', () => {
        it('应该返回会话关联的案件', async () => {
            const created = await createCaseService({
                title: '测试案件_会话查询',
                content: '测试内容',
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(created.caseId)
            testIds.sessionIds.push(created.sessionId)

            const found = await getCaseBySessionIdService(created.sessionId)

            expect(found).toBeDefined()
            expect(found?.id).toBe(created.caseId)
        })
    })

    describe('getUserCasesService - 获取用户案件列表', () => {
        it('应该返回用户的案件列表', async () => {
            const created = await createCaseService({
                title: '测试案件_用户列表',
                content: '测试内容',
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(created.caseId)
            testIds.sessionIds.push(created.sessionId)

            const result = await getUserCasesService(testUser.id)

            expect(result.list).toBeDefined()
            expect(result.total).toBeGreaterThanOrEqual(1)
            expect(result.list.some(c => c.id === created.caseId)).toBe(true)
        })

        it('应该支持分页', async () => {
            // 创建多个案件
            for (let i = 0; i < 3; i++) {
                const created = await createCaseService({
                    title: `测试案件_分页测试_${i}`,
                    content: '测试内容',
                    userId: testUser.id,
                    caseTypeId: testCaseType.id,
                })
                testIds.caseIds.push(created.caseId)
                testIds.sessionIds.push(created.sessionId)
            }

            const page1 = await getUserCasesService(testUser.id, { page: 1, pageSize: 2 })
            expect(page1.list.length).toBeLessThanOrEqual(2)
        })
    })


    describe('updateCaseService - 更新案件', () => {
        it('应该成功更新案件', async () => {
            const created = await createCaseService({
                title: '测试案件_更新前',
                content: '测试内容',
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(created.caseId)
            testIds.sessionIds.push(created.sessionId)

            const updated = await updateCaseService(created.caseId, {
                title: '测试案件_更新后',
            })

            expect(updated.title).toBe('测试案件_更新后')
        })

        it('应该在案件不存在时抛出错误', async () => {
            await expect(
                updateCaseService(999999, { title: '测试' })
            ).rejects.toThrow('案件不存在')
        })

        it('应该在更新为无效案件类型时抛出错误', async () => {
            const created = await createCaseService({
                title: '测试案件_类型更新',
                content: '测试内容',
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(created.caseId)
            testIds.sessionIds.push(created.sessionId)

            await expect(
                updateCaseService(created.caseId, { caseTypeId: 999999 })
            ).rejects.toThrow('案件类型不存在')
        })
    })

    describe('updateCaseStatusService - 更新案件状态', () => {
        it('应该成功更新案件状态', async () => {
            const created = await createCaseService({
                title: '测试案件_状态更新',
                content: '测试内容',
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(created.caseId)
            testIds.sessionIds.push(created.sessionId)

            const updated = await updateCaseStatusService(created.caseId, CaseStatus.COMPLETED)

            expect(updated.status).toBe(CaseStatus.COMPLETED)
        })
    })

    describe('deleteCaseService - 删除案件', () => {
        it('应该成功软删除案件', async () => {
            const created = await createCaseService({
                title: '测试案件_删除测试',
                content: '测试内容',
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(created.caseId)
            testIds.sessionIds.push(created.sessionId)

            await deleteCaseService(created.caseId)

            const found = await getCaseByIdService(created.caseId)
            expect(found).toBeNull()
        })

        it('应该在案件不存在时抛出错误', async () => {
            await expect(deleteCaseService(999999)).rejects.toThrow('案件不存在')
        })
    })

    describe('checkCaseOwnershipService - 检查案件所有权', () => {
        it('应该返回 true 当用户拥有案件', async () => {
            const created = await createCaseService({
                title: '测试案件_所有权检查',
                content: '测试内容',
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(created.caseId)
            testIds.sessionIds.push(created.sessionId)

            const isOwner = await checkCaseOwnershipService(created.caseId, testUser.id)
            expect(isOwner).toBe(true)
        })

        it('应该返回 false 当用户不拥有案件', async () => {
            const anotherUser = await createTestUser()
            testIds.userIds.push(anotherUser.id)

            const created = await createCaseService({
                title: '测试案件_非所有者',
                content: '测试内容',
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(created.caseId)
            testIds.sessionIds.push(created.sessionId)

            const isOwner = await checkCaseOwnershipService(created.caseId, anotherUser.id)
            expect(isOwner).toBe(false)
        })
    })

    describe('validateCaseAccessService - 验证案件访问权限', () => {
        it('应该在用户有权限时不抛出错误', async () => {
            const created = await createCaseService({
                title: '测试案件_权限验证',
                content: '测试内容',
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(created.caseId)
            testIds.sessionIds.push(created.sessionId)

            await expect(
                validateCaseAccessService(created.caseId, testUser.id)
            ).resolves.not.toThrow()
        })

        it('应该在用户无权限时抛出错误', async () => {
            const anotherUser = await createTestUser()
            testIds.userIds.push(anotherUser.id)

            const created = await createCaseService({
                title: '测试案件_无权限',
                content: '测试内容',
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(created.caseId)
            testIds.sessionIds.push(created.sessionId)

            await expect(
                validateCaseAccessService(created.caseId, anotherUser.id)
            ).rejects.toThrow('无权访问该案件')
        })
    })


    describe('completeCaseAnalysisService - 完成案件分析', () => {
        it('应该同时更新案件和会话状态为已完成', async () => {
            const created = await createCaseService({
                title: '测试案件_完成分析',
                content: '测试内容',
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(created.caseId)
            testIds.sessionIds.push(created.sessionId)

            await completeCaseAnalysisService(created.caseId, created.sessionId)

            const caseRecord = await getCaseByIdService(created.caseId)
            expect(caseRecord?.status).toBe(CaseStatus.COMPLETED)

            // 验证会话状态
            const caseWithSession = await getCaseByIdService(created.caseId, true)
            const session = caseWithSession?.caseSessions?.find(s => s.sessionId === created.sessionId)
            expect(session?.status).toBe(SessionStatus.COMPLETED)
        })
    })

    describe('resumeSessionService - 恢复会话', () => {
        it('应该成功恢复中断状态的会话', async () => {
            const created = await createCaseService({
                title: '测试案件_恢复会话',
                content: '测试内容',
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(created.caseId)
            testIds.sessionIds.push(created.sessionId)

            // 先将会话设为中断状态
            const { updateSessionStatusDao } = await import('../../../server/services/case/case.dao')
            await updateSessionStatusDao(created.sessionId, SessionStatus.INTERRUPTED)

            const resumed = await resumeSessionService(created.sessionId)
            expect(resumed.status).toBe(SessionStatus.IN_PROGRESS)
        })

        it('应该在会话不存在时抛出错误', async () => {
            await expect(
                resumeSessionService('non_existent_session')
            ).rejects.toThrow('会话不存在')
        })

        it('应该在会话状态不是中断或失败时抛出错误', async () => {
            const created = await createCaseService({
                title: '测试案件_无法恢复',
                content: '测试内容',
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(created.caseId)
            testIds.sessionIds.push(created.sessionId)

            await expect(
                resumeSessionService(created.sessionId)
            ).rejects.toThrow('只有中断或失败状态的会话可以恢复')
        })
    })

    describe('createNewSessionService - 创建新会话', () => {
        it('应该为案件创建新会话', async () => {
            const created = await createCaseService({
                title: '测试案件_新会话',
                content: '测试内容',
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(created.caseId)
            testIds.sessionIds.push(created.sessionId)

            const newSession = await createNewSessionService(created.caseId)
            testIds.sessionIds.push(newSession.sessionId)

            expect(newSession.sessionId).toBeDefined()
            expect(newSession.sessionId).not.toBe(created.sessionId)
            expect(newSession.caseId).toBe(created.caseId)
            expect(newSession.status).toBe(SessionStatus.IN_PROGRESS)
        })

        it('应该在案件不存在时抛出错误', async () => {
            await expect(createNewSessionService(999999)).rejects.toThrow('案件不存在')
        })
    })

    // ==================== 属性测试 ====================

    describe('属性测试', () => {
        describe('Property 3: 案件所有权检查正确性', () => {
            it('所有权检查应正确返回：创建者返回 true，非创建者返回 false', async () => {
                const anotherUser = await createTestUser()
                testIds.userIds.push(anotherUser.id)

                await fc.assert(
                    fc.asyncProperty(caseDataArbitrary, async (caseData) => {
                        const created = await createCaseService({
                            title: caseData.title,
                            content: caseData.content,
                            userId: testUser.id,
                            caseTypeId: testCaseType.id,
                        })
                        testIds.caseIds.push(created.caseId)
                        testIds.sessionIds.push(created.sessionId)

                        // 创建者应该拥有案件
                        const ownerCheck = await checkCaseOwnershipService(created.caseId, testUser.id)
                        expect(ownerCheck).toBe(true)

                        // 非创建者不应该拥有案件
                        const nonOwnerCheck = await checkCaseOwnershipService(created.caseId, anotherUser.id)
                        expect(nonOwnerCheck).toBe(false)

                        return true
                    }),
                    PBT_CONFIG
                )
            })
        })
    })
})
