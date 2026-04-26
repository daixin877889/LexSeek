/**
 * 中间件优先级工具 / safetyTrim 中间件 单元测试
 *
 * 覆盖：
 * - `workflow/middleware/types.ts` 的 buildMiddlewareStack：
 *   排序、互斥校验、相同优先级保持注册顺序
 * - `workflow/middleware/safetyTrim.middleware.ts` 的 safetyTrimMiddleware：
 *   不超预算时直接返回、超预算时走 compressMessages → safetyTrimMessages 两道防线、
 *   compressMessages 抛异常时降级、splice 原地修改 state.messages
 *
 * **Feature: workflow-middleware-stack**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HumanMessage } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'
import {
    buildMiddlewareStack,
    MIDDLEWARE_NAMES,
    MIDDLEWARE_PRIORITY,
    type MiddlewareWithPriority,
} from '../../../../server/services/workflow/middleware/types'
import { safetyTrimMiddleware } from '../../../../server/services/workflow/middleware/safetyTrim.middleware'

// 确保 logger 可用（Nuxt 自动导入在直接 import 的测试环境下可能缺失）
if (typeof (globalThis as { logger?: unknown }).logger === 'undefined') {
    ;(globalThis as Record<string, unknown>).logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    }
}

describe('buildMiddlewareStack - 中间件优先级栈', () => {
    /** 构造最小可比对的 fake middleware（不需要真 AgentMiddleware 接口，
        buildMiddlewareStack 只读 priority / name，只把 middleware 原样输出） */
    const fake = (name: string): MiddlewareWithPriority['middleware'] => ({ name } as unknown as MiddlewareWithPriority['middleware'])

    it('按 priority 升序排列', () => {
        const items: MiddlewareWithPriority[] = [
            { name: 'c', priority: 30, middleware: fake('c') },
            { name: 'a', priority: 10, middleware: fake('a') },
            { name: 'b', priority: 20, middleware: fake('b') },
        ]
        const stack = buildMiddlewareStack(items)
        expect(stack.map(m => (m as unknown as { name: string }).name)).toEqual(['a', 'b', 'c'])
    })

    it('相同优先级应保持注册顺序（稳定排序）', () => {
        const items: MiddlewareWithPriority[] = [
            { name: 'first', priority: 10, middleware: fake('first') },
            { name: 'second', priority: 10, middleware: fake('second') },
            { name: 'third', priority: 10, middleware: fake('third') },
        ]
        const stack = buildMiddlewareStack(items)
        expect(stack.map(m => (m as unknown as { name: string }).name)).toEqual(['first', 'second', 'third'])
    })

    it('caseMaterialContext 和 moduleContext 同时挂载时抛错', () => {
        const items: MiddlewareWithPriority[] = [
            {
                name: MIDDLEWARE_NAMES.MATERIAL_CONTEXT,
                priority: MIDDLEWARE_PRIORITY.MATERIAL_CONTEXT,
                middleware: fake('mc'),
            },
            {
                name: MIDDLEWARE_NAMES.MODULE_CONTEXT,
                priority: MIDDLEWARE_PRIORITY.MODULE_CONTEXT,
                middleware: fake('modc'),
            },
        ]
        expect(() => buildMiddlewareStack(items)).toThrow(/不能同时挂载/)
    })

    it('只挂载一个上下文中间件时不抛错', () => {
        const itemsMaterial: MiddlewareWithPriority[] = [{
            name: MIDDLEWARE_NAMES.MATERIAL_CONTEXT,
            priority: MIDDLEWARE_PRIORITY.MATERIAL_CONTEXT,
            middleware: fake('mc'),
        }]
        expect(() => buildMiddlewareStack(itemsMaterial)).not.toThrow()

        const itemsModule: MiddlewareWithPriority[] = [{
            name: MIDDLEWARE_NAMES.MODULE_CONTEXT,
            priority: MIDDLEWARE_PRIORITY.MODULE_CONTEXT,
            middleware: fake('modc'),
        }]
        expect(() => buildMiddlewareStack(itemsModule)).not.toThrow()
    })

    it('空列表返回空数组', () => {
        expect(buildMiddlewareStack([])).toEqual([])
    })

    it('MIDDLEWARE_PRIORITY 常量值规约：业务级中间件 10 的倍数 + 前置兜底允许小数值占位', () => {
        const values = Object.values(MIDDLEWARE_PRIORITY) as number[]
        // 业务方在 PROCESS_MATERIAL(10) 之前预留了 1/5/7 三个前置位（MESSAGE_INTEGRITY、SCOPE_GUARD、TOOL_CALL_LIMIT），
        // 它们必须比业务中间件更先执行，因此放弃"全是 10 的倍数"的旧约定，改为：
        //   - 严格小于 10 的"前置兜底中间件"允许任意正整数占位（最多 9 个槽）
        //   - >= 10 的业务中间件必须是 10 的倍数（保留 10 间隔的扩展空间）
        for (const v of values) {
            expect(v).toBeGreaterThan(0)
            if (v >= 10) {
                expect(v % 10).toBe(0)
            }
        }
        // MATERIAL_CONTEXT 与 MODULE_CONTEXT 相同（互斥设计的直接后果）
        expect(MIDDLEWARE_PRIORITY.MATERIAL_CONTEXT).toBe(MIDDLEWARE_PRIORITY.MODULE_CONTEXT)
    })
})

