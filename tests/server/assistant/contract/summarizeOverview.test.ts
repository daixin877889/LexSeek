/**
 * summarizeOverview 测试
 *
 * **Feature: m6-1-contract-review Task 3.1**
 * **Validates: 0 条风险不调 LLM / 正常生成 / schema 校验失败抛错**
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('~~/server/services/node/chatModelFactory', () => ({
    createChatModel: vi.fn(() => ({
        invoke: vi.fn().mockResolvedValue({ content: '' }),
    })),
}))

vi.mock('~~/server/services/node/node.service', () => ({
    getValidNodeConfig: vi.fn().mockResolvedValue({
        modelApiKeys: [{ apiKey: 'sk-test', status: 1 }],
        modelSdkType: 'openai',
        modelName: 'gpt-4',
        modelProviderBaseUrl: 'https://api.openai.com/v1',
        // DB 加载的 system prompt 模板——测试用最小可渲染版本
        prompts: [
            {
                type: 'system',
                status: 1,
                content: '立场={{stance}} · 类型={{contractType}}\n风险：\n{{riskList}}\n请输出 JSON。',
            },
        ],
    }),
}))

import type { Risk, ContractOverview } from '#shared/types/contract'
import { remapHighlightRiskIds } from '~~/server/agents/contract/summarizeOverview'

const makeRisk = (id: string, level: 'high' | 'medium' | 'low'): Risk => ({
    id,
    clauseIndex: 1,
    clauseText: '条款文本',
    level,
    category: '付款',
    problem: '问题描述',
    analysis: '详细分析',
    risk: '风险点',
    suggestion: '改进建议',
})

describe('summarizeOverview', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('0 条风险时直接返回默认 overview，不调 LLM', async () => {
        const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
        const { summarizeOverview } = await import('~~/server/agents/contract/summarizeOverview')

        const result = await summarizeOverview([], 'neutral', null)

        // 不应调用 createChatModel
        expect(createChatModel).not.toHaveBeenCalled()

        // 返回默认结构
        expect(result.highlights).toEqual({ high: [], medium: [], low: [] })
        expect(result.overall).toBe('本合同未识别到明显风险。')
    })

    it('有 risks 时调 LLM 并解析返回 highlights/overall 结构', async () => {
        const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
        const mockInvoke = vi.fn().mockResolvedValue({
            content: JSON.stringify({
                highlights: {
                    high: [{ text: '付款期限过短', riskId: 'r1' }],
                    medium: [{ text: '违约金偏低', riskId: 'r2' }],
                    low: [],
                },
                overall: '本合同存在付款风险，建议修改付款条款。',
            }),
        })
        ;(createChatModel as any).mockReturnValueOnce({ invoke: mockInvoke })

        const { summarizeOverview } = await import('~~/server/agents/contract/summarizeOverview')

        const risks: Risk[] = [makeRisk('r1', 'high'), makeRisk('r2', 'medium')]
        const result = await summarizeOverview(risks, 'partyA', '服务合同')

        expect(createChatModel).toHaveBeenCalledTimes(1)
        // invokeNodeJson 必须显式 streaming:false，避免后台 JSON 提取的
        // LLM token chunks 通过 callback 链泄漏到主 SSE 通道（已知 bug）
        expect(createChatModel).toHaveBeenCalledWith(expect.objectContaining({ streaming: false }))
        // langsmith:nostream + langfuse:nostream + internal 三层 tag 阻断后台 LLM 调用泄漏：
        // - langsmith:nostream 由 LangGraph StreamMessagesHandler 严格相等匹配后短路，
        //   不进 SSE 流（messages.cjs:56-67）。
        // - langfuse:nostream 由 LangfuseSpanProcessor.shouldExportSpan 统一豁免。
        // - internal 保留项目约定，agentWorker.stripSystemMessages SSE 层兜底。
        expect(mockInvoke).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ tags: ['langsmith:nostream', 'langfuse:nostream', 'internal'] }),
        )
        expect(result.highlights).not.toBeNull()
        expect(result.highlights!.high).toHaveLength(1)
        expect(result.highlights!.high[0]!.riskId).toBe('r1')
        expect(result.highlights!.medium).toHaveLength(1)
        expect(result.highlights!.low).toHaveLength(0)
        expect(result.overall).toBe('本合同存在付款风险，建议修改付款条款。')
    })

    it('LLM 返回不符合 schema 时抛错', async () => {
        const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
        // 返回不含 overall 字段的畸形 JSON
        ;(createChatModel as any).mockReturnValueOnce({
            invoke: vi.fn().mockResolvedValue({
                content: JSON.stringify({ highlights: { high: [], medium: [], low: [] } }),
            }),
        })

        const { summarizeOverview } = await import('~~/server/agents/contract/summarizeOverview')

        await expect(
            summarizeOverview([makeRisk('r1', 'high')], 'partyB', '劳动合同'),
        ).rejects.toThrow(/schema 校验失败/)
    })

    it('M11：signal 透传到底层 model.invoke 的 RunnableConfig', async () => {
        const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
        const invokeMock = vi.fn().mockResolvedValue({
            content: JSON.stringify({
                highlights: { high: [], medium: [], low: [] },
                overall: '总评',
            }),
        })
        ;(createChatModel as any).mockReturnValueOnce({ invoke: invokeMock })
        const controller = new AbortController()
        const { summarizeOverview } = await import('~~/server/agents/contract/summarizeOverview')
        await summarizeOverview([makeRisk('r1', 'high')], 'partyB', '劳动合同', controller.signal)
        expect(invokeMock).toHaveBeenCalled()
        expect(invokeMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal)
    })
})

describe('remapHighlightRiskIds (V2)', () => {
    it('把 highlights[].riskId 从内存 UUID 重映射为整型 id 字符串', () => {
        const overview: ContractOverview = {
            highlights: {
                high: [{ text: '风险A', riskId: 'uuid-a' }],
                medium: [{ text: '风险B', riskId: 'uuid-b' }],
                low: [],
            },
            overall: '总评',
        }
        const changed = remapHighlightRiskIds(overview, new Map([['uuid-a', 101], ['uuid-b', 202]]))
        expect(changed).toBe(true)
        expect(overview.highlights!.high[0]!.riskId).toBe('101')
        expect(overview.highlights!.medium[0]!.riskId).toBe('202')
    })

    it('映射表里没有的 riskId（已被置空 / LLM 编造）保持原值', () => {
        const overview: ContractOverview = {
            highlights: {
                high: [{ text: 'x', riskId: '' }, { text: 'y', riskId: 'unknown-uuid' }],
                medium: [],
                low: [],
            },
            overall: '',
        }
        const changed = remapHighlightRiskIds(overview, new Map([['uuid-a', 1]]))
        expect(changed).toBe(false)
        expect(overview.highlights!.high[0]!.riskId).toBe('')
        expect(overview.highlights!.high[1]!.riskId).toBe('unknown-uuid')
    })

    it('highlights 为 null（summarize 降级）时返回 false 不抛错', () => {
        const overview: ContractOverview = { highlights: null, overall: '降级总评' }
        expect(remapHighlightRiskIds(overview, new Map([['a', 1]]))).toBe(false)
    })
})
