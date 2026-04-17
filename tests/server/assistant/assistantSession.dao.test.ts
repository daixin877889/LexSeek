/**
 * AssistantSession DAO 测试
 *
 * 覆盖 assistantSession.dao 五个 CRUD 函数 + Zod 校验 + 跨用户鉴权。
 * 真打测试数据库，参见 spec §4.10, §5.6.1-3。
 *
 * **Feature: legal-assistant-phase1**
 * **Validates: Task 7**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import '../case/test-setup'
import {
    createTestUser,
    createTestCaseType,
    createTestCase,
    createEmptyTestIds,
    cleanupTestData,
    disconnectTestDb,
    getTestPrisma,
    type CaseTestIds,
} from '../case/test-db-helper'
import {
    createAssistantSessionDAO,
    getAssistantSessionDAO,
    listAssistantSessionsDAO,
    renameAssistantSessionDAO,
    softDeleteAssistantSessionDAO,
} from '../../../server/services/assistant/assistantSession.dao'

describe('assistantSession.dao', () => {
    let testIds: CaseTestIds

    beforeAll(() => {
        testIds = createEmptyTestIds()
    })

    afterEach(async () => {
        // 每个用例结束都清理，防止串扰
        const snapshot: CaseTestIds = {
            ...createEmptyTestIds(),
            sessionIds: [...testIds.sessionIds],
            caseIds: [...testIds.caseIds],
            caseTypeIds: [...testIds.caseTypeIds],
            userIds: [...testIds.userIds],
        }
        if (
            snapshot.sessionIds.length > 0
            || snapshot.caseIds.length > 0
            || snapshot.caseTypeIds.length > 0
            || snapshot.userIds.length > 0
        ) {
            await cleanupTestData(snapshot)
        }
        testIds.sessionIds = []
        testIds.caseIds = []
        testIds.caseTypeIds = []
        testIds.userIds = []
    })

    afterAll(async () => {
        await cleanupTestData(testIds)
        await disconnectTestDb()
    })

    describe('createAssistantSessionDAO', () => {
        it('成功创建 scope=assistant session，sessionId 为 UUID，caseId 为 null', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const session = await createAssistantSessionDAO({ userId: user.id })
            testIds.sessionIds.push(session.sessionId)

            expect(session.scope).toBe('assistant')
            expect(session.userId).toBe(user.id)
            expect(session.caseId).toBeNull()
            expect(session.type).toBe(1)
            expect(session.sessionId).toMatch(/^[0-9a-f-]{36}$/)
        })

        it('支持传 title 字段', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const session = await createAssistantSessionDAO({ userId: user.id, title: '我的会话' })
            testIds.sessionIds.push(session.sessionId)

            expect(session.title).toBe('我的会话')
        })

        it.each([
            [{ userId: 0 }, 'userId 必须为正整数'],
            [{ userId: -1 }, 'userId 不可为负数'],
            [{ userId: null as any }, 'userId 不可为 null'],
        ])('Zod 校验拒绝非法输入 %o', async (input, _desc) => {
            await expect(createAssistantSessionDAO(input as any)).rejects.toThrow()
        })
    })

    describe('getAssistantSessionDAO', () => {
        it('根据 sessionId + userId 取回会话，跨用户返回 null', async () => {
            const owner = await createTestUser()
            const intruder = await createTestUser()
            testIds.userIds.push(owner.id, intruder.id)

            const session = await createAssistantSessionDAO({ userId: owner.id })
            testIds.sessionIds.push(session.sessionId)

            const self = await getAssistantSessionDAO(session.sessionId, owner.id)
            expect(self?.sessionId).toBe(session.sessionId)

            const other = await getAssistantSessionDAO(session.sessionId, intruder.id)
            expect(other).toBeNull()
        })

        it('scope=case session 不被返回（只匹配 assistant）', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const caseType = await createTestCaseType()
            testIds.caseTypeIds.push(caseType.id)

            const caseRow = await createTestCase({ userId: user.id, caseTypeId: caseType.id })
            testIds.caseIds.push(caseRow.id)

            const sessionId = `case-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
            await getTestPrisma().caseSessions.create({
                data: {
                    sessionId,
                    scope: 'case',
                    userId: user.id,
                    caseId: caseRow.id,
                    type: 1,
                },
            })
            testIds.sessionIds.push(sessionId)

            expect(await getAssistantSessionDAO(sessionId, user.id)).toBeNull()
        })
    })

    describe('listAssistantSessionsDAO', () => {
        it('按 updatedAt desc 分页返回当前用户的 assistant session', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const s1 = await createAssistantSessionDAO({ userId: user.id, title: 'A' })
            testIds.sessionIds.push(s1.sessionId)
            // 等待 10ms 确保 updatedAt 有明确先后
            await new Promise(r => setTimeout(r, 10))
            const s2 = await createAssistantSessionDAO({ userId: user.id, title: 'B' })
            testIds.sessionIds.push(s2.sessionId)

            const result = await listAssistantSessionsDAO({ userId: user.id, page: 1, pageSize: 20 })

            expect(result.total).toBe(2)
            expect(result.list[0]?.sessionId).toBe(s2.sessionId)
            expect(result.list[1]?.sessionId).toBe(s1.sessionId)
            expect(result.page).toBe(1)
            expect(result.pageSize).toBe(20)
        })

        it('软删的会话不返回', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const session = await createAssistantSessionDAO({ userId: user.id })
            testIds.sessionIds.push(session.sessionId)

            await softDeleteAssistantSessionDAO(session.sessionId, user.id)

            const result = await listAssistantSessionsDAO({ userId: user.id, page: 1, pageSize: 20 })
            expect(result.list).toHaveLength(0)
            expect(result.total).toBe(0)
        })

        it('仅返回当前用户的会话（跨用户隔离）', async () => {
            const userA = await createTestUser()
            const userB = await createTestUser()
            testIds.userIds.push(userA.id, userB.id)

            const sa = await createAssistantSessionDAO({ userId: userA.id })
            testIds.sessionIds.push(sa.sessionId)
            const sb = await createAssistantSessionDAO({ userId: userB.id })
            testIds.sessionIds.push(sb.sessionId)

            const resultA = await listAssistantSessionsDAO({ userId: userA.id, page: 1, pageSize: 20 })
            expect(resultA.total).toBe(1)
            expect(resultA.list[0]?.sessionId).toBe(sa.sessionId)
        })
    })

    describe('renameAssistantSessionDAO', () => {
        it('成功修改 title', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const session = await createAssistantSessionDAO({ userId: user.id })
            testIds.sessionIds.push(session.sessionId)

            const result = await renameAssistantSessionDAO({
                sessionId: session.sessionId,
                userId: user.id,
                title: '新标题',
            })
            expect(result.success).toBe(true)

            const updated = await getAssistantSessionDAO(session.sessionId, user.id)
            expect(updated?.title).toBe('新标题')
        })

        it('跨用户修改返回 false', async () => {
            const owner = await createTestUser()
            const intruder = await createTestUser()
            testIds.userIds.push(owner.id, intruder.id)

            const session = await createAssistantSessionDAO({ userId: owner.id })
            testIds.sessionIds.push(session.sessionId)

            const result = await renameAssistantSessionDAO({
                sessionId: session.sessionId,
                userId: intruder.id,
                title: '篡改',
            })
            expect(result.success).toBe(false)
            expect(result.error).toBeDefined()
        })
    })

    describe('softDeleteAssistantSessionDAO', () => {
        it('成功设置 deletedAt', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const session = await createAssistantSessionDAO({ userId: user.id })
            testIds.sessionIds.push(session.sessionId)

            const result = await softDeleteAssistantSessionDAO(session.sessionId, user.id)
            expect(result.success).toBe(true)

            const row = await getTestPrisma().caseSessions.findFirst({
                where: { sessionId: session.sessionId },
            })
            expect(row?.deletedAt).not.toBeNull()
        })

        it('跨用户软删返回 false', async () => {
            const owner = await createTestUser()
            const intruder = await createTestUser()
            testIds.userIds.push(owner.id, intruder.id)

            const session = await createAssistantSessionDAO({ userId: owner.id })
            testIds.sessionIds.push(session.sessionId)

            const result = await softDeleteAssistantSessionDAO(session.sessionId, intruder.id)
            expect(result.success).toBe(false)
            expect(result.error).toBeDefined()
        })
    })
})
