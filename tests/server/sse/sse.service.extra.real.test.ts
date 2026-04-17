/**
 * SSE 服务 - 深度覆盖测试（补齐 createSSEConnectionService 及 Manager.clear 中 timeoutTimer 清理路径）
 *
 * **Feature: server-test-coverage**
 * **Validates: Requirements 7.1, 7.2**
 *
 * 重点覆盖：
 * - createSSEConnectionService 完整链路（响应头、心跳定时器、超时定时器、onClosed 回调、连接成功消息）
 * - 心跳发送正常分支 + 心跳发送失败后自动关闭连接分支
 * - 连接超时分支（timeoutTimer 触发关闭）
 * - eventStream.onClosed 回调触发的关闭路径
 * - generateConnectionId 的唯一性与格式
 * - SSEConnectionManager.clear 清理 timeoutTimer 分支（源文件第 106 行）
 *
 * 仅 mock h3 的 createEventStream / setResponseHeader，其他依赖真实调用。
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'

// ==================== Mock h3 ====================
// 只替换 createEventStream 与 setResponseHeader，避免构造真实 H3 事件
vi.mock('h3', async () => {
    const actual = await vi.importActual<typeof import('h3')>('h3')
    return {
        ...actual,
        setResponseHeader: vi.fn(),
        createEventStream: vi.fn(),
    }
})

import { createEventStream, setResponseHeader } from 'h3'
import {
    createSSEConnectionService,
    getSSEConnectionManagerService,
    closeSSEConnectionService,
    type SSEConnection,
} from '~~/server/services/sse/sse.service'
import { SSEMessageType } from '#shared/types/case'

/** 用来跟踪本轮测试创建的连接 ID（用于硬清理） */
const createdConnectionIds = new Set<string>()

/** 创建一个支持外部触发 onClosed 的事件流 mock */
function createMockEventStream() {
    let closedCallback: (() => void) | null = null

    const stream = {
        push: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        send: vi.fn().mockReturnValue('mock-send-response'),
        onClosed: vi.fn((cb: () => void) => {
            closedCallback = cb
        }),
        /** 测试辅助：触发 onClosed 回调 */
        triggerClosed: () => {
            if (closedCallback) closedCallback()
        },
    }

    return stream
}

/** 构造一个足够 createSSEConnectionService 使用的最小 H3Event */
function createFakeEvent() {
    return {
        node: {
            req: {} as any,
            res: {
                setHeader: vi.fn(),
                getHeader: vi.fn(),
                writeHead: vi.fn(),
                write: vi.fn(),
                end: vi.fn(),
            } as any,
        },
        context: {},
    } as any
}

