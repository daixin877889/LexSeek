/**
 * 初始化分析 SSE 短路路径纯函数单元测试
 *
 * 目标：完成/失败/取消态 run 的 SSE 重连可以跳过 Redis Stream 全量 replay，
 * 直接从 checkpoint 读快照发一条 values + status_change 后关闭。
 *
 * 被测函数：
 * - canShortCircuitSSE(runStatus): 判定给定 run 状态是否允许走短路
 * - buildTerminalSnapshotEvents(params): 构造短路路径要发送的 SSE 事件字符串
 */

import { describe, it, expect } from 'vitest'
import {
    canShortCircuitSSE,
    buildTerminalSnapshotEvents,
} from '../../../server/services/case/initAnalysis.service'

describe('canShortCircuitSSE', () => {
    describe('可以短路的终态', () => {
        it('completed 状态允许短路', () => {
            expect(canShortCircuitSSE('completed')).toBe(true)
        })

        it('failed 状态允许短路', () => {
            expect(canShortCircuitSSE('failed')).toBe(true)
        })

        it('cancelled 状态允许短路', () => {
            expect(canShortCircuitSSE('cancelled')).toBe(true)
        })
    })

    describe('必须保留原 replay 路径的状态', () => {
        it('interrupted 状态不允许短路（__interrupt__ 只在 Redis Stream 最后一条 values 里）', () => {
            expect(canShortCircuitSSE('interrupted')).toBe(false)
        })

        it('running 状态不允许短路（需继续订阅 pubsub 接收后续事件）', () => {
            expect(canShortCircuitSSE('running')).toBe(false)
        })

        it('pending 状态不允许短路（Worker 尚未开始发事件）', () => {
            expect(canShortCircuitSSE('pending')).toBe(false)
        })
    })

    describe('未知/缺失状态保守拒绝', () => {
        it('null 不允许短路', () => {
            expect(canShortCircuitSSE(null)).toBe(false)
        })

        it('undefined 不允许短路', () => {
            expect(canShortCircuitSSE(undefined)).toBe(false)
        })

        it('未识别的字符串不允许短路', () => {
            expect(canShortCircuitSSE('unknown-state')).toBe(false)
        })

        it('空字符串不允许短路', () => {
            expect(canShortCircuitSSE('')).toBe(false)
        })
    })
})

