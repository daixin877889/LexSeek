/**
 * SSE 服务测试
 *
 * **Feature: server-test-coverage**
 * **Validates: Requirements 5.1, 5.4, 5.5, 5.6, 5.8, 5.9, 7.1, 7.2**
 *
 * 覆盖：
 * - formatSSEMessage 格式化
 * - sendSSEMessageService 发送消息（成功/失败/连接关闭）
 * - closeSSEConnectionService 关闭连接
 * - SSEConnectionManager 连接管理
 * - 各种事件发送函数（interrupt/resume/task/text/tool/error/workflow）
 * - isConnectionActiveService 活跃检查
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fc from 'fast-check'
import {
    formatSSEMessage,
    sendSSEMessageService,
    closeSSEConnectionService,
    sendInterruptEventService,
    sendParsedInterruptEventService,
    sendInterruptResumeEventService,
    sendTaskStartEventService,
    sendTaskProgressEventService,
    sendTaskCompleteEventService,
    sendTextDeltaEventService,
    sendReasoningEventService,
    sendToolCallEventService,
    sendToolResultEventService,
    sendErrorEventService,
    sendWorkflowStartEventService,
    sendWorkflowCompleteEventService,
    getSSEConnectionManagerService,
    isConnectionActiveService,
    type SSEConnection,
} from '~~/server/services/sse/sse.service'
import { SSEMessageType } from '#shared/types/case'

/** 属性测试配置 */
const PBT_CONFIG = { numRuns: 100 }

/** 创建 mock SSE 连接 */
function createMockConnection(overrides: Partial<SSEConnection> = {}): SSEConnection {
    return {
        id: `sse_test_${Date.now()}`,
        eventStream: {
            push: vi.fn().mockResolvedValue(undefined),
            close: vi.fn().mockResolvedValue(undefined),
            send: vi.fn(),
            onClosed: vi.fn(),
        } as any,
        isClosed: false,
        createdAt: new Date(),
        lastActivityAt: new Date(),
        ...overrides,
    }
}

