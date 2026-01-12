/**
 * 案件 DAO 层测试
 *
 * **Feature: server-test-coverage**
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**
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
import { PBT_CONFIG, caseDataArbitrary, caseListParamsArb, filterUndefined } from './test-generators'
import {
    createCaseDao,
    createSessionDao,
    findCaseByIdDao,
    findCaseBySessionIdDao,
    findManyCasesDao,
    updateCaseDao,
    updateSessionStatusDao,
    softDeleteCaseDao,
    checkCaseOwnershipDao,
} from '../../../server/services/case/case.dao'
import { CaseStatus, SessionStatus } from '../../../shared/types/case'

describe('案件 DAO 层', () => {
    let testIds: CaseTestIds
    let testUser: Awaited<ReturnType<typeof createTestUser>>
    let testCaseType: Awaited<ReturnType<typeof createTestCaseType>>

    beforeAll(async () => {
        testIds = createEmptyTestIds()
        // 创建测试用户和案件类型
        testUser = await createTestUser()
        testIds.userIds.push(testUser.id)
        testCaseType = await createTestCaseType({ status: 1 })
        testIds.caseTypeIds.push(testCaseType.id)
    })

    afterEach(async () => {
        // 清理每个测试创建的案件和会话
        const caseIdsToClean = [...testIds.caseIds]
        const sessionIdsToClean = [...testIds.sessionIds]

        if (sessionIdsToClean.length > 0 || caseIdsToClean.length > 0) {
            await cleanupTestData({
                ...createEmptyTestIds(),
                caseIds: caseIdsToClean,
                sessionIds: sessionIdsToClean,
            })
        }

        // 重置追踪（保留用户和案件类型）
        testIds.caseIds = []
        testIds.sessionIds = []
    })

    afterAll(async () => {
        await cleanupTestData(testIds)
        await disconnectTestDb()
    })

    describe('createCaseDao - 创建案件', () => {
        it('应该成功创建案件', async () => {
            const caseRecord = await createCaseDao({
                title: '测试案件_创建测试',
                content: '测试内容',
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })

            testIds.caseIds.push(caseRecord.id)

            expect(caseRecord).toBeDefined()
            expect(caseRecord.id).toBeGreaterThan(0)
            expect(caseRecord.title).toBe('测试案件_创建测试')
            expect(caseRecord.userId).toBe(testUser.id)
            expect(caseRecord.caseTypeId).toBe(testCaseType.id)
            expect(caseRecord.status).toBe(CaseStatus.IN_PROGRESS)
            expect(caseRecord.deletedAt).toBeNull()
        })

        it('应该支持创建带原告被告信息的案件', async () => {
            const plaintiff = [{ name: '原告A', type: 'individual' }]
            const defendant = [{ name: '被告B', type: 'company' }]

            const caseRecord = await createCaseDao({
                title: '测试案件_当事人测试',
                content: '测试内容',
                userId: testUser.id,
                caseTypeId: testCaseType.id,
                plaintiff,
                defendant,
            })

            testIds.caseIds.push(caseRecord.id)

            expect(caseRecord.plaintiff).toEqual(plaintiff)
            expect(caseRecord.defendant).toEqual(defendant)
        })

        it('应该支持创建演示案件', async () => {
            const caseRecord = await createCaseDao({
                title: '测试案件_演示案件',
                content: '演示内容',
                userId: testUser.id,
                caseTypeId: testCaseType.id,
                isDemo: true,
            })

            testIds.caseIds.push(caseRecord.id)

            expect(caseRecord.isDemo).toBe(true)
        })
    })

    describe('createSessionDao - 创建会话', () => {
        it('应该成功创建会话', async () => {
            const caseRecord = await createTestCase({
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(caseRecord.id)

            const session = await createSessionDao({
                sessionId: `test_session_${Date.now()}`,
                caseId: caseRecord.id,
            })
            testIds.sessionIds.push(session.sessionId)

            expect(session).toBeDefined()
            expect(session.caseId).toBe(caseRecord.id)
            expect(session.status).toBe(SessionStatus.IN_PROGRESS)
        })

        it('应该支持指定会话状态', async () => {
            const caseRecord = await createTestCase({
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(caseRecord.id)

            const session = await createSessionDao({
                sessionId: `test_session_completed_${Date.now()}`,
                caseId: caseRecord.id,
                status: SessionStatus.COMPLETED,
            })
            testIds.sessionIds.push(session.sessionId)

            expect(session.status).toBe(SessionStatus.COMPLETED)
        })
    })

    describe('findCaseByIdDao - 通过 ID 查询案件', () => {
        it('应该返回存在的案件', async () => {
            const caseRecord = await createTestCase({
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(caseRecord.id)

            const found = await findCaseByIdDao(caseRecord.id)

            expect(found).toBeDefined()
            expect(found?.id).toBe(caseRecord.id)
        })

        it('应该返回 null 当案件不存在', async () => {
            const found = await findCaseByIdDao(999999)
            expect(found).toBeNull()
        })

        it('应该支持包含关联数据', async () => {
            const caseRecord = await createTestCase({
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(caseRecord.id)

            const session = await createTestSession({ caseId: caseRecord.id })
            testIds.sessionIds.push(session.sessionId)

            const found = await findCaseByIdDao(caseRecord.id, true)

            expect(found).toBeDefined()
            expect(found?.caseType).toBeDefined()
            expect(found?.caseType?.id).toBe(testCaseType.id)
            expect(found?.caseSessions).toBeDefined()
            expect(found?.caseSessions?.length).toBeGreaterThan(0)
        })
    })

    describe('findCaseBySessionIdDao - 通过会话 ID 查询案件', () => {
        it('应该返回会话关联的案件', async () => {
            const caseRecord = await createTestCase({
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(caseRecord.id)

            const session = await createTestSession({ caseId: caseRecord.id })
            testIds.sessionIds.push(session.sessionId)

            const found = await findCaseBySessionIdDao(session.sessionId)

            expect(found).toBeDefined()
            expect(found?.id).toBe(caseRecord.id)
            expect(found?.caseSessions).toBeDefined()
        })

        it('应该返回 null 当会话不存在', async () => {
            const found = await findCaseBySessionIdDao('non_existent_session')
            expect(found).toBeNull()
        })
    })

    describe('findManyCasesDao - 查询案件列表', () => {
        it('应该返回分页的案件列表', async () => {
            // 创建多个测试案件
            for (let i = 0; i < 3; i++) {
                const c = await createTestCase({
                    title: `测试案件_列表测试_${i}`,
                    userId: testUser.id,
                    caseTypeId: testCaseType.id,
                })
                testIds.caseIds.push(c.id)
            }

            const result = await findManyCasesDao({
                userId: testUser.id,
                page: 1,
                pageSize: 10,
            })

            expect(result.list).toBeDefined()
            expect(result.total).toBeGreaterThanOrEqual(3)
        })

        it('应该支持按用户 ID 筛选', async () => {
            const anotherUser = await createTestUser()
            testIds.userIds.push(anotherUser.id)

            const c1 = await createTestCase({
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(c1.id)

            const c2 = await createTestCase({
                userId: anotherUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(c2.id)

            const result = await findManyCasesDao({ userId: testUser.id })

            expect(result.list.every(c => c.userId === testUser.id)).toBe(true)
        })

        it('应该支持按状态筛选', async () => {
            const c1 = await createTestCase({
                userId: testUser.id,
                caseTypeId: testCaseType.id,
                status: CaseStatus.IN_PROGRESS,
            })
            testIds.caseIds.push(c1.id)

            const c2 = await createTestCase({
                userId: testUser.id,
                caseTypeId: testCaseType.id,
                status: CaseStatus.COMPLETED,
            })
            testIds.caseIds.push(c2.id)

            const result = await findManyCasesDao({
                userId: testUser.id,
                status: CaseStatus.COMPLETED,
            })

            expect(result.list.every(c => c.status === CaseStatus.COMPLETED)).toBe(true)
        })

        it('应该支持关键词搜索', async () => {
            const uniqueKeyword = `唯一关键词_${Date.now()}`
            const c = await createTestCase({
                title: `测试案件_${uniqueKeyword}`,
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(c.id)

            const result = await findManyCasesDao({
                keyword: uniqueKeyword,
            })

            expect(result.list.length).toBeGreaterThanOrEqual(1)
            expect(result.list.some(c => c.title.includes(uniqueKeyword))).toBe(true)
        })

        it('应该自动过滤已删除的案件', async () => {
            const c = await createTestCase({
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(c.id)

            await softDeleteCaseDao(c.id)

            const result = await findManyCasesDao({ userId: testUser.id })

            expect(result.list.every(item => item.id !== c.id)).toBe(true)
        })
    })

    describe('updateCaseDao - 更新案件', () => {
        it('应该成功更新案件标题', async () => {
            const caseRecord = await createTestCase({
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(caseRecord.id)

            const newTitle = '测试案件_更新后标题'
            const updated = await updateCaseDao(caseRecord.id, { title: newTitle })

            expect(updated.title).toBe(newTitle)
        })

        it('应该成功更新案件状态', async () => {
            const caseRecord = await createTestCase({
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(caseRecord.id)

            const updated = await updateCaseDao(caseRecord.id, { status: CaseStatus.COMPLETED })

            expect(updated.status).toBe(CaseStatus.COMPLETED)
        })

        it('应该更新 updatedAt 时间戳', async () => {
            const caseRecord = await createTestCase({
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(caseRecord.id)

            const originalUpdatedAt = caseRecord.updatedAt

            // 等待一小段时间确保时间戳不同
            await new Promise(resolve => setTimeout(resolve, 10))

            const updated = await updateCaseDao(caseRecord.id, { title: '测试案件_时间戳测试' })

            expect(updated.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime())
        })
    })

    describe('updateSessionStatusDao - 更新会话状态', () => {
        it('应该成功更新会话状态', async () => {
            const caseRecord = await createTestCase({
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(caseRecord.id)

            const session = await createTestSession({ caseId: caseRecord.id })
            testIds.sessionIds.push(session.sessionId)

            const updated = await updateSessionStatusDao(session.sessionId, SessionStatus.COMPLETED)

            expect(updated.status).toBe(SessionStatus.COMPLETED)
        })
    })

    describe('softDeleteCaseDao - 软删除案件', () => {
        it('应该成功软删除案件', async () => {
            const caseRecord = await createTestCase({
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(caseRecord.id)

            await softDeleteCaseDao(caseRecord.id)

            const found = await findCaseByIdDao(caseRecord.id)
            expect(found).toBeNull()
        })

        it('应该同时软删除关联的会话', async () => {
            const caseRecord = await createTestCase({
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(caseRecord.id)

            const session = await createTestSession({ caseId: caseRecord.id })
            testIds.sessionIds.push(session.sessionId)

            await softDeleteCaseDao(caseRecord.id)

            const foundCase = await findCaseBySessionIdDao(session.sessionId)
            expect(foundCase).toBeNull()
        })
    })

    describe('checkCaseOwnershipDao - 检查案件所有权', () => {
        it('应该返回 true 当用户拥有案件', async () => {
            const caseRecord = await createTestCase({
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(caseRecord.id)

            const isOwner = await checkCaseOwnershipDao(caseRecord.id, testUser.id)
            expect(isOwner).toBe(true)
        })

        it('应该返回 false 当用户不拥有案件', async () => {
            const anotherUser = await createTestUser()
            testIds.userIds.push(anotherUser.id)

            const caseRecord = await createTestCase({
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(caseRecord.id)

            const isOwner = await checkCaseOwnershipDao(caseRecord.id, anotherUser.id)
            expect(isOwner).toBe(false)
        })

        it('应该返回 false 当案件已删除', async () => {
            const caseRecord = await createTestCase({
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(caseRecord.id)

            await softDeleteCaseDao(caseRecord.id)

            const isOwner = await checkCaseOwnershipDao(caseRecord.id, testUser.id)
            expect(isOwner).toBe(false)
        })
    })

    // ==================== 属性测试 ====================

    describe('属性测试', () => {
        describe('Property 1: 案件创建-查询往返一致性', () => {
            it('创建案件后通过 ID 查询应返回等价的案件数据', async () => {
                await fc.assert(
                    fc.asyncProperty(caseDataArbitrary, async (caseData) => {
                        const caseRecord = await createCaseDao({
                            title: caseData.title,
                            content: caseData.content,
                            userId: testUser.id,
                            caseTypeId: testCaseType.id,
                            plaintiff: caseData.plaintiff,
                            defendant: caseData.defendant,
                            isDemo: caseData.isDemo,
                        })
                        testIds.caseIds.push(caseRecord.id)

                        const found = await findCaseByIdDao(caseRecord.id, true)

                        expect(found).not.toBeNull()
                        expect(found?.title).toBe(caseData.title)
                        expect(found?.content).toBe(caseData.content)
                        expect(found?.userId).toBe(testUser.id)
                        expect(found?.caseTypeId).toBe(testCaseType.id)
                        expect(found?.isDemo).toBe(caseData.isDemo)
                        expect(found?.caseType?.id).toBe(testCaseType.id)

                        return true
                    }),
                    PBT_CONFIG
                )
            })
        })

        describe('Property 2: 案件软删除过滤正确性', () => {
            it('软删除后所有查询操作应自动过滤该记录', async () => {
                await fc.assert(
                    fc.asyncProperty(caseDataArbitrary, async (caseData) => {
                        const caseRecord = await createCaseDao({
                            title: caseData.title,
                            content: caseData.content,
                            userId: testUser.id,
                            caseTypeId: testCaseType.id,
                        })
                        testIds.caseIds.push(caseRecord.id)

                        // 软删除
                        await softDeleteCaseDao(caseRecord.id)

                        // 验证各种查询都不返回该记录
                        const byId = await findCaseByIdDao(caseRecord.id)
                        expect(byId).toBeNull()

                        const list = await findManyCasesDao({ userId: testUser.id })
                        expect(list.list.every(c => c.id !== caseRecord.id)).toBe(true)

                        const ownership = await checkCaseOwnershipDao(caseRecord.id, testUser.id)
                        expect(ownership).toBe(false)

                        return true
                    }),
                    PBT_CONFIG
                )
            })
        })

        describe('Property 3: 案件所有权检查正确性', () => {
            it('所有权检查应正确返回：创建者返回 true，非创建者返回 false', async () => {
                const anotherUser = await createTestUser()
                testIds.userIds.push(anotherUser.id)

                await fc.assert(
                    fc.asyncProperty(caseDataArbitrary, async (caseData) => {
                        const caseRecord = await createCaseDao({
                            title: caseData.title,
                            content: caseData.content,
                            userId: testUser.id,
                            caseTypeId: testCaseType.id,
                        })
                        testIds.caseIds.push(caseRecord.id)

                        // 创建者应该拥有案件
                        const ownerCheck = await checkCaseOwnershipDao(caseRecord.id, testUser.id)
                        expect(ownerCheck).toBe(true)

                        // 非创建者不应该拥有案件
                        const nonOwnerCheck = await checkCaseOwnershipDao(caseRecord.id, anotherUser.id)
                        expect(nonOwnerCheck).toBe(false)

                        return true
                    }),
                    PBT_CONFIG
                )
            })
        })

        describe('Property 4: 案件列表筛选正确性', () => {
            it('返回的案件列表应只包含满足所有条件的记录', async () => {
                // 创建不同状态的案件
                const inProgressCase = await createTestCase({
                    userId: testUser.id,
                    caseTypeId: testCaseType.id,
                    status: CaseStatus.IN_PROGRESS,
                })
                testIds.caseIds.push(inProgressCase.id)

                const completedCase = await createTestCase({
                    userId: testUser.id,
                    caseTypeId: testCaseType.id,
                    status: CaseStatus.COMPLETED,
                })
                testIds.caseIds.push(completedCase.id)

                await fc.assert(
                    fc.asyncProperty(
                        fc.constantFrom(CaseStatus.IN_PROGRESS, CaseStatus.COMPLETED),
                        async (status) => {
                            const result = await findManyCasesDao({
                                userId: testUser.id,
                                status,
                            })

                            // 所有返回的案件都应该满足筛选条件
                            expect(result.list.every(c => c.status === status)).toBe(true)
                            expect(result.list.every(c => c.userId === testUser.id)).toBe(true)

                            return true
                        }
                    ),
                    PBT_CONFIG
                )
            })
        })
    })
})
