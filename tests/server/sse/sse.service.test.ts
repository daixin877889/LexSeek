/**
 * SSE 服务测试
 *
 * **Feature: server-test-coverage**
 * **Validates: Requirements 5.1, 5.4, 5.5, 5.6, 5.8, 5.9**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { formatSSEMessage } from '../../../server/services/sse/sse.service'
import { SSEMessageType } from '../../../shared/types/case'

/** 属性测试配置 */
const PBT_CONFIG = { numRuns: 100 }

describe('SSE 服务', () => {
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

                            // 验证是有效的 JSON
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

                            // timestamp 应该在调用前后的时间范围内
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
                        fc.integer({ min: 1000000000000, max: 2000000000000 }), // 合理的时间戳范围
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
    })
})
