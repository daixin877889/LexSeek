/**
 * Session DAO 空白覆盖测试 - assistant scope 鉴权路径
 *
 * 覆盖 `findSessionWithOwnershipCheck` 内部函数在 scope=assistant（session.case 为 null）
 * 与 scope=case 存量数据（userId=null）两类场景下的鉴权行为。
 *
 * 由于 `findSessionWithOwnershipCheck` 是模块内部函数，通过公共外壳
 * `softDeleteSessionDAO` 触发。
 *
 * **Feature: legal-assistant-phase1**
 * **Validates: spec §4.11.1**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import './test-setup'
import {
    createTestUser,
    createTestCaseType,
    createTestCase,
    createEmptyTestIds,
    cleanupTestData,
    disconnectTestDb,
    getTestPrisma,
    type CaseTestIds,
} from './test-db-helper'
import { softDeleteSessionDAO } from '../../../server/services/case/session.dao'

// softDeleteSessionDAO 内部通过服务端自动导入调用 getActiveRunService / cancelRunService，
// 此处注入 noop stub 即可（本测试关注鉴权分支，assistant session 不会有 activeRun）
;(globalThis as any).getActiveRunService = vi.fn().mockResolvedValue(null)
;(globalThis as any).cancelRunService = vi.fn().mockResolvedValue(undefined)

describe('findSessionWithOwnershipCheck - assistant scope', () => {
    let testIds: CaseTestIds

    beforeAll(() => {
        testIds = createEmptyTestIds()
    })

    afterEach(async () => {
        const sessionIdsToClean = [...testIds.sessionIds]
        const caseIdsToClean = [...testIds.caseIds]
        const caseTypeIdsToClean = [...testIds.caseTypeIds]
        const userIdsToClean = [...testIds.userIds]
        if (
            sessionIdsToClean.length > 0
            || caseIdsToClean.length > 0
            || caseTypeIdsToClean.length > 0
            || userIdsToClean.length > 0
        ) {
            await cleanupTestData({
                ...createEmptyTestIds(),
                sessionIds: sessionIdsToClean,
                caseIds: caseIdsToClean,
                caseTypeIds: caseTypeIdsToClean,
                userIds: userIdsToClean,
            })
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

    it('scope=assistant 时应通过 session.userId 鉴权（session.case 为 null）', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const sessionId = `assist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        await getTestPrisma().caseSessions.create({
            data: {
                sessionId,
                scope: 'assistant',
                userId: user.id,
                caseId: null,
                type: 1,
            },
        })
        testIds.sessionIds.push(sessionId)

        const result = await softDeleteSessionDAO({
            sessionId,
            userId: user.id,
            allowedTypes: [1],
        })

        expect(result.success).toBe(true)
    })

    it('scope=assistant 时对他人 userId 拒绝', async () => {
        const owner = await createTestUser()
        const intruder = await createTestUser()
        testIds.userIds.push(owner.id, intruder.id)

        const sessionId = `assist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        await getTestPrisma().caseSessions.create({
            data: {
                sessionId,
                scope: 'assistant',
                userId: owner.id,
                caseId: null,
                type: 1,
            },
        })
        testIds.sessionIds.push(sessionId)

        const result = await softDeleteSessionDAO({
            sessionId,
            userId: intruder.id,
            allowedTypes: [1],
        })

        expect(result.success).toBe(false)
        expect(result.error).toMatch(/无权/)
    })

    it('scope=case 存量 userId=null 时通过 case.userId 回退鉴权', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const caseType = await createTestCaseType({ status: 1 })
        testIds.caseTypeIds.push(caseType.id)

        const caseRow = await createTestCase({
            userId: user.id,
            caseTypeId: caseType.id,
        })
        testIds.caseIds.push(caseRow.id)

        const sessionId = `case-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        await getTestPrisma().caseSessions.create({
            data: {
                sessionId,
                scope: 'case',
                userId: null, // 存量数据模拟
                caseId: caseRow.id,
                type: 1,
            },
        })
        testIds.sessionIds.push(sessionId)

        const result = await softDeleteSessionDAO({
            sessionId,
            userId: user.id,
            allowedTypes: [1],
        })

        expect(result.success).toBe(true)
    })
})