describe('buildTerminalSnapshotEvents', () => {
    /** 解析一条 SSE 事件字符串为 { event, data } */
    function parseSSE(raw: string): { event: string; data: unknown } {
        const lines = raw.trimEnd().split('\n')
        const event = lines.find(l => l.startsWith('event: '))?.slice('event: '.length) ?? ''
        const dataLine = lines.find(l => l.startsWith('data: '))?.slice('data: '.length) ?? ''
        return { event, data: JSON.parse(dataLine) }
    }

    describe('completed 状态', () => {
        it('checkpoint 有 messages 时返回 [values, status_change] 两条事件', () => {
            const events = buildTerminalSnapshotEvents({
                runId: 'run-abc',
                runStatus: 'completed',
                checkpointValues: {
                    messages: [{ type: 'human', content: '你好' }],
                    result: { summary: '案情摘要' },
                },
                errorMessage: null,
            })

            expect(events).toHaveLength(2)
            const valuesEvt = parseSSE(events[0]!)
            expect(valuesEvt.event).toBe('values')
            expect(valuesEvt.data).toMatchObject({
                messages: [{ type: 'human', content: '你好' }],
                result: { summary: '案情摘要' },
            })

            const statusEvt = parseSSE(events[1]!)
            expect(statusEvt.event).toBe('custom')
            expect(statusEvt.data).toEqual({
                type: 'status_change',
                runId: 'run-abc',
                status: 'completed',
            })
        })

        it('checkpoint 无 messages 时只返回 status_change 一条', () => {
            const events = buildTerminalSnapshotEvents({
                runId: 'run-abc',
                runStatus: 'completed',
                checkpointValues: { messages: [] },
                errorMessage: null,
            })

            expect(events).toHaveLength(1)
            const statusEvt = parseSSE(events[0]!)
            expect(statusEvt.event).toBe('custom')
            expect(statusEvt.data).toMatchObject({ type: 'status_change', status: 'completed' })
        })

        it('checkpoint 为 null 时只返回 status_change 一条', () => {
            const events = buildTerminalSnapshotEvents({
                runId: 'run-abc',
                runStatus: 'completed',
                checkpointValues: null,
                errorMessage: null,
            })

            expect(events).toHaveLength(1)
            const statusEvt = parseSSE(events[0]!)
            expect(statusEvt.event).toBe('custom')
            expect(statusEvt.data).toMatchObject({ type: 'status_change', status: 'completed' })
        })

        it('completed 状态即使提供 errorMessage 也不应附加 error 字段', () => {
            const events = buildTerminalSnapshotEvents({
                runId: 'run-abc',
                runStatus: 'completed',
                checkpointValues: null,
                errorMessage: '不应出现',
            })

            const statusEvt = parseSSE(events[0]!)
            expect((statusEvt.data as any).error).toBeUndefined()
        })
    })

    describe('failed 状态', () => {
        it('有 errorMessage 时 status_change 携带 error 字段', () => {
            const events = buildTerminalSnapshotEvents({
                runId: 'run-x',
                runStatus: 'failed',
                checkpointValues: null,
                errorMessage: '积分不足',
            })

            const statusEvt = parseSSE(events[events.length - 1]!)
            expect(statusEvt.data).toEqual({
                type: 'status_change',
                runId: 'run-x',
                status: 'failed',
                error: '积分不足',
            })
        })

        it('errorMessage 为 null 时 status_change 不携带 error 字段', () => {
            const events = buildTerminalSnapshotEvents({
                runId: 'run-x',
                runStatus: 'failed',
                checkpointValues: null,
                errorMessage: null,
            })

            const statusEvt = parseSSE(events[events.length - 1]!)
            expect((statusEvt.data as any).error).toBeUndefined()
        })

        it('errorMessage 为空字符串时不携带 error 字段', () => {
            const events = buildTerminalSnapshotEvents({
                runId: 'run-x',
                runStatus: 'failed',
                checkpointValues: null,
                errorMessage: '',
            })

            const statusEvt = parseSSE(events[events.length - 1]!)
            expect((statusEvt.data as any).error).toBeUndefined()
        })
    })

    describe('cancelled 状态', () => {
        it('不附加 error 字段（取消是用户行为，无错误语义）', () => {
            const events = buildTerminalSnapshotEvents({
                runId: 'run-y',
                runStatus: 'cancelled',
                checkpointValues: null,
                errorMessage: '不该出现',
            })

            const statusEvt = parseSSE(events[events.length - 1]!)
            expect(statusEvt.data).toEqual({
                type: 'status_change',
                runId: 'run-y',
                status: 'cancelled',
            })
        })
    })

    describe('SSE 报文格式', () => {
        it('每条事件以 \\n\\n 结尾', () => {
            const events = buildTerminalSnapshotEvents({
                runId: 'r',
                runStatus: 'completed',
                checkpointValues: { messages: [{ type: 'ai', content: 'x' }] },
                errorMessage: null,
            })
            for (const evt of events) {
                expect(evt.endsWith('\n\n')).toBe(true)
            }
        })

        it('values 事件的 data 是可反序列化的 JSON', () => {
            const payload = { messages: [{ type: 'human', content: '带中文/换行\n测试' }], result: {} }
            const events = buildTerminalSnapshotEvents({
                runId: 'r',
                runStatus: 'completed',
                checkpointValues: payload,
                errorMessage: null,
            })
            const valuesEvt = events[0]!
            const dataStr = valuesEvt.split('\n').find(l => l.startsWith('data: '))!.slice('data: '.length)
            expect(() => JSON.parse(dataStr)).not.toThrow()
            expect(JSON.parse(dataStr)).toEqual(payload)
        })
    })
})