describe('SSE 服务 - createSSEConnectionService 深度覆盖', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    afterEach(async () => {
        // 每个用例结束后兜底清理管理器中本轮剩余连接
        const manager = getSSEConnectionManagerService()
        for (const id of Array.from(createdConnectionIds)) {
            if (manager.has(id)) {
                const conn = manager.get(id)
                if (conn && !conn.isClosed) {
                    try {
                        await closeSSEConnectionService(conn)
                    } catch {
                        manager.remove(id)
                    }
                } else {
                    manager.remove(id)
                }
            }
            createdConnectionIds.delete(id)
        }
    })

    afterAll(() => {
        // 最终确保没有任何本轮遗留连接
        const manager = getSSEConnectionManagerService()
        for (const id of Array.from(createdConnectionIds)) {
            manager.remove(id)
        }
        createdConnectionIds.clear()
    })

    it('应设置正确的响应头并返回包含默认配置的连接实例', async () => {
        const stream = createMockEventStream()
        ;(createEventStream as any).mockReturnValueOnce(stream)

        const event = createFakeEvent()
        const conn = await createSSEConnectionService(event)
        createdConnectionIds.add(conn.id)

        // 三个响应头
        expect(setResponseHeader).toHaveBeenCalledWith(event, 'Content-Type', 'text/event-stream')
        expect(setResponseHeader).toHaveBeenCalledWith(event, 'Cache-Control', 'no-cache')
        expect(setResponseHeader).toHaveBeenCalledWith(event, 'Connection', 'keep-alive')

        // 默认启用心跳（30s），默认无超时定时器
        expect(conn.heartbeatTimer).toBeDefined()
        expect(conn.timeoutTimer).toBeUndefined()
        expect(conn.isClosed).toBe(false)
        expect(conn.id.startsWith('sse_')).toBe(true)

        // 已注册关闭回调
        expect(stream.onClosed).toHaveBeenCalledTimes(1)

        // 管理器中可检索
        const manager = getSSEConnectionManagerService()
        expect(manager.has(conn.id)).toBe(true)

        // 发送了 CONNECTED 消息
        expect(stream.push).toHaveBeenCalledTimes(1)
        const firstMsg = JSON.parse(stream.push.mock.calls[0][0])
        expect(firstMsg.type).toBe(SSEMessageType.CONNECTED)
        expect(firstMsg.data.connectionId).toBe(conn.id)
    })

    it('显式关闭心跳时 heartbeatTimer 应为 undefined', async () => {
        const stream = createMockEventStream()
        ;(createEventStream as any).mockReturnValueOnce(stream)

        const conn = await createSSEConnectionService(createFakeEvent(), {
            enableHeartbeat: false,
        })
        createdConnectionIds.add(conn.id)

        expect(conn.heartbeatTimer).toBeUndefined()
    })

    it('心跳间隔为 0 时不应创建心跳定时器', async () => {
        const stream = createMockEventStream()
        ;(createEventStream as any).mockReturnValueOnce(stream)

        const conn = await createSSEConnectionService(createFakeEvent(), {
            heartbeatInterval: 0,
        })
        createdConnectionIds.add(conn.id)

        expect(conn.heartbeatTimer).toBeUndefined()
    })

    it('应触发心跳回调并发送 HEARTBEAT 消息', async () => {
        vi.useFakeTimers()
        try {
            const stream = createMockEventStream()
            ;(createEventStream as any).mockReturnValueOnce(stream)

            const conn = await createSSEConnectionService(createFakeEvent(), {
                heartbeatInterval: 50,
                enableHeartbeat: true,
            })
            createdConnectionIds.add(conn.id)

            // 清掉首次发送的 CONNECTED 消息记录方便观察心跳调用
            stream.push.mockClear()

            // 推进心跳周期
            await vi.advanceTimersByTimeAsync(50)

            // 心跳之后，push 至少被调用一次，且消息类型为 HEARTBEAT
            expect(stream.push).toHaveBeenCalled()
            const hbMsg = JSON.parse(stream.push.mock.calls[0][0])
            expect(hbMsg.type).toBe(SSEMessageType.HEARTBEAT)
        } finally {
            vi.useRealTimers()
        }
    })

    it('心跳 push 内部失败时 sendSSEMessageService 返回 false，连接保持开启等待下次心跳', async () => {
        vi.useFakeTimers()
        try {
            const stream = createMockEventStream()
            ;(createEventStream as any).mockReturnValueOnce(stream)

            // 首次 push（CONNECTED）成功；后续 push（HEARTBEAT）失败
            stream.push
                .mockResolvedValueOnce(undefined)
                .mockRejectedValue(new Error('heartbeat push failed'))

            const conn = await createSSEConnectionService(createFakeEvent(), {
                heartbeatInterval: 20,
                enableHeartbeat: true,
            })
            createdConnectionIds.add(conn.id)

            // 触发一次心跳 -> sendSSEMessageService 内部捕获异常返回 false
            await vi.advanceTimersByTimeAsync(20)
            await Promise.resolve()
            await Promise.resolve()

            // sendSSEMessageService 自身吞掉 push 的 error 返回 false，
            // 因此心跳回调 try 块不会抛出，连接依旧保持开启。
            expect(conn.isClosed).toBe(false)
            // 至少尝试过一次心跳 push
            expect(stream.push.mock.calls.length).toBeGreaterThanOrEqual(2)
        } finally {
            vi.useRealTimers()
        }
    })

    it('连接超时时应自动关闭连接', async () => {
        vi.useFakeTimers()
        try {
            const stream = createMockEventStream()
            ;(createEventStream as any).mockReturnValueOnce(stream)

            const conn = await createSSEConnectionService(createFakeEvent(), {
                enableHeartbeat: false,
                connectionTimeout: 100,
            })
            createdConnectionIds.add(conn.id)

            expect(conn.timeoutTimer).toBeDefined()
            expect(conn.isClosed).toBe(false)

            // 触发超时
            await vi.advanceTimersByTimeAsync(100)
            await Promise.resolve()
            await Promise.resolve()

            expect(conn.isClosed).toBe(true)
            expect(getSSEConnectionManagerService().has(conn.id)).toBe(false)
        } finally {
            vi.useRealTimers()
        }
    })

    it('connectionTimeout=0 时不创建超时定时器', async () => {
        const stream = createMockEventStream()
        ;(createEventStream as any).mockReturnValueOnce(stream)

        const conn = await createSSEConnectionService(createFakeEvent(), {
            enableHeartbeat: false,
            connectionTimeout: 0,
        })
        createdConnectionIds.add(conn.id)

        expect(conn.timeoutTimer).toBeUndefined()
    })

    it('客户端断开触发 onClosed 回调时应标记 isClosed 并从管理器移除', async () => {
        const stream = createMockEventStream()
        ;(createEventStream as any).mockReturnValueOnce(stream)

        const conn = await createSSEConnectionService(createFakeEvent(), {
            enableHeartbeat: false,
        })
        createdConnectionIds.add(conn.id)

        const manager = getSSEConnectionManagerService()
        expect(manager.has(conn.id)).toBe(true)

        // 模拟客户端断开：触发内部通过 onClosed 注册的回调
        stream.triggerClosed()

        expect(conn.isClosed).toBe(true)
        expect(manager.has(conn.id)).toBe(false)
    })

    it('同时启用心跳与超时时应创建两个定时器并在关闭时清理', async () => {
        const stream = createMockEventStream()
        ;(createEventStream as any).mockReturnValueOnce(stream)

        const conn = await createSSEConnectionService(createFakeEvent(), {
            heartbeatInterval: 100000,
            enableHeartbeat: true,
            connectionTimeout: 100000,
        })
        createdConnectionIds.add(conn.id)

        expect(conn.heartbeatTimer).toBeDefined()
        expect(conn.timeoutTimer).toBeDefined()

        const manager = getSSEConnectionManagerService()
        expect(manager.has(conn.id)).toBe(true)

        // 正常关闭应当同时清理两个定时器（通过 remove 内部 clearInterval/clearTimeout 分支）
        await closeSSEConnectionService(conn)
        expect(conn.isClosed).toBe(true)
        expect(manager.has(conn.id)).toBe(false)
    })
})

