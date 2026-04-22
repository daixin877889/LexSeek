import { describe, it, expect, vi } from 'vitest'
import type { PlaybookSnapshot } from '#shared/types/contract'

// 用 vi.hoisted 保证 mock 对象在 vi.mock 工厂执行前可见（ESM 提升要求）
const { mockLogger } = vi.hoisted(() => ({
    mockLogger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        setLevel: vi.fn(),
    },
}))
// mock logger，拦截 analyzeSingleClause.ts 里的自动导入 logger
vi.mock('#shared/utils/logger', () => ({
    logger: mockLogger,
}))

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
        // DB 加载的 system prompt 模板——测试用最小可渲染版本
        prompts: [
            {
                type: 'system',
                status: 1,
                content: '立场={{stanceLabel}} · 类型={{contractType}} · 第{{clauseIndex}}条\n甲方:{{partyA}} 乙方:{{partyB}}\n{{clauseText}}\n{{playbookSection}}\n请输出 JSON。',
            },
        ],
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
        // 服务端强制覆盖 id，不使用 LLM 返回的 id（防重复 UUID 联动 bug）
        expect(result?.id).not.toBe('a0000000-0000-4000-8000-000000000001')
        expect(result?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    })

    it('两次连续调用：LLM 返回相同 id 时服务端覆盖为不同 UUID', async () => {
        const { analyzeSingleClause } = await import('~~/server/services/assistant/contract/analyzeSingleClause')
        const ctx = {
            clause: { index: 1, number: '3.2', text: '3.2 首付 40%，尾款 60%' },
            stance: 'partyB' as const, partyA: 'A', partyB: 'B', contractType: '技术服务',
        }
        const a = await analyzeSingleClause(ctx)
        const b = await analyzeSingleClause(ctx)
        expect(a?.id).toBeTruthy()
        expect(b?.id).toBeTruthy()
        expect(a?.id).not.toBe(b?.id)
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

const SNAPSHOT: PlaybookSnapshot = {
    contractType: '劳动合同',
    snapshotAt: '2026-04-22T00:00:00Z',
    points: [
        { code: 'probation', title: '试用期合规', defaultLevel: 'high', stancePreference: 'strict', checkContent: '检查试用期长度' },
        { code: 'overtime', title: '加班费基数', defaultLevel: 'medium', stancePreference: 'balanced', checkContent: '检查加班费' },
    ],
}

describe('analyzeSingleClause · playbook', () => {
    it('snapshot 传入时 prompt 渲染 playbookSection', async () => {
        let capturedPrompt = ''
        const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
        ;(createChatModel as any).mockReturnValueOnce({
            invoke: vi.fn().mockImplementation(async (p: string) => {
                capturedPrompt = p
                return { content: JSON.stringify({ risk: null, skip: true }) }
            }),
        })
        const { analyzeSingleClause } = await import('~~/server/services/assistant/contract/analyzeSingleClause')
        await analyzeSingleClause({
            clause: { index: 1, number: '1', text: 'clause text' },
            stance: 'partyB', partyA: 'A', partyB: 'B', contractType: '劳动合同',
            playbookSnapshot: SNAPSHOT,
        })
        expect(capturedPrompt).toContain('code="probation"')
        expect(capturedPrompt).toContain('code="overtime"')
        expect(capturedPrompt).toContain('立场:strict')
    })

    it('AI 返回合法 matchedPointCode 透传', async () => {
        const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
        ;(createChatModel as any).mockReturnValueOnce({
            invoke: vi.fn().mockResolvedValue({
                content: JSON.stringify({
                    risk: {
                        id: 'a0000000-0000-4000-8000-000000000001',
                        clauseIndex: 1, clauseText: 'x',
                        level: 'high', category: 'c', problem: 'p',
                        analysis: 'a', risk: 'r', suggestion: 's',
                        suggestedClauseText: 'new clause',
                        matchedPointCode: 'probation',
                    },
                    skip: false,
                }),
            }),
        })
        const { analyzeSingleClause } = await import('~~/server/services/assistant/contract/analyzeSingleClause')
        const result = await analyzeSingleClause({
            clause: { index: 1, number: '1', text: 'x' },
            stance: 'partyB', partyA: 'A', partyB: 'B', contractType: '劳动合同',
            playbookSnapshot: SNAPSHOT,
        })
        expect(result?.matchedPointCode).toBe('probation')
    })

    it('AI 返回非法 code 降级为清单外 + warn', async () => {
        const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
        ;(createChatModel as any).mockReturnValueOnce({
            invoke: vi.fn().mockResolvedValue({
                content: JSON.stringify({
                    risk: {
                        id: 'a0000000-0000-4000-8000-000000000001',
                        clauseIndex: 1, clauseText: 'x',
                        level: 'high', category: 'c', problem: 'p',
                        analysis: 'a', risk: 'r', suggestion: 's',
                        suggestedClauseText: 'new clause',
                        matchedPointCode: 'not_in_snapshot',
                    },
                    skip: false,
                }),
            }),
        })
        mockLogger.warn.mockClear()
        const { analyzeSingleClause } = await import('~~/server/services/assistant/contract/analyzeSingleClause')
        const result = await analyzeSingleClause({
            clause: { index: 1, number: '1', text: 'x' },
            stance: 'partyB', partyA: 'A', partyB: 'B', contractType: '劳动合同',
            playbookSnapshot: SNAPSHOT,
        })
        expect(result?.matchedPointCode).toBeUndefined()
        expect(mockLogger.warn).toHaveBeenCalledWith(
            expect.stringContaining('未知的 matchedPointCode'),
            expect.any(Object),
        )
    })

    it('AI 漏返 matchedPointCode 当清单外 + 不 warn', async () => {
        const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
        ;(createChatModel as any).mockReturnValueOnce({
            invoke: vi.fn().mockResolvedValue({
                content: JSON.stringify({
                    risk: {
                        id: 'a0000000-0000-4000-8000-000000000001',
                        clauseIndex: 1, clauseText: 'x',
                        level: 'high', category: 'c', problem: 'p',
                        analysis: 'a', risk: 'r', suggestion: 's',
                        suggestedClauseText: 'new clause',
                    },
                    skip: false,
                }),
            }),
        })
        mockLogger.warn.mockClear()
        const { analyzeSingleClause } = await import('~~/server/services/assistant/contract/analyzeSingleClause')
        const result = await analyzeSingleClause({
            clause: { index: 1, number: '1', text: 'x' },
            stance: 'partyB', partyA: 'A', partyB: 'B', contractType: '劳动合同',
            playbookSnapshot: SNAPSHOT,
        })
        expect(result?.matchedPointCode).toBeUndefined()
        expect(mockLogger.warn).not.toHaveBeenCalledWith(
            expect.stringContaining('未知的 matchedPointCode'),
            expect.anything(),
        )
    })

    it('snapshot=null 时 {{playbookSection}} 渲染为空字符串', async () => {
        let capturedPrompt = ''
        const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
        ;(createChatModel as any).mockReturnValueOnce({
            invoke: vi.fn().mockImplementation(async (p: string) => {
                capturedPrompt = p
                return { content: JSON.stringify({ risk: null, skip: true }) }
            }),
        })
        const { analyzeSingleClause } = await import('~~/server/services/assistant/contract/analyzeSingleClause')
        await analyzeSingleClause({
            clause: { index: 1, number: '1', text: 'x' },
            stance: 'partyB', partyA: 'A', partyB: 'B', contractType: '劳动合同',
            // playbookSnapshot 不传
        })
        expect(capturedPrompt).not.toContain('本合同审查清单')
        expect(capturedPrompt).not.toContain('code=')
    })
})
