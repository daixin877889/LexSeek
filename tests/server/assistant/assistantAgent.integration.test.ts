/**
 * runAssistantChat 集成测试
 *
 * 验证 assistant 主代理能从 assistantMain 节点读取配置并返回 SSE stream。
 * 不消费 stream，避免真正调用模型（测试环境没有有效的外部 API Key）。
 *
 * **Feature: legal-assistant-phase1**
 * **Validates: Task 8, spec §5.3**
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

describe('runAssistantChat - 集成', () => {
    let testIds: CaseTestIds

    beforeAll(() => {
        testIds = createEmptyTestIds()
    })

    afterEach(async () => {
        // 清理每个用例产生的 session，避免残留
        const prisma = getTestPrisma()
        if (testIds.sessionIds.length > 0) {
            await prisma.caseSessions.deleteMany({
                where: { sessionId: { in: testIds.sessionIds } },
            })
            testIds.sessionIds = []
        }
    })

    afterAll(async () => {
        await cleanupTestData(testIds)
        await disconnectTestDb()
    })

    it('从 assistantMain 节点读取配置并返回 SSE stream', async () => {
        const { runAssistantChat } = await import(
            '~~/server/services/workflow/agents/assistantAgent'
        )

        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const sessionId = `integ-assist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const prisma = getTestPrisma()
        await prisma.caseSessions.create({
            data: {
                sessionId,
                scope: 'assistant',
                userId: user.id,
                caseId: null,
                status: 1,
                type: 1,
            },
        })
        testIds.sessionIds.push(sessionId)

        const stream = await runAssistantChat(sessionId, '你好', {
            userId: user.id,
            thinking: false,
        })

        // 只验证形态：返回 ReadableStream；不消费内容避免真调模型
        expect(stream).toBeInstanceOf(ReadableStream)

        // 主动取消 stream，释放底层 reader/连接
        if (typeof (stream as any).cancel === 'function') {
            await (stream as any).cancel().catch(() => undefined)
        }
    }, 30_000)
})
