/**
 * contextErrorLogger 单测
 *
 * 验证：
 * - isContextOverflowError 各类厂商错误识别 + 边界
 * - logContextOverflow 结构化日志：systemTokens、消息摘要、top5 排序、extra 透传
 * - 非超限错误：返回 false 不打日志
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { errorSpy, infoSpy, warnSpy, debugSpy } = vi.hoisted(() => ({
    errorSpy: vi.fn(),
    infoSpy: vi.fn(),
    warnSpy: vi.fn(),
    debugSpy: vi.fn(),
}))

// 业务代码引 logger 走 nuxt 自动导入 → from '#shared/utils/logger'
vi.mock('#shared/utils/logger', () => ({
    logger: { error: errorSpy, info: infoSpy, warn: warnSpy, debug: debugSpy },
}))
;(globalThis as any).logger = { error: errorSpy, info: infoSpy, warn: warnSpy, debug: debugSpy }

import {
    isContextOverflowError,
    logContextOverflow,
} from '~~/server/services/agent-platform/context/contextErrorLogger'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'

describe('isContextOverflowError', () => {
    beforeEach(() => {
        errorSpy.mockClear()
    })

    it('识别 Anthropic prompt is too long', () => {
        expect(isContextOverflowError(new Error('prompt is too long: 200000 tokens'))).toBe(true)
    })

    it('识别 OpenAI context_length_exceeded', () => {
        expect(isContextOverflowError({ error: { message: 'context_length_exceeded' } })).toBe(true)
    })

    it('识别 DeepSeek maximum context length', () => {
        expect(isContextOverflowError(new Error('This model maximum context length is 128k tokens')))
            .toBe(true)
    })

    it('识别字符串型错误', () => {
        expect(isContextOverflowError('context window exceeded')).toBe(true)
    })

    it('识别 too many tokens', () => {
        expect(isContextOverflowError({ message: 'too many tokens in input' })).toBe(true)
    })

    it('识别 exceeds the limit', () => {
        expect(isContextOverflowError({ message: 'request exceeds the limit' })).toBe(true)
    })

    it('识别 token 与 exceed 共现', () => {
        expect(isContextOverflowError({ message: 'tokens count exceed allowed' })).toBe(true)
    })

    it('错误对象走 JSON.stringify 兜底', () => {
        // 非 Error / 无 message 字段，走 JSON.stringify 分支
        expect(isContextOverflowError({ kind: 'maximum context length error' })).toBe(true)
    })

    it('错误对象 JSON.stringify 抛错时走 String 兜底', () => {
        const circular: any = { foo: 'bar' }
        circular.self = circular // 循环引用让 JSON.stringify 抛错
        // String(obj) → "[object Object]" → 不含关键字
        expect(isContextOverflowError(circular)).toBe(false)
    })

    it('null / undefined 返回 false', () => {
        expect(isContextOverflowError(null)).toBe(false)
        expect(isContextOverflowError(undefined)).toBe(false)
    })

    it('非超限错误返回 false', () => {
        expect(isContextOverflowError(new Error('network timeout'))).toBe(false)
        expect(isContextOverflowError(new Error('401 unauthorized'))).toBe(false)
    })

    it('数字型错误走 String 兜底', () => {
        // 非 string / Error / object → String(123) = "123"
        expect(isContextOverflowError(123)).toBe(false)
    })
})

describe('logContextOverflow', () => {
    beforeEach(() => {
        errorSpy.mockClear()
    })

    it('非超限错误不打日志，返回 false', () => {
        const handled = logContextOverflow(new Error('connection reset'), { source: 'test' })
        expect(handled).toBe(false)
        expect(errorSpy).not.toHaveBeenCalled()
    })

    it('超限错误打日志，返回 true，包含 systemTokens / messages 摘要', () => {
        const messages = [
            new SystemMessage('你是一个助手'),
            new HumanMessage('请帮我写一个超长的合同条款'.repeat(10)),
            new AIMessage('好的'),
        ]
        const handled = logContextOverflow(new Error('prompt is too long'), {
            source: 'caseAnalysisAgent',
            modelName: 'gpt-4o',
            sdkType: 'openai',
            contextWindow: 128000,
            systemPrompt: '系统提示词',
            messages,
            extra: { sessionId: 'sess-1', userId: 99 },
        })

        expect(handled).toBe(true)
        expect(errorSpy).toHaveBeenCalledOnce()
        const [tag, payload] = errorSpy.mock.calls[0]
        expect(tag).toBe('[ContextOverflow] 模型上下文超限')
        expect(payload.source).toBe('caseAnalysisAgent')
        expect(payload.model).toBe('gpt-4o')
        expect(payload.sdkType).toBe('openai')
        expect(payload.contextWindow).toBe(128000)
        expect(payload.systemTokens).toBeGreaterThan(0)
        expect(payload.messagesCount).toBe(3)
        expect(payload.messagesTotalTokens).toBeGreaterThan(0)
        expect(payload.estimatedTotal).toBe(payload.systemTokens + payload.messagesTotalTokens)
        expect(payload.longestMessages).toBeInstanceOf(Array)
        // top 应按 tokens 降序，最长的 HumanMessage 排第一
        expect(payload.longestMessages[0].type).toBe('human')
        // extra 透传
        expect(payload.sessionId).toBe('sess-1')
        expect(payload.userId).toBe(99)
        // errorMessage 透传
        expect(payload.errorMessage).toContain('prompt is too long')
    })

    it('未传 systemPrompt / messages 时仍能输出日志（基础字段填默认）', () => {
        const handled = logContextOverflow('context_length_exceeded', { source: 'minimal' })
        expect(handled).toBe(true)
        const [, payload] = errorSpy.mock.calls[0]
        expect(payload.systemTokens).toBe(0)
        expect(payload.messagesCount).toBeUndefined()
        expect(payload.messagesTotalTokens).toBeUndefined()
        expect(payload.longestMessages).toBeUndefined()
        expect(payload.estimatedTotal).toBe(0)
    })

    it('消息 content 非字符串时走 JSON.stringify 分支', () => {
        const m = new HumanMessage({
            content: [
                { type: 'text', text: '你好' },
                { type: 'image_url', image_url: 'https://example.com/x.png' },
            ] as any,
        })
        const handled = logContextOverflow(new Error('maximum context length'), {
            source: 'rich',
            messages: [m],
        })
        expect(handled).toBe(true)
        const [, payload] = errorSpy.mock.calls[0]
        expect(payload.messagesCount).toBe(1)
        expect(payload.longestMessages[0].preview.length).toBeGreaterThan(0)
    })

    it('消息无 getType 时回退到 constructor.name', () => {
        // 构造一个伪消息：保留 content，移除 getType
        const fakeMsg: any = { content: 'plain text', constructor: { name: 'CustomMessage' } }
        // Object.setPrototypeOf 不必要——summarizeMessages 只检查 typeof getType
        const handled = logContextOverflow(new Error('context length'), {
            source: 'fake',
            messages: [fakeMsg],
        })
        expect(handled).toBe(true)
        const [, payload] = errorSpy.mock.calls[0]
        expect(payload.longestMessages[0].type).toBe('CustomMessage')
    })
})
