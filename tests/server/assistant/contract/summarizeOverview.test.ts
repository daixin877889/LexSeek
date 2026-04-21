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
    }),
}))

import type { Risk } from '#shared/types/contract'

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
        const { summarizeOverview } = await import('~~/server/services/assistant/contract/summarizeOverview')

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

        const { summarizeOverview } = await import('~~/server/services/assistant/contract/summarizeOverview')

        const risks: Risk[] = [makeRisk('r1', 'high'), makeRisk('r2', 'medium')]
        const result = await summarizeOverview(risks, 'partyA', '服务合同')

        expect(createChatModel).toHaveBeenCalledTimes(1)
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

        const { summarizeOverview } = await import('~~/server/services/assistant/contract/summarizeOverview')

        await expect(
            summarizeOverview([makeRisk('r1', 'high')], 'partyB', '劳动合同'),
        ).rejects.toThrow(/schema 校验失败/)
    })
})
