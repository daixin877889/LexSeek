/**
 * dateContext middleware 单测
 *
 * 关键验证：
 *  - 每轮都注入 ephemeral HumanMessage（与 userInjection 同款，不污染 state）
 *  - 注入内容是"当前北京时间：YYYY-MM-DD 周X"日级粒度（user 侧 cache 友好）
 *  - 末尾 HumanMessage 之前插入；无 HumanMessage 时 fallback 到末尾追加
 *  - 系统时钟由 vi.useFakeTimers 锚定，避免依赖真实时间
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages'

;(globalThis as any).logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }

import {
    dateContextMiddleware,
    formatCurrentDate,
    formatCurrentDateWithWeekday,
} from '~~/server/services/agent-platform/middleware/dateContext.middleware'

async function invoke(opts: {
    messages: any[]
    timezone?: string
    handlerReturn?: any
}) {
    const mw = dateContextMiddleware({ timezone: opts.timezone })
    const handler = vi.fn().mockResolvedValue(opts.handlerReturn ?? { ok: true })
    const request = { messages: opts.messages, foo: 'bar' } as any
    const result = await (mw as any).wrapModelCall(request, handler)
    return { result, handler, originalMessages: opts.messages }
}

describe('dateContextMiddleware', () => {
    // UTC 2026-05-21 06:32 = 北京时间 2026-05-21 14:32 周四
    const FIXED_NOW = new Date('2026-05-21T06:32:00Z')

    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(FIXED_NOW)
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('在最末 HumanMessage 之前插入 ephemeral HumanMessage', async () => {
        const sys = new SystemMessage('s')
        const u1 = new HumanMessage('第一轮')
        const a1 = new AIMessage('回答')
        const u2 = new HumanMessage('第二轮')

        const { handler, originalMessages } = await invoke({
            messages: [sys, u1, a1, u2],
        })

        const callArg = handler.mock.calls[0]![0]
        expect(callArg.messages).toHaveLength(5)
        expect(callArg.messages[0]).toBe(sys)
        expect(callArg.messages[1]).toBe(u1)
        expect(callArg.messages[2]).toBe(a1)
        expect(callArg.messages[3].getType()).toBe('human')
        expect(callArg.messages[3].content).toBe('当前北京时间：2026-05-21 周四')
        expect(callArg.messages[4]).toBe(u2)

        expect(originalMessages).toHaveLength(4)
    })

    it('无 HumanMessage 时 fallback 到末尾追加', async () => {
        const sys = new SystemMessage('s')
        const a1 = new AIMessage('answer')

        const { handler } = await invoke({ messages: [sys, a1] })

        const callArg = handler.mock.calls[0]![0]
        expect(callArg.messages).toHaveLength(3)
        expect(callArg.messages[2].getType()).toBe('human')
        expect(callArg.messages[2].content).toBe('当前北京时间：2026-05-21 周四')
    })

    it('保留 request 其它字段，仅替换 messages', async () => {
        const { handler } = await invoke({ messages: [new HumanMessage('hi')] })

        const callArg = handler.mock.calls[0]![0]
        expect(callArg.foo).toBe('bar')
        expect(callArg.messages).toHaveLength(2)
    })

    it('formatCurrentDate 返回北京时区日级字符串', () => {
        expect(formatCurrentDate()).toBe('2026-05-21')
    })

    it('formatCurrentDateWithWeekday 返回带星期', () => {
        expect(formatCurrentDateWithWeekday()).toBe('2026-05-21 周四')
    })

    it('系统时钟跨日时注入内容跟着变（不缓存当日值）', async () => {
        const first = await invoke({ messages: [new HumanMessage('hi')] })
        expect(first.handler.mock.calls[0]![0].messages[0].content).toBe('当前北京时间：2026-05-21 周四')

        // 推进系统时间到下一天
        vi.setSystemTime(new Date('2026-05-22T06:32:00Z'))
        const second = await invoke({ messages: [new HumanMessage('hi')] })
        expect(second.handler.mock.calls[0]![0].messages[0].content).toBe('当前北京时间：2026-05-22 周五')
    })
})
