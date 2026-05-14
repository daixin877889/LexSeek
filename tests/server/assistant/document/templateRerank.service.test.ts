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
})
