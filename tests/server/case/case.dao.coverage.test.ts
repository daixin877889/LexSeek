/**
 * 案件 DAO 层覆盖率补充测试
 *
 * **Feature: server-test-coverage**
 * **Validates: Requirements 3.1, 3.2, 5.6, 5.7**
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
import { CaseStatus, SessionStatus } from '../../../shared/types/case'

describe('案件 DAO 层 - 覆盖率补充', () => {
    let testIds: CaseTestIds
    let testUser: Awaited<ReturnType<typeof createTestUser>>
    let testCaseType: Awaited<ReturnType<typeof createTestCaseType>>

    const makeCase = async () => {
        const c = await createTestCase({ userId: testUser.id, caseTypeId: testCaseType.id })
        testIds.caseIds.push(c.id)
        return c
    }

    const makeSession = async (caseId: number) => {
        const s = await createTestSession({ caseId })
        testIds.sessionIds.push(s.sessionId)
        return s
    }

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
            await cleanupTestData({ ...createEmptyTestIds(), caseIds: caseIdsToClean, sessionIds: sessionIdsToClean })
        }
        testIds.caseIds = []
        testIds.sessionIds = []
    })

    afterAll(async () => {
        await cleanupTestData(testIds)
        await disconnectTestDb()
    })

    describe('findCaseByIdDao - 关联数据查询', () => {
        it('includeRelations=true 应包含 caseType 和 caseSessions', async () => {
            const c = await makeCase()
            await makeSession(c.id)
            const result = await findCaseByIdDao(c.id, true)
            expect(result).not.toBeNull()
            expect(result!.caseType).toBeDefined()
            expect(result!.caseSessions).toBeDefined()
            expect(result!.caseSessions!.length).toBeGreaterThanOrEqual(1)
        })

        it('includeRelations=false 不应包含关联数据', async () => {
            const c = await makeCase()
            const result = await findCaseByIdDao(c.id, false)
            expect(result).not.toBeNull()
            expect(result!.caseType).toBeUndefined()
        })

        it('不存在的 ID 应返回 null', async () => {
            expect(await findCaseByIdDao(999999)).toBeNull()
        })
    })

    describe('findCaseBySessionIdDao - 通过会话查询案件', () => {
        it('应通过会话 ID 找到对应案件', async () => {
            const c = await makeCase()
            const s = await makeSession(c.id)
            const result = await findCaseBySessionIdDao(s.sessionId)
            expect(result).not.toBeNull()
            expect(result!.id).toBe(c.id)
            expect(result!.caseSessions!.length).toBe(1)
        })

        it('不存在的会话 ID 应返回 null', async () => {
            expect(await findCaseBySessionIdDao('non-existent')).toBeNull()
        })
    })

    describe('findSessionByIdDao', () => {
        it('应返回存在的会话', async () => {
            const c = await makeCase()
            const s = await makeSession(c.id)
            const result = await findSessionByIdDao(s.sessionId)
            expect(result).not.toBeNull()
            expect(result!.caseId).toBe(c.id)
        })

        it('不存在时返回 null', async () => {
            expect(await findSessionByIdDao('non-existent')).toBeNull()
        })
    })

    describe('findManyCasesDao - 筛选条件组合', () => {
        it('应按 caseTypeId 筛选', async () => {
            await makeCase()
            const result = await findManyCasesDao({ caseTypeId: testCaseType.id, userId: testUser.id })
            expect(result.list.length).toBeGreaterThanOrEqual(1)
            for (const c of result.list) expect(c.caseTypeId).toBe(testCaseType.id)
        })

        it('应按 status 筛选', async () => {
            await makeCase()
            const result = await findManyCasesDao({ userId: testUser.id, status: CaseStatus.IN_PROGRESS })
            for (const c of result.list) expect(c.status).toBe(CaseStatus.IN_PROGRESS)
        })

        it('应按 isDemo 筛选', async () => {
            const result = await findManyCasesDao({ userId: testUser.id, isDemo: false })
            for (const c of result.list) expect(c.isDemo).toBe(false)
        })

        it('应按 keyword 搜索标题和内容', async () => {
            const kw = `unique_kw_${Date.now()}`
            const c = await createCaseDao({ title: `含 ${kw} 的标题`, content: '内容', userId: testUser.id, caseTypeId: testCaseType.id })
            testIds.caseIds.push(c.id)
            const result = await findManyCasesDao({ keyword: kw })
            expect(result.list.some(x => x.id === c.id)).toBe(true)
        })

        it('应支持自定义分页', async () => {
            await makeCase()
            const result = await findManyCasesDao({ userId: testUser.id, page: 1, pageSize: 1 })
            expect(result.list.length).toBeLessThanOrEqual(1)
        })
    })

    describe('updateCaseDao - 各字段更新', () => {
        it('应更新标题', async () => {
            const c = await makeCase()
            expect((await updateCaseDao(c.id, { title: '新标题' })).title).toBe('新标题')
        })

        it('应更新状态', async () => {
            const c = await makeCase()
            expect((await updateCaseDao(c.id, { status: CaseStatus.COMPLETED })).status).toBe(CaseStatus.COMPLETED)
        })

        it('应更新 plaintiff 和 defendant', async () => {
            const c = await makeCase()
            const updated = await updateCaseDao(c.id, { plaintiff: [{ name: 'A' }] as any, defendant: [{ name: 'B' }] as any })
            expect(updated.plaintiff).toBeDefined()
            expect(updated.defendant).toBeDefined()
        })
    })

    describe('updateSessionStatusDao', () => {
        it('应正确更新', async () => {
            const c = await makeCase()
            const s = await makeSession(c.id)
            expect((await updateSessionStatusDao(s.sessionId, SessionStatus.COMPLETED)).status).toBe(SessionStatus.COMPLETED)
        })
    })

    describe('softDeleteCaseDao', () => {
        it('应同时软删除案件和关联会话', async () => {
            const c = await makeCase()
            const s = await makeSession(c.id)
            await softDeleteCaseDao(c.id)
            expect(await findCaseByIdDao(c.id)).toBeNull()
            expect(await findSessionByIdDao(s.sessionId)).toBeNull()
        })
    })

    describe('findLatestSessionByCaseIdDao', () => {
        it('应返回最新创建的会话', async () => {
            const c = await makeCase()
            await makeSession(c.id)
            await new Promise(r => setTimeout(r, 50))
            const s2 = await makeSession(c.id)
            const latest = await findLatestSessionByCaseIdDao(c.id)
            expect(latest).not.toBeNull()
            expect(latest!.sessionId).toBe(s2.sessionId)
        })

        it('不存在的案件 ID 应返回 null', async () => {
            expect(await findLatestSessionByCaseIdDao(999999)).toBeNull()
        })
    })

    describe('checkCaseOwnershipDao', () => {
        it('拥有者应返回 true', async () => {
            const c = await makeCase()
            expect(await checkCaseOwnershipDao(c.id, testUser.id)).toBe(true)
        })

        it('非拥有者应返回 false', async () => {
            const c = await makeCase()
            expect(await checkCaseOwnershipDao(c.id, 999999)).toBe(false)
        })

        it('不存在的案件应返回 false', async () => {
            expect(await checkCaseOwnershipDao(999999, testUser.id)).toBe(false)
        })
    })

    describe('createSessionDao - 参数组合', () => {
        it('应使用默认状态创建会话', async () => {
            const c = await makeCase()
            const s = await createSessionDao({ sessionId: `cov_${Date.now()}`, caseId: c.id })
            testIds.sessionIds.push(s.sessionId)
            expect(s.status).toBe(SessionStatus.IN_PROGRESS)
            expect(s.type).toBe(1)
        })

        it('应使用自定义 metadata 创建会话', async () => {
            const c = await makeCase()
            const s = await createSessionDao({ sessionId: `cov_meta_${Date.now()}`, caseId: c.id, metadata: { key: 'value' } })
            testIds.sessionIds.push(s.sessionId)
            expect(s.metadata).toEqual({ key: 'value' })
        })
    })
})
