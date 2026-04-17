/**
 * 案件 DAO 层剩余 catch 分支覆盖测试
 *
 * 补充 case.dao.ts 中各函数 catch 分支（Proxy 故障注入）
 * 以及少量未覆盖的正常路径（如 findCaseBySessionIdDao 关联案件已被软删除）。
 *
 * **Feature: server-test-coverage**
 * **Validates: case.dao.ts catch 分支完整覆盖**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import './test-setup'
import {
    createTestUser,
    createTestCaseType,
    createTestCase,
    createTestSession,
    createEmptyTestIds,
    cleanupTestData,
    disconnectTestDb,
    getTestPrisma,
    type CaseTestIds,
} from './test-db-helper'
import {
    createCaseDao,
    createSessionDao,
    findCaseByIdDao,
    findCaseBySessionIdDao,
    findSessionByIdDao,
    findManyCasesDao,
    updateCaseDao,
    updateSessionStatusDao,
    softDeleteCaseDao,
    findLatestSessionByCaseIdDao,
    checkCaseOwnershipDao,
} from '../../../server/services/case/case.dao'

/** 故障注入：使 globalThis.prisma 在访问任意属性时抛错 */
const withFaultyPrisma = async (fn: () => Promise<void>) => {
    const original = (globalThis as any).prisma
    ; (globalThis as any).prisma = new Proxy({}, {
        get: () => {
            throw new Error('injected-fault')
        },
    })
    try {
        await fn()
    } finally {
        ; (globalThis as any).prisma = original
    }
}

describe('案件 DAO - catch 分支覆盖', () => {
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
        if (caseIdsToClean.length > 0 || sessionIdsToClean.length > 0) {
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

    describe('createCaseDao - 故障场景', () => {
        it('prisma 抛错应透传', async () => {
            await withFaultyPrisma(async () => {
                await expect(
                    createCaseDao({
                        title: 't',
                        content: 'c',
                        userId: testUser.id,
                        caseTypeId: testCaseType.id,
                    })
                ).rejects.toThrow('injected-fault')
            })
        })
    })

    describe('createSessionDao - 故障场景', () => {
        it('prisma 抛错应透传', async () => {
            await withFaultyPrisma(async () => {
                await expect(
                    createSessionDao({
                        sessionId: `gap_fault_${Date.now()}`,
                        caseId: 1,
                    })
                ).rejects.toThrow('injected-fault')
            })
        })
    })

    describe('findCaseByIdDao - 故障场景', () => {
        it('prisma 抛错应透传', async () => {
            await withFaultyPrisma(async () => {
                await expect(findCaseByIdDao(1, false)).rejects.toThrow('injected-fault')
            })
        })
    })

    describe('findCaseBySessionIdDao - 分支补充', () => {
        it('关联案件被软删除时应返回 null', async () => {
            // 创建真实案件与会话
            const c = await createTestCase({ userId: testUser.id, caseTypeId: testCaseType.id })
            testIds.caseIds.push(c.id)
            const s = await createTestSession({ caseId: c.id })
            testIds.sessionIds.push(s.sessionId)

            // 将案件标记为已软删除（会话保持 deletedAt=null）
            await getTestPrisma().cases.update({
                where: { id: c.id },
                data: { deletedAt: new Date() },
            })

            const result = await findCaseBySessionIdDao(s.sessionId)
            expect(result).toBeNull()
        })

        it('prisma 抛错应透传', async () => {
            await withFaultyPrisma(async () => {
                await expect(findCaseBySessionIdDao('any-session')).rejects.toThrow('injected-fault')
            })
        })
    })

    describe('findCaseBySessionIdDao - assistant session', () => {
        it('遇到 scope=assistant session（session.case 为 null）应返回 null 而非崩溃', async () => {
            const sessionId = `assist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
            await getTestPrisma().caseSessions.create({
                data: {
                    sessionId,
                    scope: 'assistant',
                    userId: testUser.id,
                    caseId: null,
                    type: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testIds.sessionIds.push(sessionId)

            const result = await findCaseBySessionIdDao(sessionId)
            expect(result).toBeNull()
        })

        it('case 域正常 session 应正常返回 case', async () => {
            const c = await createTestCase({ userId: testUser.id, caseTypeId: testCaseType.id })
            testIds.caseIds.push(c.id)
            const sessionId = `case-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
            await getTestPrisma().caseSessions.create({
                data: {
                    sessionId,
                    scope: 'case',
                    userId: testUser.id,
                    caseId: c.id,
                    type: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testIds.sessionIds.push(sessionId)

            const result = await findCaseBySessionIdDao(sessionId)
            expect(result?.id).toBe(c.id)
        })
    })

    describe('findSessionByIdDao - 故障场景', () => {
        it('prisma 抛错应透传', async () => {
            await withFaultyPrisma(async () => {
                await expect(findSessionByIdDao('any')).rejects.toThrow('injected-fault')
            })
        })
    })

    describe('findManyCasesDao - 故障场景', () => {
        it('prisma 抛错应透传', async () => {
            await withFaultyPrisma(async () => {
                await expect(findManyCasesDao({ userId: testUser.id })).rejects.toThrow('injected-fault')
            })
        })
    })

    describe('updateCaseDao - 故障场景', () => {
        it('prisma 抛错应透传', async () => {
            await withFaultyPrisma(async () => {
                await expect(updateCaseDao(1, { title: 'x' })).rejects.toThrow('injected-fault')
            })
        })
    })

    describe('updateSessionStatusDao - 故障场景', () => {
        it('prisma 抛错应透传', async () => {
            await withFaultyPrisma(async () => {
                await expect(updateSessionStatusDao('s', 2)).rejects.toThrow('injected-fault')
            })
        })
    })

    describe('softDeleteCaseDao - 故障场景', () => {
        it('prisma 抛错应透传', async () => {
            await withFaultyPrisma(async () => {
                await expect(softDeleteCaseDao(1)).rejects.toThrow('injected-fault')
            })
        })
    })

    describe('findLatestSessionByCaseIdDao - 故障场景', () => {
        it('prisma 抛错应透传', async () => {
            await withFaultyPrisma(async () => {
                await expect(findLatestSessionByCaseIdDao(1)).rejects.toThrow('injected-fault')
            })
        })
    })

    describe('checkCaseOwnershipDao - 故障场景', () => {
        it('prisma 抛错应透传', async () => {
            await withFaultyPrisma(async () => {
                await expect(checkCaseOwnershipDao(1, 2)).rejects.toThrow('injected-fault')
            })
        })
    })
})
