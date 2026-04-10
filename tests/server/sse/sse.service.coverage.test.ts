/**
 * SSE 服务额外覆盖率测试
 *
 * 覆盖 sse.service.ts 中少量未被测试的路径：
 * - sendSSEResponseService 返回事件流
 * - sendReasoningEventService 带 taskName
 * - sendToolCallEventService 带 taskName
 * - sendToolResultEventService 带 taskName
 * - SSEConnectionManager.has / size
 * - 连接管理器内部清理逻辑
 *
 * **Feature: server-test-coverage**
 * **Validates: Requirements 7.1, 7.2**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
    formatSSEMessage,
    sendSSEMessageService,
    closeSSEConnectionService,
    sendReasoningEventService,
    sendToolCallEventService,
    sendToolResultEventService,
    sendTextDeltaEventService,
    sendTaskCompleteEventService,
    sendWorkflowStartEventService,
    sendWorkflowCompleteEventService,
    sendErrorEventService,
    sendInterruptResumeEventService,
    getSSEConnectionManagerService,
    isConnectionActiveService,
    sendSSEResponseService,
    type SSEConnection,
} from '~~/server/services/sse/sse.service'
import { SSEMessageType } from '#shared/types/case'

/** 创建 mock SSE 连接 */
function createMockConnection(overrides: Partial<SSEConnection> = {}): SSEConnection {
    return {
        id: `sse_cov_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        eventStream: {
            push: vi.fn().mockResolvedValue(undefined),
            close: vi.fn().mockResolvedValue(undefined),
            send: vi.fn().mockReturnValue('mock-send-result'),
            onClosed: vi.fn(),
        } as any,
        isClosed: false,
        createdAt: new Date(),
        lastActivityAt: new Date(),
        ...overrides,
    }
}

describe('SSE 服务 - 额外覆盖率', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    // ==================== sendSSEResponseService ====================

    describe('sendSSEResponseService - 返回事件流', () => {
        it('应返回 eventStream.send() 的结果', () => {
            const conn = createMockConnection()
            const result = sendSSEResponseService(conn)
            expect(conn.eventStream.send).toHaveBeenCalled()
            expect(result).toBe('mock-send-result')
        })
    })

    // ==================== 带 taskName 的事件发送 ====================

    describe('sendReasoningEventService - 带 taskName', () => {
        it('带 taskName 时应包含在 data 中', async () => {
            const conn = createMockConnection()
            await sendReasoningEventService(conn, '推理内容', 'test_task')

            const pushCall = (conn.eventStream.push as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
            const parsed = JSON.parse(pushCall)
            expect(parsed.type).toBe(SSEMessageType.REASONING)
            expect(parsed.data.taskName).toBe('test_task')
        })

        it('不带 taskName 时 data.taskName 为 undefined', async () => {
            const conn = createMockConnection()
            await sendReasoningEventService(conn, '推理内容')

            const pushCall = (conn.eventStream.push as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
            const parsed = JSON.parse(pushCall)
            expect(parsed.data.taskName).toBeUndefined()
        })
    })

    describe('sendToolCallEventService - 带 taskName 和 args', () => {
        it('应包含完整的工具调用信息', async () => {
            const conn = createMockConnection()
            await sendToolCallEventService(conn, 'search_tool', 'call_123', { query: 'test' }, 'task_1')

            const pushCall = (conn.eventStream.push as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
            const parsed = JSON.parse(pushCall)
            expect(parsed.data.toolName).toBe('search_tool')
            expect(parsed.data.toolCallId).toBe('call_123')
            expect(parsed.data.args).toEqual({ query: 'test' })
            expect(parsed.data.taskName).toBe('task_1')
        })

        it('不带可选参数时应正常工作', async () => {
            const conn = createMockConnection()
            await sendToolCallEventService(conn, 'tool_name', 'call_456')

            const pushCall = (conn.eventStream.push as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
            const parsed = JSON.parse(pushCall)
            expect(parsed.data.toolName).toBe('tool_name')
            expect(parsed.data.args).toBeUndefined()
            expect(parsed.data.taskName).toBeUndefined()
        })
    })

    describe('sendToolResultEventService - 带 taskName', () => {
        it('应包含工具结果和 taskName', async () => {
            const conn = createMockConnection()
            await sendToolResultEventService(conn, 'tool_name', 'call_789', { data: 'result' }, 'task_2')

            const pushCall = (conn.eventStream.push as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
            const parsed = JSON.parse(pushCall)
            expect(parsed.data.result).toEqual({ data: 'result' })
            expect(parsed.data.taskName).toBe('task_2')
        })
    })

    // ==================== 连接管理器属性 ====================

    describe('SSEConnectionManager - 属性', () => {
        it('has 应正确检查连接存在性', () => {
            const manager = getSSEConnectionManagerService()
            const conn = createMockConnection()
            manager.add(conn)

            expect(manager.has(conn.id)).toBe(true)
            expect(manager.has('non-existent')).toBe(false)

            manager.remove(conn.id)
        })

        it('size 应返回正确的连接数', () => {
            const manager = getSSEConnectionManagerService()
            const initialSize = manager.size

            const conn1 = createMockConnection()
            const conn2 = createMockConnection()
            manager.add(conn1)
            manager.add(conn2)

            expect(manager.size).toBe(initialSize + 2)

            manager.remove(conn1.id)
            manager.remove(conn2.id)
        })

        it('get 不存在的连接应返回 undefined', () => {
            const manager = getSSEConnectionManagerService()
            expect(manager.get('non-existent-id')).toBeUndefined()
        })
    })

    // ==================== sendInterruptResumeEventService 额外 ====================

    describe('sendInterruptResumeEventService - 不带 resumeData', () => {
        it('不传 resumeData 时应正常发送', async () => {
            const conn = createMockConnection()
            const result = await sendInterruptResumeEventService(conn, 'user_input')

            expect(result).toBe(true)
            const pushCall = (conn.eventStream.push as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
            const parsed = JSON.parse(pushCall)
            expect(parsed.data.interruptType).toBe('user_input')
            expect(parsed.data.resumeData).toBeUndefined()
        })
    })

    // ==================== sendWorkflowStartEventService 不带 data ====================

    describe('sendWorkflowStartEventService - 不带 data', () => {
        it('不传 workflowData 时应正常发送', async () => {
            const conn = createMockConnection()
            const result = await sendWorkflowStartEventService(conn)

            expect(result).toBe(true)
            const pushCall = (conn.eventStream.push as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
            const parsed = JSON.parse(pushCall)
            expect(parsed.type).toBe(SSEMessageType.WORKFLOW_START)
        })
    })

    // ==================== sendTaskCompleteEventService 不带 result ====================

    describe('sendTaskCompleteEventService - 不带 result', () => {
        it('不传 result 时应正常发送', async () => {
            const conn = createMockConnection()
            const result = await sendTaskCompleteEventService(conn, 'task_1', '测试任务')

            expect(result).toBe(true)
        })
    })

    // ==================== sendErrorEventService 不带 errorData ====================

    describe('sendErrorEventService - 不带 errorData', () => {
        it('不传 errorData 时应正常发送', async () => {
            const conn = createMockConnection()
            const result = await sendErrorEventService(conn, '错误消息')

            expect(result).toBe(true)
            const pushCall = (conn.eventStream.push as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
            const parsed = JSON.parse(pushCall)
            expect(parsed.type).toBe(SSEMessageType.ERROR)
            expect(parsed.data).toBeUndefined()
        })
    })
})
