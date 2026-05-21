/**
 * GET /api/v1/cases/analysis/init-sessions Handler 测试
 *
 * 验证案件批量分析会话列表接口：
 *  - 仅返回 type=2 的会话，按 updatedAt 倒序
 *  - metadata.title 为空时回退「批量分析 #N」
 *  - 未登录 401 / 缺 caseId 400 / 跨用户 404
 *
 * 复用项目实际模式：参考 tests/server/assistant/sessions.api.test.ts —— 全局 stub
 * Nuxt 自动导入（resError/resSuccess/defineEventHandler/getQuery）+ 直接 import
 * handler 调用，DAO 打真库。
 *
 * **Feature: case-features-iter / Phase C**
 * **Validates: spec §3.1.3 验收清单 + plan Task C1**
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

// 全局 stub —— 与 shared/utils/apiResponse.ts 行为一致：success.code=0，error 携带业务码
const resError = (_event: any, code: number, message: string) => ({
    code,
    success: false,
    message,
    data: null,
})
const resSuccess = (_event: any, message: string, data: any) => ({
    code: 0,
    success: true,
    message,
    data,
})

;(globalThis as any).resError = resError
;(globalThis as any).resSuccess = resSuccess
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).getQuery = (event: any) => event.__query ?? {}

// 动态 import handler（必须在全局 stub 之后）
const { default: listHandler } = await import('../../../server/api/v1/cases/analysis/init-sessions.get')

interface MockEvent {
    context: { auth?: { user: { id: number } } }
    __query?: Record<string, any>
}

function makeEvent(opts: { userId?: number, query?: Record<string, any> }): MockEvent {
    return {
        context: opts.userId ? { auth: { user: { id: opts.userId } } } : {},
        __query: opts.query,
    }
}

describe('GET /api/v1/cases/analysis/init-sessions', () => {
    let testIds: CaseTestIds
    let userId: number
    let otherUserId: number
    let caseId: number

    beforeAll(async () => {
        testIds = createEmptyTestIds()

        const caseType = await createTestCaseType()
        testIds.caseTypeIds.push(caseType.id)

        const owner = await createTestUser()
        userId = owner.id
        testIds.userIds.push(owner.id)

        const other = await createTestUser()
        otherUserId = other.id
        testIds.userIds.push(other.id)

        const caseRecord = await createTestCase({
            userId,
            caseTypeId: caseType.id,
            title: 'init-sessions-list-case',
        })
        caseId = caseRecord.id
        testIds.caseIds.push(caseRecord.id)

        // 2 个 type=2 session（title 存放在 metadata.title）
        const s1 = await createTestSession({ caseId, type: 2 })
        testIds.sessionIds.push(s1.sessionId)
        // 使 s1 metadata.title='首次批量分析'
        await (globalThis as any).prisma.caseSessions.update({
            where: { sessionId: s1.sessionId },
            data: { metadata: { title: '首次批量分析' }, updatedAt: new Date(Date.now() - 1000) },
        })

        const s2 = await createTestSession({ caseId, type: 2 })
        testIds.sessionIds.push(s2.sessionId)
        // s2 metadata 留空，更新时间晚于 s1 —— 期望在列表最前
        await (globalThis as any).prisma.caseSessions.update({
            where: { sessionId: s2.sessionId },
            data: { metadata: {}, updatedAt: new Date() },
        })

        // 1 个 type=3 session（不应出现在结果）
        const sMod = await createTestSession({ caseId, type: 3 })
        testIds.sessionIds.push(sMod.sessionId)
        await (globalThis as any).prisma.caseSessions.update({
            where: { sessionId: sMod.sessionId },
            data: { metadata: { title: '模块对话' } },
        })
    })

    afterEach(() => {
        // 本测试套件中所有 setup 数据在 afterAll 一次性清理
    })

    afterAll(async () => {
        await cleanupTestData(testIds)
        await disconnectTestDb()
    })

    it('返回该案件所有 type=2 会话，按 updatedAt 倒序，且不含 type=3', async () => {
        const res: any = await listHandler(makeEvent({ userId, query: { caseId } }) as any)
        expect(res.code).toBe(0)
        expect(Array.isArray(res.data)).toBe(true)
        expect(res.data.length).toBe(2)
        // 全部均为 type=2 的 sessionId（不应含 type=3 的 sessionId）
        const sessionIds = res.data.map((s: any) => s.sessionId)
        expect(sessionIds.includes(testIds.sessionIds[2])).toBe(false) // type=3
        // 第 0 个应为最新（updatedAt 大），第 1 个为最早
        expect(res.data[0].sessionId).toBe(testIds.sessionIds[1])
        expect(res.data[1].sessionId).toBe(testIds.sessionIds[0])
    })

    it('metadata.title 为空时使用回退「批量分析 #N」', async () => {
        const res: any = await listHandler(makeEvent({ userId, query: { caseId } }) as any)
        const fallback = res.data.find((s: any) => s.sessionId === testIds.sessionIds[1])
        expect(fallback.title).toMatch(/^批量分析 #\d+$/)
        // 有 metadata.title 的项使用原标题
        const named = res.data.find((s: any) => s.sessionId === testIds.sessionIds[0])
        expect(named.title).toBe('首次批量分析')
    })

    it('未登录返 401', async () => {
        const res: any = await listHandler(makeEvent({ query: { caseId } }) as any)
        expect(res.code).toBe(401)
    })

    it('缺少 caseId 返 400', async () => {
        const res: any = await listHandler(makeEvent({ userId, query: {} }) as any)
        expect(res.code).toBe(400)
    })

    it('跨用户访问返 404（owner-only 保证）', async () => {
        const res: any = await listHandler(makeEvent({ userId: otherUserId, query: { caseId } }) as any)
        expect(res.code).toBe(404)
    })
})