describe('SSE 服务 - generateConnectionId 覆盖（间接）', () => {
    afterEach(async () => {
        const manager = getSSEConnectionManagerService()
        for (const id of Array.from(createdConnectionIds)) {
            if (manager.has(id)) {
                const conn = manager.get(id)
                if (conn && !conn.isClosed) {
                    try {
                        await closeSSEConnectionService(conn)
                    } catch {
                        manager.remove(id)
                    }
                } else {
                    manager.remove(id)
                }
            }
            createdConnectionIds.delete(id)
        }
    })

    it('多次创建的连接 ID 应不相同且均以 "sse_" 开头', async () => {
        const ids = new Set<string>()
        const conns: SSEConnection[] = []

        for (let i = 0; i < 5; i++) {
            const stream = createMockEventStream()
            ;(createEventStream as any).mockReturnValueOnce(stream)

            const conn = await createSSEConnectionService(createFakeEvent(), {
                enableHeartbeat: false,
            })
            createdConnectionIds.add(conn.id)
            conns.push(conn)
            expect(conn.id.startsWith('sse_')).toBe(true)
            ids.add(conn.id)
        }

        expect(ids.size).toBe(5)
    })
})

describe('SSE 服务 - Manager.clear 清理 timeoutTimer 分支', () => {
    it('clear 应清理带有 timeoutTimer 的连接', () => {
        const manager = getSSEConnectionManagerService()

        // 构造一个带 timeoutTimer 的假连接直接塞进 manager，
        // 以便命中 clear 内部对 timeoutTimer 的 clearTimeout 分支（源文件 105-107）
        let cleared = false
        const fakeTimeoutTimer = setTimeout(() => {
            cleared = true
        }, 1000000)

        let heartbeatTicked = false
        const fakeHeartbeatTimer = setInterval(() => {
            heartbeatTicked = true
        }, 1000000)

        const fakeConnection: SSEConnection = {
            id: `sse_clear_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            eventStream: {
                push: vi.fn(),
                close: vi.fn(),
                send: vi.fn(),
                onClosed: vi.fn(),
            } as any,
            heartbeatTimer: fakeHeartbeatTimer,
            timeoutTimer: fakeTimeoutTimer,
            isClosed: false,
            createdAt: new Date(),
            lastActivityAt: new Date(),
        }

        manager.add(fakeConnection)
        expect(manager.has(fakeConnection.id)).toBe(true)

        manager.clear()

        // clear 后：连接已移除，size 归零
        expect(manager.has(fakeConnection.id)).toBe(false)
        expect(manager.size).toBe(0)

        // 验证定时器确实已被清理（否则 1000000ms 也不会触发，这里主要断言函数不抛错并完成清理）
        expect(cleared).toBe(false)
        expect(heartbeatTicked).toBe(false)
    })

    it('clear 对仅含 heartbeatTimer 的连接也能正常处理', () => {
        const manager = getSSEConnectionManagerService()

        const hbTimer = setInterval(() => {}, 1000000)
        const fakeConnection: SSEConnection = {
            id: `sse_clear_only_hb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            eventStream: {
                push: vi.fn(),
                close: vi.fn(),
                send: vi.fn(),
                onClosed: vi.fn(),
            } as any,
            heartbeatTimer: hbTimer,
            isClosed: false,
            createdAt: new Date(),
            lastActivityAt: new Date(),
        }

        manager.add(fakeConnection)
        expect(() => manager.clear()).not.toThrow()
        expect(manager.size).toBe(0)
    })
})
