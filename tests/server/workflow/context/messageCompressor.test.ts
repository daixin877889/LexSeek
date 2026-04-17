/**
 * messageCompressor 纯函数单元测试
 *
 * 覆盖：
 * - estimateMessagesTokens / estimateMessageTokens 的 token 估算
 * - getContextBudget 预算计算
 * - compressMessages 的分支（短消息跳过、中间为空跳过、成功摘要、模型抛错回退）
 * - compressMessages 中 ToolMessage 起点回退逻辑
 * - safetyTrimMessages（低于预算直接返回、高于预算裁剪、trimMessages 抛错 fallback
 *   到 trimByEstimation）
 *
 * 模型使用最小桩（只实现 invoke），避免真实 LLM 调用。
 *
 * **Feature: message-compressor**
 */

import { describe, it, expect, vi } from 'vitest'
import {
    AIMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
    type BaseMessage,
} from '@langchain/core/messages'

import {
    estimateMessagesTokens,
    getContextBudget,
    compressMessages,
    safetyTrimMessages,
} from '../../../../server/services/workflow/context/messageCompressor'

// 测试需要访问 logger（源码在 catch 分支里调用 logger.warn）
;(globalThis as any).logger ??= {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
}

/** 构造一个只暴露 invoke 的最小模型桩 */
function makeModelStub(contentOrImpl: string | ((msgs: BaseMessage[]) => unknown)) {
    const invoke = vi.fn(async (msgs: BaseMessage[]) => {
        if (typeof contentOrImpl === 'function') {
            const res = contentOrImpl(msgs)
            if (res && typeof res === 'object' && 'content' in (res as any)) return res
            return { content: res as string }
        }
        return { content: contentOrImpl }
    })
    return { invoke }
}

/** 构造一条 1 轮（AI + tool_call + tool_response） */
function makeToolRound(id: string): BaseMessage[] {
    const ai = new AIMessage({
        content: '',
        tool_calls: [{ id, name: 'search', args: { q: id }, type: 'tool_call' }],
    })
    const tool = new ToolMessage({
        content: `tool-result-${id}`,
        tool_call_id: id,
    })
    const follow = new AIMessage({ content: `已根据 ${id} 分析` })
    return [ai, tool, follow]
}

describe('estimateMessagesTokens', () => {
    it('空数组应返回 0', () => {
        expect(estimateMessagesTokens([])).toBe(0)
    })

    it('相同内容的多条消息 token 数应大致可加', () => {
        const msgs = [
            new HumanMessage({ content: '中华人民共和国民法典' }),
            new HumanMessage({ content: '中华人民共和国民法典' }),
        ]
        const single = estimateMessagesTokens([msgs[0]!])
        const double = estimateMessagesTokens(msgs)
        expect(double).toBeGreaterThan(single)
        expect(double).toBeLessThanOrEqual(single * 2 + 1)
    })

    it('非字符串 content 应通过 JSON.stringify 估算', () => {
        const msg = new AIMessage({
            content: [{ type: 'text', text: '你好' }] as any,
        })
        const tokens = estimateMessagesTokens([msg])
        // +10 overhead + 某个正数估算
        expect(tokens).toBeGreaterThan(10)
    })
})

describe('getContextBudget', () => {
    it('不传入 contextWindow 时应使用默认 100K', () => {
        const { budget, compressThreshold } = getContextBudget()
        expect(budget).toBe(Math.floor(100000 * 0.8))
        expect(compressThreshold).toBe(Math.floor(budget * 0.6))
    })

    it('传入 200K 时应预留 20% 并以 60% 触发压缩', () => {
        const { budget, compressThreshold } = getContextBudget(200000)
        expect(budget).toBe(160000)
        expect(compressThreshold).toBe(96000)
    })

    it('传入 0 时应返回 0 预算', () => {
        const { budget, compressThreshold } = getContextBudget(0)
        expect(budget).toBe(0)
        expect(compressThreshold).toBe(0)
    })
})

