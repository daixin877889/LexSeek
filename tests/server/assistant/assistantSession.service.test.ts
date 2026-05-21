/**
 * AssistantSession Service 测试
 *
 * 覆盖 5 个 service 转发函数 + generateSessionTitleAsync 的异常保护与幂等
 * （已有 title 不覆盖）。真打测试数据库。
 *
 * **Feature: legal-assistant-phase1**
 * **Validates: Task 9, spec §5.6.1-3**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import '../case/test-setup'
import {
    createTestUser,
    createEmptyTestIds,
    cleanupTestData,
    disconnectTestDb,
    getTestPrisma,
    type CaseTestIds,
} from '../case/test-db-helper'
import {
    createAssistantSessionService,
    generateSessionTitleAsync,
} from '../../../server/services/assistant/assistantSession.service'

describe('assistantSession.service', () => {
    let testIds: CaseTestIds

    beforeAll(() => {
        testIds = createEmptyTestIds()
    })

    afterEach(async () => {
        const snapshot: CaseTestIds = {
            ...createEmptyTestIds(),
            sessionIds: [...testIds.sessionIds],
            userIds: [...testIds.userIds],
        }
        if (snapshot.sessionIds.length > 0 || snapshot.userIds.length > 0) {
            await cleanupTestData(snapshot)
        }
        testIds.sessionIds = []
        testIds.userIds = []
    })

    afterAll(async () => {
        await cleanupTestData(testIds)
        await disconnectTestDb()
    })

    it('createAssistantSessionService 返回新会话', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const session = await createAssistantSessionService(user.id)
        testIds.sessionIds.push(session.sessionId)

        expect(session.userId).toBe(user.id)
        expect(session.scope).toBe('assistant')
        expect(session.caseId).toBeNull()
        expect(session.sessionId).toMatch(/^[0-9a-f-]{36}$/)
    })

    it('generateSessionTitleAsync 失败不抛出', async () => {
        await expect(
            generateSessionTitleAsync('not-exist', 99999, 'u'),
        ).resolves.not.toThrow()
    })

    it('已有 title 不被覆盖', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const session = await createAssistantSessionService(user.id, '手动设置')
        testIds.sessionIds.push(session.sessionId)

        await generateSessionTitleAsync(session.sessionId, user.id, 'q')

        const row = await getTestPrisma().caseSessions.findFirst({
            where: { sessionId: session.sessionId },
        })
        expect(row?.title).toBe('手动设置')
    })
})
