import { describe, it, expect, vi } from 'vitest'

vi.mock('~~/server/services/node/chatModelFactory', () => ({
    createChatModel: vi.fn(() => ({
        invoke: vi.fn().mockResolvedValue({
            content: JSON.stringify({
                risk: {
                    id: 'a0000000-0000-4000-8000-000000000001',
                    clauseIndex: 1, clauseText: '3.2 首付 40%',
                    level: 'high', category: '付款', problem: '尾款比例偏高',
                    analysis: '...', risk: '...', suggestion: '改为 50/50',
                    suggestedClauseText: '3.2 首付 50%，尾款 50%',
                },
                skip: false,
            }),
        }),
    })),
}))
vi.mock('~~/server/services/node/node.service', () => ({
    getValidNodeConfig: vi.fn().mockResolvedValue({
        modelApiKeys: [{ apiKey: 'sk-test', status: 1 }],
        modelSdkType: 'openai', modelName: 'gpt-4', modelProviderBaseUrl: 'https://api.openai.com/v1',
    }),
}))

describe('analyzeSingleClause', () => {
    it('命中风险时返回 Risk', async () => {
        const { analyzeSingleClause } = await import('~~/server/services/assistant/contract/analyzeSingleClause')
        const result = await analyzeSingleClause({
            clause: { index: 1, number: '3.2', text: '3.2 首付 40%，尾款 60%' },
            stance: 'partyB', partyA: 'A', partyB: 'B', contractType: '技术服务',
        })
        expect(result).not.toBeNull()
        expect(result?.level).toBe('high')
    })

    it('skip=true 返回 null', async () => {
        const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
        ;(createChatModel as any).mockReturnValueOnce({
            invoke: vi.fn().mockResolvedValue({
                content: JSON.stringify({ risk: null, skip: true }),
            }),
        })
        const { analyzeSingleClause } = await import('~~/server/services/assistant/contract/analyzeSingleClause')
        const result = await analyzeSingleClause({
            clause: { index: 2, number: '3.3', text: '3.3 常规付款条款' },
            stance: 'neutral', partyA: 'A', partyB: 'B', contractType: '技术服务',
        })
        expect(result).toBeNull()
    })

    it('LLM 返回非 JSON → 抛错含条款序号', async () => {
        const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
        ;(createChatModel as any).mockReturnValueOnce({
            invoke: vi.fn().mockResolvedValue({ content: 'no json here' }),
        })
        const { analyzeSingleClause } = await import('~~/server/services/assistant/contract/analyzeSingleClause')
        await expect(analyzeSingleClause({
            clause: { index: 5, number: '5.1', text: 'xxx' },
            stance: 'partyA', partyA: 'A', partyB: 'B', contractType: '技服',
        })).rejects.toThrow(/#5/)
    })
})
