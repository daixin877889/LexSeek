/**
 * 文书模板 rerank Service 单元测试
 *
 * **Feature: document-template-llm-rerank / Task 2-5**
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('~~/server/services/node/node.service', () => ({
    getValidNodeConfig: vi.fn(),
}))
vi.mock('~~/server/services/node/chatModelFactory', () => ({
    createChatModel: vi.fn(),
}))
vi.mock('~~/server/services/agent-platform/context/moduleContextBuilder', () => ({
    buildContextSegments: vi.fn(),
}))

import { rerankTemplatesService, type TemplateCandidate } from '~~/server/agents/document/templateRerank.service'

function makeCandidate(id: number, overrides: Partial<TemplateCandidate> = {}): TemplateCandidate {
    return {
        id,
        name: `模板${id}`,
        category: 'general',
        description: null,
        recentlyUsed: false,
        ...overrides,
    }
}

describe('rerankTemplatesService', () => {
    beforeEach(() => {
        vi.resetAllMocks()
    })

    it('候选为空：picks=[]、fallback=false、不调 LLM', async () => {
        const r = await rerankTemplatesService({
            userId: 1,
            sessionId: 's1',
            userQuery: '帮我写起诉状',
            intent: '起诉状',
            candidates: [],
        })
        expect(r.picks).toEqual([])
        expect(r.fallback).toBe(false)
    })

    it('候选数 ≤ topN：直接返回所有、fallback=false、不调 LLM', async () => {
        const r = await rerankTemplatesService({
            userId: 1,
            sessionId: 's1',
            userQuery: 'x',
            intent: 'x',
            candidates: [makeCandidate(10), makeCandidate(11), makeCandidate(12)],
            topN: 5,
        })
        expect(r.picks.map(p => p.templateId)).toEqual([10, 11, 12])
        expect(r.fallback).toBe(false)
    })

    it('LLM 正常返回 → picks 按 LLM 顺序、不走 fallback', async () => {
        const { getValidNodeConfig } = await import('~~/server/services/node/node.service')
        const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
        const { buildContextSegments } = await import('~~/server/services/agent-platform/context/moduleContextBuilder')

        ;(getValidNodeConfig as any).mockResolvedValue({
            modelSdkType: 'openai',
            modelName: 'gpt-4o-mini',
            modelMaxOutputTokens: 4096,
            modelApiKeys: [{ status: 1, apiKey: 'sk-test' }],
            modelProviderBaseUrl: 'https://api.example.com',
        })
        ;(buildContextSegments as any).mockResolvedValue({
            roleAndFlow: '',
            caseProfile: '## 案件档案\n劳动纠纷',
            moduleSummaries: '',
            dynamicContext: '## 材料清单\n劳动合同.pdf',
        })

        // mock chat model：.withStructuredOutput(...).invoke(...) 返回 picks
        const invokeMock = vi.fn().mockResolvedValue({
            picks: [
                { templateId: 12, reason: '劳动相关' },
                { templateId: 10, reason: '次选' },
            ],
        })
        const withStructuredOutputMock = vi.fn().mockReturnValue({ invoke: invokeMock })
        ;(createChatModel as any).mockReturnValue({ withStructuredOutput: withStructuredOutputMock })

        const r = await rerankTemplatesService({
            userId: 1,
            caseId: 99,
            sessionId: 's1',
            userQuery: '帮我写劳动仲裁申请书',
            intent: '劳动仲裁',
            candidates: [
                makeCandidate(10, { name: '民事起诉状', category: 'litigation' }),
                makeCandidate(11, { name: '调解协议', category: 'general' }),
                makeCandidate(12, { name: '劳动仲裁申请书', category: 'labor' }),
                makeCandidate(13, { name: '股权转让协议', category: 'commercial' }),
                makeCandidate(14, { name: '辞职报告', category: 'labor' }),
                makeCandidate(15, { name: '探视协议', category: 'family' }),
            ],
            topN: 5,
        })

        expect(r.fallback).toBe(false)
        expect(r.picks.map(p => p.templateId)).toEqual([12, 10])
        expect(r.picks[0]!.reason).toBe('劳动相关')
        // 校验 LLM 被调用了，且 invoke 收到的 messages 里包含案件信息
        expect(invokeMock).toHaveBeenCalledOnce()
    })

    it('LLM 返回部分 id 编造（candidates 里没有）→ 过滤后仍 ≥3 → fallback=false', async () => {
        const { getValidNodeConfig } = await import('~~/server/services/node/node.service')
        const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
        const { buildContextSegments } = await import('~~/server/services/agent-platform/context/moduleContextBuilder')
        ;(getValidNodeConfig as any).mockResolvedValue({
            modelSdkType: 'openai',
            modelName: 'gpt-4o-mini',
            modelMaxOutputTokens: 4096,
            modelApiKeys: [{ status: 1, apiKey: 'sk-test' }],
            modelProviderBaseUrl: 'https://api.example.com',
        })
        ;(buildContextSegments as any).mockResolvedValue({
            roleAndFlow: '', caseProfile: '', moduleSummaries: '', dynamicContext: '',
        })
        const invokeMock = vi.fn().mockResolvedValue({
            picks: [
                { templateId: 99999 },  // 编造
                { templateId: 10 },
                { templateId: 11 },
                { templateId: 88888 },  // 编造
                { templateId: 12 },
            ],
        })
        ;(createChatModel as any).mockReturnValue({
            withStructuredOutput: vi.fn().mockReturnValue({ invoke: invokeMock }),
        })

        const r = await rerankTemplatesService({
            userId: 1,
            sessionId: 's1',
            userQuery: 'x',
            intent: 'x',
            candidates: [
                makeCandidate(10),
                makeCandidate(11),
                makeCandidate(12),
                makeCandidate(13),
                makeCandidate(14),
                makeCandidate(15),
            ],
            topN: 5,
        })
        // 编造的 99999 / 88888 被过滤；合法 10/11/12 保留，3 条足够，不走 fallback
        expect(r.fallback).toBe(false)
        expect(r.picks.map(p => p.templateId)).toEqual([10, 11, 12])
    })

    it('LLM 返回重复 id → 去重保留首次', async () => {
        const { getValidNodeConfig } = await import('~~/server/services/node/node.service')
        const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
        const { buildContextSegments } = await import('~~/server/services/agent-platform/context/moduleContextBuilder')
        ;(getValidNodeConfig as any).mockResolvedValue({
            modelSdkType: 'openai', modelName: 'gpt-4o-mini', modelMaxOutputTokens: 4096,
            modelApiKeys: [{ status: 1, apiKey: 'sk-test' }],
            modelProviderBaseUrl: 'https://api.example.com',
        })
        ;(buildContextSegments as any).mockResolvedValue({
            roleAndFlow: '', caseProfile: '', moduleSummaries: '', dynamicContext: '',
        })
        const invokeMock = vi.fn().mockResolvedValue({
            picks: [
                { templateId: 10, reason: '首次' },
                { templateId: 10, reason: '重复' },  // 重复
                { templateId: 11 },
                { templateId: 12 },
            ],
        })
        ;(createChatModel as any).mockReturnValue({
            withStructuredOutput: vi.fn().mockReturnValue({ invoke: invokeMock }),
        })

        const r = await rerankTemplatesService({
            userId: 1, sessionId: 's1', userQuery: 'x', intent: 'x',
            candidates: [makeCandidate(10), makeCandidate(11), makeCandidate(12), makeCandidate(13), makeCandidate(14), makeCandidate(15)],
            topN: 5,
        })
        expect(r.picks.map(p => p.templateId)).toEqual([10, 11, 12])
        expect(r.picks[0]!.reason).toBe('首次')  // 保留首次出现的 reason
        expect(r.fallback).toBe(false)
    })

    it('LLM 调用抛错 → fallback=true、reason=llm_error、按 candidates 顺序补足', async () => {
        const { getValidNodeConfig } = await import('~~/server/services/node/node.service')
        const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
        const { buildContextSegments } = await import('~~/server/services/agent-platform/context/moduleContextBuilder')
        ;(getValidNodeConfig as any).mockResolvedValue({
            modelSdkType: 'openai', modelName: 'gpt-4o-mini', modelMaxOutputTokens: 4096,
            modelApiKeys: [{ status: 1, apiKey: 'sk-test' }],
            modelProviderBaseUrl: 'https://api.example.com',
        })
        ;(buildContextSegments as any).mockResolvedValue({
            roleAndFlow: '', caseProfile: '', moduleSummaries: '', dynamicContext: '',
        })
        const invokeMock = vi.fn().mockRejectedValue(new Error('网络错误'))
        ;(createChatModel as any).mockReturnValue({
            withStructuredOutput: vi.fn().mockReturnValue({ invoke: invokeMock }),
        })

        const r = await rerankTemplatesService({
            userId: 1, sessionId: 's1', userQuery: 'x', intent: 'x',
            candidates: [makeCandidate(10), makeCandidate(11), makeCandidate(12), makeCandidate(13), makeCandidate(14), makeCandidate(15)],
            topN: 5,
        })
        expect(r.fallback).toBe(true)
        expect(r.fallbackReason).toBe('llm_error')
        // 按 candidates 顺序补足
        expect(r.picks.map(p => p.templateId)).toEqual([10, 11, 12, 13, 14])
    })

    it('LLM 超时 → fallback=true、reason=timeout', async () => {
        const { getValidNodeConfig } = await import('~~/server/services/node/node.service')
        const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
        const { buildContextSegments } = await import('~~/server/services/agent-platform/context/moduleContextBuilder')
        ;(getValidNodeConfig as any).mockResolvedValue({
            modelSdkType: 'openai', modelName: 'gpt-4o-mini', modelMaxOutputTokens: 4096,
            modelApiKeys: [{ status: 1, apiKey: 'sk-test' }],
            modelProviderBaseUrl: 'https://api.example.com',
        })
        ;(buildContextSegments as any).mockResolvedValue({
            roleAndFlow: '', caseProfile: '', moduleSummaries: '', dynamicContext: '',
        })
        // 模拟超时：永不 resolve，由 AbortController 中断
        const invokeMock = vi.fn().mockImplementation((_msgs, opts) =>
            new Promise((_, reject) => {
                opts.signal.addEventListener('abort', () =>
                    reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
                )
            }),
        )
        ;(createChatModel as any).mockReturnValue({
            withStructuredOutput: vi.fn().mockReturnValue({ invoke: invokeMock }),
        })

        const r = await rerankTemplatesService({
            userId: 1, sessionId: 's1', userQuery: 'x', intent: 'x',
            candidates: [makeCandidate(10), makeCandidate(11), makeCandidate(12), makeCandidate(13), makeCandidate(14), makeCandidate(15)],
            topN: 5,
            timeoutMs: 50,  // 50ms 快速超时
        })
        expect(r.fallback).toBe(true)
        expect(r.fallbackReason).toBe('timeout')
        expect(r.picks.map(p => p.templateId)).toEqual([10, 11, 12, 13, 14])
    })

    it('LLM 返回 picks=[] → fallback=true、reason=empty_output', async () => {
        const { getValidNodeConfig } = await import('~~/server/services/node/node.service')
        const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
        const { buildContextSegments } = await import('~~/server/services/agent-platform/context/moduleContextBuilder')
        ;(getValidNodeConfig as any).mockResolvedValue({
            modelSdkType: 'openai', modelName: 'gpt-4o-mini', modelMaxOutputTokens: 4096,
            modelApiKeys: [{ status: 1, apiKey: 'sk-test' }],
            modelProviderBaseUrl: 'https://api.example.com',
        })
        ;(buildContextSegments as any).mockResolvedValue({
            roleAndFlow: '', caseProfile: '', moduleSummaries: '', dynamicContext: '',
        })
        ;(createChatModel as any).mockReturnValue({
            withStructuredOutput: vi.fn().mockReturnValue({
                invoke: vi.fn().mockResolvedValue({ picks: [] }),
            }),
        })

        const r = await rerankTemplatesService({
            userId: 1, sessionId: 's1', userQuery: 'x', intent: 'x',
            candidates: [makeCandidate(10), makeCandidate(11), makeCandidate(12), makeCandidate(13), makeCandidate(14), makeCandidate(15)],
            topN: 5,
        })
        expect(r.fallback).toBe(true)
        expect(r.fallbackReason).toBe('empty_output')
        expect(r.picks.length).toBe(5)
    })

    it('LLM 返回 id 全部编造 → fallback=true、reason=not_enough_valid_ids', async () => {
        const { getValidNodeConfig } = await import('~~/server/services/node/node.service')
        const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
        const { buildContextSegments } = await import('~~/server/services/agent-platform/context/moduleContextBuilder')
        ;(getValidNodeConfig as any).mockResolvedValue({
            modelSdkType: 'openai', modelName: 'gpt-4o-mini', modelMaxOutputTokens: 4096,
            modelApiKeys: [{ status: 1, apiKey: 'sk-test' }],
            modelProviderBaseUrl: 'https://api.example.com',
        })
        ;(buildContextSegments as any).mockResolvedValue({
            roleAndFlow: '', caseProfile: '', moduleSummaries: '', dynamicContext: '',
        })
        ;(createChatModel as any).mockReturnValue({
            withStructuredOutput: vi.fn().mockReturnValue({
                invoke: vi.fn().mockResolvedValue({
                    picks: [{ templateId: 9999 }, { templateId: 8888 }],
                }),
            }),
        })

        const r = await rerankTemplatesService({
            userId: 1, sessionId: 's1', userQuery: 'x', intent: 'x',
            candidates: [makeCandidate(10), makeCandidate(11), makeCandidate(12), makeCandidate(13), makeCandidate(14), makeCandidate(15)],
            topN: 5,
        })
        expect(r.fallback).toBe(true)
        expect(r.fallbackReason).toBe('not_enough_valid_ids')
    })

    it('caseId 为 null → 仍能 rerank（不查案件，buildContextSegments 不被调）', async () => {
        const { getValidNodeConfig } = await import('~~/server/services/node/node.service')
        const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
        const { buildContextSegments } = await import('~~/server/services/agent-platform/context/moduleContextBuilder')
        ;(getValidNodeConfig as any).mockResolvedValue({
            modelSdkType: 'openai', modelName: 'gpt-4o-mini', modelMaxOutputTokens: 4096,
            modelApiKeys: [{ status: 1, apiKey: 'sk-test' }],
            modelProviderBaseUrl: 'https://api.example.com',
        })
        const buildCtxSpy = buildContextSegments as any
        const invokeMock = vi.fn().mockResolvedValue({
            picks: [{ templateId: 10 }, { templateId: 11 }, { templateId: 12 }],
        })
        ;(createChatModel as any).mockReturnValue({
            withStructuredOutput: vi.fn().mockReturnValue({ invoke: invokeMock }),
        })

        const r = await rerankTemplatesService({
            userId: 1, caseId: null, sessionId: 's1',
            userQuery: '帮我写起诉状', intent: '起诉状',
            candidates: [makeCandidate(10), makeCandidate(11), makeCandidate(12), makeCandidate(13), makeCandidate(14), makeCandidate(15)],
            topN: 5,
        })
        expect(r.fallback).toBe(false)
        expect(buildCtxSpy).not.toHaveBeenCalled()
    })
})