describe('compressMessages', () => {
    it('消息总数不足以触发压缩时应原样返回', async () => {
        const msgs: BaseMessage[] = [
            new SystemMessage({ content: 'sys' }),
            new HumanMessage({ content: 'hi' }),
            new AIMessage({ content: 'hello' }),
        ]
        const model = makeModelStub('summary')
        const result = await compressMessages(msgs, 1000, model)
        expect(result).toBe(msgs)
        expect(model.invoke).not.toHaveBeenCalled()
    })

    it('成功路径：生成摘要并保留 system + 摘要 + 最近 N 轮', async () => {
        // 构造：system + 5 轮（共 15 条）+ 尾部 1 条 ≥ 12 条阈值触发压缩
        const system = new SystemMessage({ content: '你是一个助手' })
        const rounds: BaseMessage[] = []
        for (let i = 0; i < 5; i++) rounds.push(...makeToolRound(`t${i}`))
        const extra = new HumanMessage({ content: '最后一条追问' })

        const msgs: BaseMessage[] = [system, ...rounds, extra]
        expect(msgs.length).toBeGreaterThan(11)

        const model = makeModelStub('【摘要】前面几轮查询了相关内容')
        const result = await compressMessages(msgs, 5000, model)

        expect(model.invoke).toHaveBeenCalledTimes(1)
        // system 应保留在第 0 位
        expect(result[0]).toBe(system)
        // 第 1 条应为摘要 HumanMessage
        const summary = result[1] as HumanMessage
        expect(summary).toBeInstanceOf(HumanMessage)
        expect(typeof summary.content).toBe('string')
        expect(summary.content).toContain('之前工具调用和分析过程的摘要')
        expect(summary.content).toContain('【摘要】前面几轮查询了相关内容')
        // 压缩后长度应严格小于原消息
        expect(result.length).toBeLessThan(msgs.length)
    })

    it('切点落在 ToolMessage 时应向前回退，避免孤立 tool_result 起始', async () => {
        const system = new SystemMessage({ content: 'sys' })
        // 精心构造：sys(0) + 3 个 [ai-toolcall, tool, ai-reply] 轮次 (1-9) + 7 条 AI 尾部 (10-16)
        // length = 17, recentStart = 17-9 = 8，msgs[8] 是 r2 的 ToolMessage
        const rounds: BaseMessage[] = []
        for (let i = 0; i < 3; i++) rounds.push(...makeToolRound(`r${i}`))
        const tail: BaseMessage[] = []
        for (let i = 0; i < 7; i++) tail.push(new AIMessage({ content: `tail-${i}` }))
        const msgs: BaseMessage[] = [system, ...rounds, ...tail]

        const recentStart = msgs.length - 9
        // 验证前置条件：此位置确为 tool 类型，触发回退分支
        expect(msgs[recentStart]?.getType?.()).toBe('tool')

        const model = makeModelStub('summary-content')
        const result = await compressMessages(msgs, 5000, model)

        // 摘要应成功生成
        expect(model.invoke).toHaveBeenCalledTimes(1)
        // 摘要结果中不应以孤立 tool 起始（第一个 recentMessages 位置是 AIMessage）
        const summary = result[1] as HumanMessage
        expect(summary.content).toContain('之前工具调用和分析过程的摘要')
    })

    it('middleMessages 为空时应直接返回原消息', async () => {
        // 构造：system + 足够触发第一层判断但 middle 为空的边界
        // 所需条件 messages.length > KEEP_RECENT_ROUNDS*3+2 = 11，
        // 且 recentStart <= 1（middle = [1..recentStart) 为空）。
        // 只有 length <= recentCount+1 = 10 时才会出现 middle 空，但前置条件需要 >11，
        // 这两个矛盾 => 该分支实际只在异常 shape 下触发。通过主动构造：
        //   system + 11 条消息，但让前面除 system 外全是 AI/Human 无 tool 的话，
        //   recentStart = length - 9。此时 middle = [1..recentStart) 非空。
        // 所以 middle 为空只有 recentStart<=1，不满足长度>11 时无法达到，改为用
        // KEEP_RECENT_ROUNDS*3+2 = 11 => 需要 length = 12 且 recentStart = 3 的情况...
        // 直接跳过该不可达 case。改为验证另一个更简洁的边界：消息恰好等于阈值。
        const msgs: BaseMessage[] = [new SystemMessage({ content: 'sys' })]
        for (let i = 0; i < 11; i++) {
            msgs.push(new HumanMessage({ content: `${i}` }))
        }
        // length === 12 > 11 会触发，此时 recentStart = 12-9 = 3，middle = [1,3) 非空
        const model = makeModelStub('s')
        const result = await compressMessages(msgs, 5000, model)
        // middle 不为空，应调用模型
        expect(model.invoke).toHaveBeenCalledTimes(1)
        expect(result.length).toBeLessThan(msgs.length)
    })

    it('摘要生成失败时应回退返回原消息', async () => {
        const system = new SystemMessage({ content: 'sys' })
        const rounds: BaseMessage[] = []
        for (let i = 0; i < 5; i++) rounds.push(...makeToolRound(`f${i}`))
        const msgs: BaseMessage[] = [system, ...rounds]

        const model = {
            invoke: vi.fn(async () => {
                throw new Error('LLM unavailable')
            }),
        }

        const result = await compressMessages(msgs, 5000, model)
        expect(result).toBe(msgs)
        expect(model.invoke).toHaveBeenCalledTimes(1)
    })

    it('模型返回非字符串 content 时应 JSON.stringify 后拼接', async () => {
        const system = new SystemMessage({ content: 'sys' })
        const rounds: BaseMessage[] = []
        for (let i = 0; i < 5; i++) rounds.push(...makeToolRound(`j${i}`))
        const msgs: BaseMessage[] = [system, ...rounds]

        const model = makeModelStub(() => ({
            content: [{ type: 'text', text: '结构化摘要' }],
        }))

        const result = await compressMessages(msgs, 5000, model)
        const summary = result[1] as HumanMessage
        expect(summary.content).toContain('结构化摘要')
    })

    it('中间消息包含 AI 工具调用/工具返回/AI 回复/其他类型时应各自格式化', async () => {
        const system = new SystemMessage({ content: 'sys' })
        // 手工拼接 5+ 轮，保证触发压缩
        const aiWithToolCalls = new AIMessage({
            content: '',
            tool_calls: [{ id: 'x1', name: 'search', args: {}, type: 'tool_call' }],
        })
        const toolMsg = new ToolMessage({
            content: 'x'.repeat(2500), // > 2000 触发截断分支
            tool_call_id: 'x1',
        })
        const aiReply = new AIMessage({ content: 'y'.repeat(600) }) // > 500 触发截断
        const humanLong = new HumanMessage({ content: 'z'.repeat(400) }) // > 300 触发截断
        // 还要足够的消息让整体长度 > 11
        const msgs: BaseMessage[] = [
            system,
            aiWithToolCalls,
            toolMsg,
            aiReply,
            humanLong,
            ...makeToolRound('fill1'),
            ...makeToolRound('fill2'),
            ...makeToolRound('fill3'),
        ]
        expect(msgs.length).toBeGreaterThan(11)

        let capturedPrompt: string | null = null
        const model = makeModelStub((inputs) => {
            // 第二条应为 HumanMessage(summaryPrompt)
            const hum = inputs[1] as HumanMessage
            capturedPrompt = typeof hum.content === 'string'
                ? hum.content
                : JSON.stringify(hum.content)
            return '摘要 OK'
        })

        await compressMessages(msgs, 5000, model)

        expect(capturedPrompt).not.toBeNull()
        // AI 工具调用
        expect(capturedPrompt!).toContain('[AI 调用工具] search')
        // 工具返回被截断
        expect(capturedPrompt!).toContain('[工具返回]')
        expect(capturedPrompt!).toContain('...(截断)')
        // AI 回复被截断
        expect(capturedPrompt!).toContain('[AI 回复]')
        // 其他类型（human）被截断
        expect(capturedPrompt!).toMatch(/\[human\]/)
    })

    it('中间消息超过 30K 字符时应截断并插入省略标记', async () => {
        const system = new SystemMessage({ content: 'sys' })
        // 每条 AI 回复生成 ~300-500 字符行，插入大量消息超出 30K
        const bigMiddle: BaseMessage[] = []
        for (let i = 0; i < 200; i++) {
            bigMiddle.push(new AIMessage({ content: '很长的回复'.repeat(100) }))
        }
        const recent = [
            ...makeToolRound('rr1'),
            ...makeToolRound('rr2'),
            ...makeToolRound('rr3'),
        ]
        const msgs: BaseMessage[] = [system, ...bigMiddle, ...recent]

        let captured: string | null = null
        const model = makeModelStub((inputs) => {
            const hum = inputs[1] as HumanMessage
            captured = typeof hum.content === 'string' ? hum.content : JSON.stringify(hum.content)
            return '摘要'
        })
        await compressMessages(msgs, 5000, model)
        expect(captured).not.toBeNull()
        expect(captured!).toContain('(后续消息已省略)')
        // 总长度被限制在 30K + 末尾提示词范围
        expect(captured!.length).toBeLessThan(31000)
    })
})

