/**
 * 案件会话服务层测试
 *
 * **Feature: case-session**
 * **Validates: caseSession.service.ts 核心函数**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
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

import {
    findCaseBySessionIdService,
} from '../../../server/services/case/caseSession.service'

describe('案件会话服务层', () => {
    let testIds: CaseTestIds
    let testUser: Awaited<ReturnType<typeof createTestUser>>
    let testCaseType: Awaited<ReturnType<typeof createTestCaseType>>
    let testCase: Awaited<ReturnType<typeof createTestCase>>

    beforeAll(async () => {
        testIds = createEmptyTestIds()
        testUser = await createTestUser()
        testIds.userIds.push(testUser.id)
        testCaseType = await createTestCaseType({ status: 1 })
        testIds.caseTypeIds.push(testCaseType.id)
        testCase = await createTestCase({ userId: testUser.id, caseTypeId: testCaseType.id })
        testIds.caseIds.push(testCase.id)
    })

    afterEach(async () => {
        if (testIds.sessionIds.length > 0) {
            await cleanupTestData({
                ...createEmptyTestIds(),
                sessionIds: [...testIds.sessionIds],
            })
            testIds.sessionIds = []
        }
    })

    afterAll(async () => {
        await cleanupTestData(testIds)
        await disconnectTestDb()
    })

    // ==================== findCaseBySessionIdService ====================

    describe('findCaseBySessionIdService - 通过会话 ID 查询案件', () => {
        it('应返回存在的会话对应的案件', async () => {
            const session = await createTestSession({ caseId: testCase.id })
            testIds.sessionIds.push(session.sessionId)

            const result = await findCaseBySessionIdService(session.sessionId)

            expect(result).not.toBeNull()
            expect(result!.id).toBe(testCase.id)
        })

        it('应返回包含案件所有者的结果', async () => {
            const session = await createTestSession({ caseId: testCase.id })
            testIds.sessionIds.push(session.sessionId)

            const result = await findCaseBySessionIdService(session.sessionId)

            expect(result!.userId).toBe(testUser.id)
        })

        it('应返回包含会话信息的结果', async () => {
            const session = await createTestSession({ caseId: testCase.id })
            testIds.sessionIds.push(session.sessionId)

            const result = await findCaseBySessionIdService(session.sessionId)

            expect(result!.caseSessions).toBeDefined()
            expect(Array.isArray(result!.caseSessions)).toBe(true)
        })

        it('不存在的 sessionId 应返回 null', async () => {
            const result = await findCaseBySessionIdService('non_existent_session_id')
            expect(result).toBeNull()
        })

        it('普通对话类型的会话应正常返回', async () => {
            const session = await createTestSession({ caseId: testCase.id, type: 1 })
            testIds.sessionIds.push(session.sessionId)

            const result = await findCaseBySessionIdService(session.sessionId)

            expect(result).not.toBeNull()
            expect(result!.id).toBe(testCase.id)
        })

        it('分析类型的会话应正常返回', async () => {
            const session = await createTestSession({ caseId: testCase.id, type: 2 })
            testIds.sessionIds.push(session.sessionId)

            const result = await findCaseBySessionIdService(session.sessionId)

            expect(result).not.toBeNull()
            expect(result!.id).toBe(testCase.id)
        })

        it('不同会话状态应正常返回', async () => {
            const session = await createTestSession({ caseId: testCase.id, status: 1 })
            testIds.sessionIds.push(session.sessionId)

            const result = await findCaseBySessionIdService(session.sessionId)

            expect(result).not.toBeNull()
            expect(result!.id).toBe(testCase.id)
        })

        it('应返回案件的标题', async () => {
            const session = await createTestSession({ caseId: testCase.id })
            testIds.sessionIds.push(session.sessionId)

            const result = await findCaseBySessionIdService(session.sessionId)

            expect(result!.title).toBe(testCase.title)
        })
    })
})