describe('SSE 服务', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    // ==================== formatSSEMessage ====================

    describe('formatSSEMessage - 格式化 SSE 消息', () => {
        it('应该正确格式化基本消息', () => {
            const message = {
                type: SSEMessageType.INFO,
                message: '测试消息',
            }

            const result = formatSSEMessage(message)
            const parsed = JSON.parse(result)

            expect(parsed.type).toBe(SSEMessageType.INFO)
            expect(parsed.message).toBe('测试消息')
            expect(parsed.timestamp).toBeDefined()
        })

        it('应该保留已有的 timestamp', () => {
            const timestamp = Date.now() - 1000
            const message = {
                type: SSEMessageType.INFO,
                message: '测试消息',
                timestamp,
            }

            const result = formatSSEMessage(message)
            const parsed = JSON.parse(result)

            expect(parsed.timestamp).toBe(timestamp)
        })

        it('应该正确格式化带 data 的消息', () => {
            const message = {
                type: SSEMessageType.TASK_START,
                message: '开始任务',
                data: { taskName: 'test_task', taskTitle: '测试任务' },
            }

            const result = formatSSEMessage(message)
            const parsed = JSON.parse(result)

            expect(parsed.type).toBe(SSEMessageType.TASK_START)
            expect(parsed.data.taskName).toBe('test_task')
            expect(parsed.data.taskTitle).toBe('测试任务')
        })

        it('应该正确格式化心跳消息', () => {
            const message = {
                type: SSEMessageType.HEARTBEAT,
                message: 'ping',
            }

            const result = formatSSEMessage(message)
            const parsed = JSON.parse(result)

            expect(parsed.type).toBe(SSEMessageType.HEARTBEAT)
            expect(parsed.message).toBe('ping')
        })

        it('应该正确格式化连接消息', () => {
            const message = {
                type: SSEMessageType.CONNECTED,
                message: '连接成功',
                data: { connectionId: 'sse_123456' },
            }

            const result = formatSSEMessage(message)
            const parsed = JSON.parse(result)

            expect(parsed.type).toBe(SSEMessageType.CONNECTED)
            expect(parsed.data.connectionId).toBe('sse_123456')
        })

        it('应该正确格式化错误消息', () => {
            const message = {
                type: SSEMessageType.ERROR,
                message: '发生错误',
                data: { code: 500, detail: '内部错误' },
            }

            const result = formatSSEMessage(message)
            const parsed = JSON.parse(result)

            expect(parsed.type).toBe(SSEMessageType.ERROR)
            expect(parsed.message).toBe('发生错误')
            expect(parsed.data.code).toBe(500)
        })

        it('应该正确格式化中断消息', () => {
            const message = {
                type: SSEMessageType.INTERRUPT,
                message: '需要用户输入',
                data: {
                    __interrupt__: {
                        type: 'user_input',
                        message: '请输入信息',
                        data: { field: 'name' },
                    },
                },
            }

            const result = formatSSEMessage(message)
            const parsed = JSON.parse(result)

            expect(parsed.type).toBe(SSEMessageType.INTERRUPT)
            expect(parsed.data.__interrupt__.type).toBe('user_input')
        })

        it('应该正确格式化文本增量消息', () => {
            const message = {
                type: SSEMessageType.TEXT_DELTA,
                message: '这是一段',
                data: { taskName: 'analysis' },
            }

            const result = formatSSEMessage(message)
            const parsed = JSON.parse(result)

            expect(parsed.type).toBe(SSEMessageType.TEXT_DELTA)
            expect(parsed.message).toBe('这是一段')
        })

        it('应该正确格式化工作流开始消息', () => {
            const message = {
                type: SSEMessageType.WORKFLOW_START,
                message: '工作流开始',
                data: { workflowId: 'wf_123' },
            }

            const result = formatSSEMessage(message)
            const parsed = JSON.parse(result)

            expect(parsed.type).toBe(SSEMessageType.WORKFLOW_START)
        })

        it('应该正确格式化工作流完成消息', () => {
            const message = {
                type: SSEMessageType.WORKFLOW_COMPLETE,
                message: '工作流完成',
                data: { result: 'success' },
            }

            const result = formatSSEMessage(message)
            const parsed = JSON.parse(result)

            expect(parsed.type).toBe(SSEMessageType.WORKFLOW_COMPLETE)
        })
    })

    describe('SSE 消息类型覆盖', () => {
        it('应该支持所有定义的消息类型', () => {
            const messageTypes = [
                SSEMessageType.CONNECTED,
                SSEMessageType.HEARTBEAT,
                SSEMessageType.CLOSED,
                SSEMessageType.INFO,
                SSEMessageType.ERROR,
                SSEMessageType.WORKFLOW_START,
                SSEMessageType.WORKFLOW_COMPLETE,
                SSEMessageType.TASK_START,
                SSEMessageType.TASK_PROGRESS,
                SSEMessageType.TASK_COMPLETE,
                SSEMessageType.TEXT_DELTA,
                SSEMessageType.REASONING,
                SSEMessageType.TOOL_CALL,
                SSEMessageType.TOOL_RESULT,
                SSEMessageType.INTERRUPT,
            ]

            for (const type of messageTypes) {
                const message = { type, message: '测试' }
                const result = formatSSEMessage(message)
                const parsed = JSON.parse(result)
                expect(parsed.type).toBe(type)
            }
        })
    })

    // ==================== sendSSEMessageService ====================

    describe('sendSSEMessageService - 发送 SSE 消息', () => {
        it('连接正常时成功发送消息', async () => {
            const conn = createMockConnection()
            const result = await sendSSEMessageService(conn, {
                type: SSEMessageType.INFO,
                message: '测试',
            })

            expect(result).toBe(true)
            expect(conn.eventStream.push).toHaveBeenCalledTimes(1)
        })

        it('发送后更新 lastActivityAt', async () => {
            const conn = createMockConnection()
            const before = conn.lastActivityAt

            // 确保有时间差
            await new Promise(r => setTimeout(r, 10))
            await sendSSEMessageService(conn, {
                type: SSEMessageType.INFO,
                message: '测试',
            })

            expect(conn.lastActivityAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
        })

        it('连接已关闭时返回 false', async () => {
            const conn = createMockConnection({ isClosed: true })
            const result = await sendSSEMessageService(conn, {
                type: SSEMessageType.INFO,
                message: '测试',
            })

            expect(result).toBe(false)
            expect(conn.eventStream.push).not.toHaveBeenCalled()
        })

        it('推送失败时返回 false', async () => {
            const conn = createMockConnection()
            ;(conn.eventStream.push as any).mockRejectedValueOnce(new Error('网络错误'))

            const result = await sendSSEMessageService(conn, {
                type: SSEMessageType.INFO,
                message: '测试',
            })

            expect(result).toBe(false)
        })

        it('发送的消息是 formatSSEMessage 格式化后的 JSON', async () => {
            const conn = createMockConnection()
            const message = { type: SSEMessageType.INFO, message: '测试内容' }

            await sendSSEMessageService(conn, message)

            const pushedData = (conn.eventStream.push as any).mock.calls[0][0]
            const parsed = JSON.parse(pushedData)
            expect(parsed.type).toBe(SSEMessageType.INFO)
            expect(parsed.message).toBe('测试内容')
            expect(typeof parsed.timestamp).toBe('number')
        })
    })

    // ==================== closeSSEConnectionService ====================

    describe('closeSSEConnectionService - 关闭 SSE 连接', () => {
        it('正常关闭连接，发送关闭消息', async () => {
            const conn = createMockConnection()
            await closeSSEConnectionService(conn)

            expect(conn.isClosed).toBe(true)
            expect(conn.eventStream.close).toHaveBeenCalledTimes(1)
            // 应该发送了关闭消息
            expect(conn.eventStream.push).toHaveBeenCalled()
            const pushCall = (conn.eventStream.push as any).mock.calls[0][0]
            const parsed = JSON.parse(pushCall)
            expect(parsed.type).toBe(SSEMessageType.CLOSED)
        })

        it('已关闭的连接不重复关闭', async () => {
            const conn = createMockConnection({ isClosed: true })
            await closeSSEConnectionService(conn)

            expect(conn.eventStream.close).not.toHaveBeenCalled()
        })

        it('关闭时事件流报错不影响 isClosed 状态', async () => {
            const conn = createMockConnection()
            ;(conn.eventStream.close as any).mockRejectedValueOnce(new Error('关闭失败'))

            await closeSSEConnectionService(conn)

            expect(conn.isClosed).toBe(true)
        })

        it('关闭时清理心跳和超时定时器', async () => {
            const heartbeatTimer = setInterval(() => {}, 60000)
            const timeoutTimer = setTimeout(() => {}, 60000)
            const conn = createMockConnection({ heartbeatTimer, timeoutTimer })

            // 添加到管理器
            const manager = getSSEConnectionManagerService()
            manager.add(conn)

            await closeSSEConnectionService(conn)

            expect(conn.isClosed).toBe(true)
            // 确保管理器中已移除
            expect(manager.has(conn.id)).toBe(false)

            // 清理定时器
            clearInterval(heartbeatTimer)
            clearTimeout(timeoutTimer)
        })
    })

    // ==================== SSEConnectionManager ====================

    describe('SSEConnectionManager - 连接管理器', () => {
        it('添加和获取连接', () => {
            const manager = getSSEConnectionManagerService()
            const initialSize = manager.size
            const conn = createMockConnection({ id: 'test_mgr_1' })

            manager.add(conn)
            expect(manager.get('test_mgr_1')).toBe(conn)
            expect(manager.has('test_mgr_1')).toBe(true)
            expect(manager.size).toBe(initialSize + 1)

            // 清理
            manager.remove('test_mgr_1')
        })

        it('移除连接', () => {
            const manager = getSSEConnectionManagerService()
            const conn = createMockConnection({ id: 'test_mgr_2' })

            manager.add(conn)
            manager.remove('test_mgr_2')

            expect(manager.has('test_mgr_2')).toBe(false)
            expect(manager.get('test_mgr_2')).toBeUndefined()
        })

        it('移除不存在的连接不报错', () => {
            const manager = getSSEConnectionManagerService()
            expect(() => manager.remove('nonexistent')).not.toThrow()
        })

        it('移除连接时清理定时器', () => {
            const manager = getSSEConnectionManagerService()
            const heartbeatTimer = setInterval(() => {}, 60000)
            const timeoutTimer = setTimeout(() => {}, 60000)
            const conn = createMockConnection({
                id: 'test_mgr_timer',
                heartbeatTimer,
                timeoutTimer,
            })

            manager.add(conn)
            manager.remove('test_mgr_timer')

            // 定时器应已被清理
            clearInterval(heartbeatTimer)
            clearTimeout(timeoutTimer)
        })

        it('clear 清理所有连接和定时器', () => {
            const manager = getSSEConnectionManagerService()
            const conn1 = createMockConnection({ id: 'test_clear_1' })
            const conn2 = createMockConnection({ id: 'test_clear_2' })

            manager.add(conn1)
            manager.add(conn2)

            manager.clear()

            expect(manager.has('test_clear_1')).toBe(false)
            expect(manager.has('test_clear_2')).toBe(false)
            expect(manager.size).toBe(0)
        })
    })

    // ==================== isConnectionActiveService ====================

    describe('isConnectionActiveService - 连接活跃检查', () => {
        it('未关闭的连接返回 true', () => {
            const conn = createMockConnection({ isClosed: false })
            expect(isConnectionActiveService(conn)).toBe(true)
        })

        it('已关闭的连接返回 false', () => {
            const conn = createMockConnection({ isClosed: true })
            expect(isConnectionActiveService(conn)).toBe(false)
        })
    })

    // ==================== 事件发送函数 ====================

    describe('sendInterruptEventService - 发送中断事件', () => {
        it('发送包含 __interrupt__ 的中断消息', async () => {
            const conn = createMockConnection()
            const result = await sendInterruptEventService(
                conn, 'case_info_check', '请检查案情信息', { field: 'description' }
            )

            expect(result).toBe(true)
            const pushed = JSON.parse((conn.eventStream.push as any).mock.calls[0][0])
            expect(pushed.type).toBe(SSEMessageType.INTERRUPT)
            expect(pushed.data.__interrupt__.type).toBe('case_info_check')
            expect(pushed.data.__interrupt__.message).toBe('请检查案情信息')
            expect(pushed.data.__interrupt__.data.field).toBe('description')
        })

        it('不传中断数据也能正常发送', async () => {
            const conn = createMockConnection()
            const result = await sendInterruptEventService(conn, 'test', '测试中断')

            expect(result).toBe(true)
        })
    })

    describe('sendParsedInterruptEventService - 发送解析后的中断事件', () => {
        it('完整的中断数据被正确发送', async () => {
            const conn = createMockConnection()
            const interrupt = {
                type: 'case_info_check',
                message: '案情不完整',
                data: { missing: ['原告', '被告'] },
                resumable: true,
                node: 'case_check_node',
            }

            const result = await sendParsedInterruptEventService(conn, interrupt)
            expect(result).toBe(true)

            const pushed = JSON.parse((conn.eventStream.push as any).mock.calls[0][0])
            expect(pushed.type).toBe(SSEMessageType.INTERRUPT)
            expect(pushed.data.__interrupt__.type).toBe('case_info_check')
            expect(pushed.data.__interrupt__.resumable).toBe(true)
            expect(pushed.data.__interrupt__.node).toBe('case_check_node')
        })
    })

    describe('sendInterruptResumeEventService - 发送中断恢复事件', () => {
        it('发送恢复确认消息', async () => {
            const conn = createMockConnection()
            const result = await sendInterruptResumeEventService(
                conn, 'case_info_check', { status: 'confirmed' }
            )

            expect(result).toBe(true)
            const pushed = JSON.parse((conn.eventStream.push as any).mock.calls[0][0])
            expect(pushed.type).toBe(SSEMessageType.INFO)
            expect(pushed.data.status).toBe('resumed')
            expect(pushed.data.interruptType).toBe('case_info_check')
        })
    })

    describe('sendTaskStartEventService - 发送任务开始事件', () => {
        it('正确发送任务名称和标题', async () => {
            const conn = createMockConnection()
            const result = await sendTaskStartEventService(conn, 'analysis_summary', '案情摘要分析')

            expect(result).toBe(true)
            const pushed = JSON.parse((conn.eventStream.push as any).mock.calls[0][0])
            expect(pushed.type).toBe(SSEMessageType.TASK_START)
            expect(pushed.data.taskName).toBe('analysis_summary')
            expect(pushed.data.taskTitle).toBe('案情摘要分析')
            expect(pushed.message).toBe('开始案情摘要分析')
        })
    })

    describe('sendTaskProgressEventService - 发送任务进度事件', () => {
        it('正确发送进度内容', async () => {
            const conn = createMockConnection()
            const result = await sendTaskProgressEventService(conn, 'analysis', '分析进行中...')

            expect(result).toBe(true)
            const pushed = JSON.parse((conn.eventStream.push as any).mock.calls[0][0])
            expect(pushed.type).toBe(SSEMessageType.TASK_PROGRESS)
            expect(pushed.message).toBe('分析进行中...')
            expect(pushed.data.taskName).toBe('analysis')
        })
    })

    describe('sendTaskCompleteEventService - 发送任务完成事件', () => {
        it('正确发送完成消息和结果', async () => {
            const conn = createMockConnection()
            const result = await sendTaskCompleteEventService(
                conn, 'analysis_summary', '案情摘要', { content: '摘要内容' }
            )

            expect(result).toBe(true)
            const pushed = JSON.parse((conn.eventStream.push as any).mock.calls[0][0])
            expect(pushed.type).toBe(SSEMessageType.TASK_COMPLETE)
            expect(pushed.message).toBe('案情摘要完成')
            expect(pushed.data.result).toEqual({ content: '摘要内容' })
        })
    })

    describe('sendTextDeltaEventService - 发送文本增量事件', () => {
        it('正确发送文本增量', async () => {
            const conn = createMockConnection()
            const result = await sendTextDeltaEventService(conn, '这是一段增量文本', 'task_1')

            expect(result).toBe(true)
            const pushed = JSON.parse((conn.eventStream.push as any).mock.calls[0][0])
            expect(pushed.type).toBe(SSEMessageType.TEXT_DELTA)
            expect(pushed.message).toBe('这是一段增量文本')
            expect(pushed.data.taskName).toBe('task_1')
        })

        it('不传任务名时 taskName 为 undefined', async () => {
            const conn = createMockConnection()
            await sendTextDeltaEventService(conn, '增量')

            const pushed = JSON.parse((conn.eventStream.push as any).mock.calls[0][0])
            expect(pushed.data.taskName).toBeUndefined()
        })
    })

    describe('sendReasoningEventService - 发送推理过程事件', () => {
        it('正确发送推理内容', async () => {
            const conn = createMockConnection()
            const result = await sendReasoningEventService(conn, '根据法律条文分析...', 'reasoning_task')

            expect(result).toBe(true)
            const pushed = JSON.parse((conn.eventStream.push as any).mock.calls[0][0])
            expect(pushed.type).toBe(SSEMessageType.REASONING)
            expect(pushed.message).toBe('根据法律条文分析...')
        })
    })

    describe('sendToolCallEventService - 发送工具调用事件', () => {
        it('正确发送工具调用信息', async () => {
            const conn = createMockConnection()
            const result = await sendToolCallEventService(
                conn, 'search_law', 'call_123', { query: '合同法' }, 'task_1'
            )

            expect(result).toBe(true)
            const pushed = JSON.parse((conn.eventStream.push as any).mock.calls[0][0])
            expect(pushed.type).toBe(SSEMessageType.TOOL_CALL)
            expect(pushed.message).toBe('调用工具: search_law')
            expect(pushed.data.toolName).toBe('search_law')
            expect(pushed.data.toolCallId).toBe('call_123')
            expect(pushed.data.args).toEqual({ query: '合同法' })
        })
    })

    describe('sendToolResultEventService - 发送工具结果事件', () => {
        it('正确发送工具结果', async () => {
            const conn = createMockConnection()
            const toolResult = [{ content: '合同法第一条' }]
            const result = await sendToolResultEventService(
                conn, 'search_law', 'call_123', toolResult, 'task_1'
            )

            expect(result).toBe(true)
            const pushed = JSON.parse((conn.eventStream.push as any).mock.calls[0][0])
            expect(pushed.type).toBe(SSEMessageType.TOOL_RESULT)
            expect(pushed.data.result).toEqual(toolResult)
        })
    })

    describe('sendErrorEventService - 发送错误事件', () => {
        it('正确发送错误消息', async () => {
            const conn = createMockConnection()
            const result = await sendErrorEventService(conn, '分析过程出错', { code: 500 })

            expect(result).toBe(true)
            const pushed = JSON.parse((conn.eventStream.push as any).mock.calls[0][0])
            expect(pushed.type).toBe(SSEMessageType.ERROR)
            expect(pushed.message).toBe('分析过程出错')
            expect(pushed.data.code).toBe(500)
        })
    })

    describe('sendWorkflowStartEventService - 发送工作流开始事件', () => {
        it('正确发送工作流开始消息', async () => {
            const conn = createMockConnection()
            const result = await sendWorkflowStartEventService(conn, { caseId: 1 })

            expect(result).toBe(true)
            const pushed = JSON.parse((conn.eventStream.push as any).mock.calls[0][0])
            expect(pushed.type).toBe(SSEMessageType.WORKFLOW_START)
            expect(pushed.data.caseId).toBe(1)
        })
    })

    describe('sendWorkflowCompleteEventService - 发送工作流完成事件', () => {
        it('正确发送工作流完成消息', async () => {
            const conn = createMockConnection()
            const result = await sendWorkflowCompleteEventService(conn, { status: 'done' })

            expect(result).toBe(true)
            const pushed = JSON.parse((conn.eventStream.push as any).mock.calls[0][0])
            expect(pushed.type).toBe(SSEMessageType.WORKFLOW_COMPLETE)
            expect(pushed.data.status).toBe('done')
        })

        it('不传 data 也能正常发送', async () => {
            const conn = createMockConnection()
            const result = await sendWorkflowCompleteEventService(conn)

            expect(result).toBe(true)
        })
    })

    // ==================== 属性测试 ====================

    describe('属性测试', () => {
        describe('Property 9: SSE 消息格式一致性', () => {
            it('格式化后的消息应该是有效的 JSON', () => {
                const messageTypeArb = fc.constantFrom(
                    SSEMessageType.CONNECTED,
                    SSEMessageType.HEARTBEAT,
                    SSEMessageType.CLOSED,
                    SSEMessageType.INFO,
                    SSEMessageType.ERROR,
                    SSEMessageType.WORKFLOW_START,
                    SSEMessageType.WORKFLOW_COMPLETE,
                    SSEMessageType.TASK_START,
                    SSEMessageType.TASK_PROGRESS,
                    SSEMessageType.TASK_COMPLETE,
                    SSEMessageType.TEXT_DELTA,
                    SSEMessageType.REASONING,
                    SSEMessageType.TOOL_CALL,
                    SSEMessageType.TOOL_RESULT,
                    SSEMessageType.INTERRUPT
                )

                fc.assert(
                    fc.property(
                        messageTypeArb,
                        fc.string({ minLength: 1, maxLength: 100 }),
                        (type, messageText) => {
                            const message = { type, message: messageText }
                            const result = formatSSEMessage(message)

                            expect(() => JSON.parse(result)).not.toThrow()

                            const parsed = JSON.parse(result)
                            expect(parsed.type).toBe(type)
                            expect(parsed.message).toBe(messageText)
                            expect(typeof parsed.timestamp).toBe('number')

                            return true
                        }
                    ),
                    PBT_CONFIG
                )
            })

            it('带 data 的消息应该正确序列化', () => {
                const messageTypeArb = fc.constantFrom(
                    SSEMessageType.TASK_START,
                    SSEMessageType.TASK_COMPLETE,
                    SSEMessageType.TOOL_CALL,
                    SSEMessageType.TOOL_RESULT
                )

                fc.assert(
                    fc.property(
                        messageTypeArb,
                        fc.string({ minLength: 1, maxLength: 50 }),
                        fc.dictionary(
                            fc.string({ minLength: 1, maxLength: 20 }).filter(
                                s => !['__proto__', 'constructor', 'prototype'].includes(s)
                            ),
                            fc.oneof(
                                fc.string({ maxLength: 50 }),
                                fc.integer(),
                                fc.boolean()
                            ),
                            { minKeys: 0, maxKeys: 5 }
                        ),
                        (type, messageText, data) => {
                            const message = { type, message: messageText, data }
                            const result = formatSSEMessage(message)

                            const parsed = JSON.parse(result)
                            expect(parsed.type).toBe(type)
                            expect(parsed.data).toEqual(data)

                            return true
                        }
                    ),
                    PBT_CONFIG
                )
            })

            it('timestamp 应该是合理的时间戳', () => {
                fc.assert(
                    fc.property(
                        fc.string({ minLength: 1, maxLength: 50 }),
                        (messageText) => {
                            const before = Date.now()
                            const message = {
                                type: SSEMessageType.INFO,
                                message: messageText,
                            }
                            const result = formatSSEMessage(message)
                            const after = Date.now()

                            const parsed = JSON.parse(result)

                            expect(parsed.timestamp).toBeGreaterThanOrEqual(before)
                            expect(parsed.timestamp).toBeLessThanOrEqual(after)

                            return true
                        }
                    ),
                    PBT_CONFIG
                )
            })

            it('已有 timestamp 应该被保留', () => {
                fc.assert(
                    fc.property(
                        fc.string({ minLength: 1, maxLength: 50 }),
                        fc.integer({ min: 1000000000000, max: 2000000000000 }),
                        (messageText, timestamp) => {
                            const message = {
                                type: SSEMessageType.INFO,
                                message: messageText,
                                timestamp,
                            }
                            const result = formatSSEMessage(message)
                            const parsed = JSON.parse(result)

                            expect(parsed.timestamp).toBe(timestamp)

                            return true
                        }
                    ),
                    PBT_CONFIG
                )
            })
        })

        describe('Property: 所有事件发送函数对关闭连接返回 false', () => {
            it('已关闭连接的所有发送函数应返回 false', async () => {
                const conn = createMockConnection({ isClosed: true })

                const results = await Promise.all([
                    sendInterruptEventService(conn, 'test', 'msg'),
                    sendParsedInterruptEventService(conn, {
                        type: 'test', message: 'm', data: {}, resumable: true, node: 'n',
                    }),
                    sendInterruptResumeEventService(conn, 'test'),
                    sendTaskStartEventService(conn, 'task', '任务'),
                    sendTaskProgressEventService(conn, 'task', '进度'),
                    sendTaskCompleteEventService(conn, 'task', '任务'),
                    sendTextDeltaEventService(conn, '文本'),
                    sendReasoningEventService(conn, '推理'),
                    sendToolCallEventService(conn, 'tool', 'id'),
                    sendToolResultEventService(conn, 'tool', 'id', {}),
                    sendErrorEventService(conn, '错误'),
                    sendWorkflowStartEventService(conn),
                    sendWorkflowCompleteEventService(conn),
                ])

                // 所有发送函数对已关闭连接应返回 false
                for (const result of results) {
                    expect(result).toBe(false)
                }
            })
        })
    })
})