describe('safetyTrimMiddleware - 安全截断中间件', () => {
    /**
     * createMiddleware 返回一个带 beforeAgent / wrapModelCall 等钩子的对象。
     * 我们不关心 LangChain 内部结构，只从 factory 输出里取 beforeAgent.hook 验证行为。
     */
    const getHook = (mw: unknown): ((state: { messages: BaseMessage[] }) => Promise<unknown>) => {
        const middleware = mw as { beforeAgent?: { hook: (state: { messages: BaseMessage[] }) => Promise<unknown> } }
        if (!middleware.beforeAgent?.hook) {
            throw new Error('测试预期 middleware.beforeAgent.hook 存在')
        }
        return middleware.beforeAgent.hook
    }

    const fakeModel = {} as unknown as import('@langchain/core/language_models/chat_models').BaseChatModel

    beforeEach(() => {
        vi.resetModules()
    })

    afterEach(() => {
        vi.doUnmock('../../../../server/services/workflow/context/messageCompressor')
    })

    it('estimated tokens <= maxTokens 时直接返回，不修改 state.messages', async () => {
        const { safetyTrimMiddleware } = await import('../../../../server/services/workflow/middleware/safetyTrim.middleware')
        const mw = safetyTrimMiddleware({ model: fakeModel, maxTokens: 100_000 })
        const hook = getHook(mw)

        const messages = [new HumanMessage('hello world')]
        const state = { messages }
        await hook(state)
        // 消息数组未被 splice 修改
        expect(state.messages).toBe(messages)
        expect(state.messages).toHaveLength(1)
        expect(state.messages[0]!.content).toBe('hello world')
    })

    it('estimated tokens > maxTokens 时调用 compressMessages 压缩后 splice 原地替换', async () => {
        vi.doMock('../../../../server/services/workflow/context/messageCompressor', () => ({
            // estimateMessagesTokens 返回 10000 触发截断；压缩后返回 100（< maxTokens）
            estimateMessagesTokens: vi.fn((msgs: BaseMessage[]) => {
                if (msgs.length > 1) return 10_000
                return 100
            }),
            compressMessages: vi.fn(async () => [new HumanMessage('[摘要]')]),
            safetyTrimMessages: vi.fn(async (msgs: BaseMessage[]) => msgs),
        }))

        const { safetyTrimMiddleware } = await import('../../../../server/services/workflow/middleware/safetyTrim.middleware')
        const mw = safetyTrimMiddleware({ model: fakeModel, maxTokens: 1000 })
        const hook = getHook(mw)

        const originalArr = [
            new HumanMessage('a'.repeat(500)),
            new HumanMessage('b'.repeat(500)),
        ]
        const state = { messages: originalArr }
        await hook(state)

        // splice 原地修改：引用仍是 originalArr，内容已替换为摘要
        expect(state.messages).toBe(originalArr)
        expect(state.messages).toHaveLength(1)
        expect(state.messages[0]!.content).toBe('[摘要]')
    })

    it('compressMessages 抛异常时兜底走 safetyTrimMessages', async () => {
        vi.doMock('../../../../server/services/workflow/context/messageCompressor', () => ({
            estimateMessagesTokens: vi.fn((msgs: BaseMessage[]) => {
                // 第一次（入口检查）返回 10000；safetyTrim 后再次检查返回 500
                if (msgs.length > 1) return 10_000
                return 500
            }),
            compressMessages: vi.fn(async () => {
                throw new Error('summary unavailable')
            }),
            safetyTrimMessages: vi.fn(async () => [new HumanMessage('[trimmed]')]),
        }))

        const { safetyTrimMiddleware } = await import('../../../../server/services/workflow/middleware/safetyTrim.middleware')
        const mw = safetyTrimMiddleware({ model: fakeModel, maxTokens: 1000 })
        const hook = getHook(mw)

        const state = {
            messages: [
                new HumanMessage('x'.repeat(1000)),
                new HumanMessage('y'.repeat(1000)),
            ],
        }
        await hook(state)

        expect(state.messages).toHaveLength(1)
        expect(state.messages[0]!.content).toBe('[trimmed]')
    })

    it('压缩后仍然超预算时继续 safetyTrimMessages', async () => {
        vi.doMock('../../../../server/services/workflow/context/messageCompressor', () => ({
            estimateMessagesTokens: vi.fn((msgs: BaseMessage[]) => {
                const total = msgs.reduce((acc, m) => acc + (m.content as string).length, 0)
                // 多条时返回大值、单条摘要仍超预算、trim 后返回小值
                // 业务方 safetyTrim 把 maxTokens 经过 outputReserve(默认 8192) + inflation(默认 1.5) 校正后
                // 实际 tiktokenBudget = floor(max(maxTokens - 8192 - 0, 10000) / 1.5) = 6666，
                // "压缩后仍超预算"必须 > 6666 才能再次触发 safetyTrimMessages
                if (msgs.length > 1) return 20_000
                if (total > 100) return 12_000 // 压缩后仍超预算（> tiktokenBudget=6666）
                return 200 // trim 后通过
            }),
            compressMessages: vi.fn(async () => [new HumanMessage('[still-too-long]'.repeat(20))]),
            safetyTrimMessages: vi.fn(async () => [new HumanMessage('[final-trim]')]),
        }))

        const { safetyTrimMiddleware } = await import('../../../../server/services/workflow/middleware/safetyTrim.middleware')
        const mw = safetyTrimMiddleware({ model: fakeModel, maxTokens: 1000 })
        const hook = getHook(mw)

        const state = {
            messages: [
                new HumanMessage('a'.repeat(2000)),
                new HumanMessage('b'.repeat(2000)),
            ],
        }
        await hook(state)

        // 最终走 safetyTrimMessages 的结果
        expect(state.messages[0]!.content).toBe('[final-trim]')
    })
})