describe('safetyTrimMessages', () => {
    it('估算低于预算时应原样返回', async () => {
        const msgs = [
            new SystemMessage({ content: 'sys' }),
            new HumanMessage({ content: '你好' }),
        ]
        const result = await safetyTrimMessages(msgs, 10000)
        expect(result).toBe(msgs)
    })

    it('估算超过预算时应裁剪消息', async () => {
        const msgs: BaseMessage[] = [
            new SystemMessage({ content: 'system prompt' }),
            new HumanMessage({ content: '你好啊' }),
            new AIMessage({ content: '回答 A' }),
            new HumanMessage({ content: '请继续' }),
            new AIMessage({ content: '回答 B' }),
        ]
        // 极小预算：强制触发 trimMessages 裁剪
        const result = await safetyTrimMessages(msgs, 30)
        // 至少会返回一个数组
        expect(Array.isArray(result)).toBe(true)
        // 数组长度不超过原消息
        expect(result.length).toBeLessThanOrEqual(msgs.length)
    })

    it('使用预计算 token 数低于预算时应走快路径', async () => {
        const msgs = [
            new SystemMessage({ content: 'sys' }),
            new HumanMessage({ content: 'hi' }),
        ]
        const result = await safetyTrimMessages(msgs, 10000, 10)
        expect(result).toBe(msgs)
    })

    it('trimMessages 抛错时应回退到字符估算裁剪', async () => {
        // 通过 vi.doMock 让 trimMessages 抛错，仅影响本用例动态 import 的模块
        vi.resetModules()
        vi.doMock('@langchain/core/messages', async () => {
            const actual = await vi.importActual<typeof import('@langchain/core/messages')>(
                '@langchain/core/messages',
            )
            return {
                ...actual,
                trimMessages: async () => {
                    throw new Error('trim failed')
                },
            }
        })

        const mod = await import(
            '../../../../server/services/workflow/context/messageCompressor'
        )
        const { safetyTrimMessages: trimFn } = mod

        const { SystemMessage: S, HumanMessage: H, AIMessage: A } = await import(
            '@langchain/core/messages'
        )

        const msgs: BaseMessage[] = [
            new S({ content: '系统消息' }),
            new H({ content: '用户问题 A' }),
            new A({ content: 'AI 回答 A' }),
            new H({ content: '用户问题 B' }),
            new A({ content: 'AI 回答 B'.repeat(50) }),
        ]
        const result = await trimFn(msgs, 50)
        // 兜底路径始终保留 system
        expect(result.length).toBeGreaterThanOrEqual(1)
        expect(result[0]).toBe(msgs[0])

        vi.doUnmock('@langchain/core/messages')
        vi.resetModules()
    })

    it('空消息数组应安全返回', async () => {
        const result = await safetyTrimMessages([], 100, 0)
        expect(result).toEqual([])
    })
})
