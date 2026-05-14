import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('~~/server/agents/document/templateRecommend.service', () => ({
    recommendDocumentTemplatesService: vi.fn(),
}))
vi.mock('~~/server/agents/document/templateRerank.service', () => ({
    rerankTemplatesService: vi.fn(),
}))
vi.mock('~~/server/agents/document/documentTemplate.dao', () => ({
    getDocumentTemplateDAO: vi.fn(),
}))

// vi.mock 会被 hoist 到文件顶部，factory 中不能引用外部变量。
// 用 vi.hoisted 把 mock 函数提升到与 vi.mock 同级，避免 TDZ 报错。
const { interruptMock } = vi.hoisted(() => ({ interruptMock: vi.fn() }))
vi.mock('@langchain/langgraph', () => ({
    interrupt: interruptMock,
    isGraphBubbleUp: (err: unknown) => err instanceof Error && err.message.startsWith('__BUBBLE__'),
}))

import { createTool, toolDefinition } from '~~/server/services/agent-platform/tools/recommendTemplate.tool'
import { recommendDocumentTemplatesService } from '~~/server/agents/document/templateRecommend.service'
import { rerankTemplatesService } from '~~/server/agents/document/templateRerank.service'
import { getDocumentTemplateDAO } from '~~/server/agents/document/documentTemplate.dao'

describe('recommend_template tool', () => {
    beforeEach(() => {
        vi.resetAllMocks()
    })

    it('toolDefinition 有正确的 name 和 schema', () => {
        expect(toolDefinition.name).toBe('recommend_template')
    })

    it('成功路径：粗筛 30 候选 → rerank 选 top 5 → interrupt → resume → 拉 placeholders', async () => {
        ;(recommendDocumentTemplatesService as any).mockResolvedValue({
            items: [
                { id: 1, name: '民事起诉状', category: 'litigation', scope: 'global', description: null, priority: 100, score: 14, recentlyUsed: false },
                { id: 2, name: '答辩状', category: 'litigation', scope: 'global', description: null, priority: 100, score: 12, recentlyUsed: false },
                { id: 3, name: '调解协议', category: 'general', scope: 'global', description: null, priority: 100, score: 5, recentlyUsed: false },
            ],
            total: 3,
            usedKeywords: ['起诉状'],
            fallbackToRecency: false,
        })
        ;(rerankTemplatesService as any).mockResolvedValue({
            picks: [{ templateId: 1, reason: '最贴近起诉需求' }],
            fallback: false,
        })
        interruptMock.mockReturnValue({ resume: { 'call-id-x': { templateId: 1 } } })
        ;(getDocumentTemplateDAO as any).mockResolvedValue({
            id: 1, name: '民事起诉状', category: 'litigation',
            placeholders: [{ name: '原告' }, { name: '被告' }],
        })

        const tool = createTool({ userId: 1, sessionId: 'sess-x', caseId: 99 })
        const raw: any = await tool.invoke(
            { intent: '起草起诉状', keywords: ['起诉状'] },
            { configurable: {}, toolCall: { id: 'call-id-x' } } as any,
        )
        const parsed = JSON.parse(typeof raw === 'string' ? raw : raw.content)
        expect(parsed.success).toBe(true)
        expect(parsed.templateId).toBe(1)
        expect(parsed.placeholders).toEqual([{ name: '原告' }, { name: '被告' }])
        // 粗筛传 limit=30；rerank 收到 candidates 含 recentlyUsed 字段
        expect((recommendDocumentTemplatesService as any).mock.calls[0][0].limit).toBe(30)
        expect((rerankTemplatesService as any).mock.calls[0][0].candidates[0]).toMatchObject({
            id: 1, name: '民事起诉状', recentlyUsed: false,
        })
        // interrupt payload 中的 recommendations 只剩 rerank 后的 1 条
        const interruptPayload = interruptMock.mock.calls[0][0]
        expect(interruptPayload.type).toBe('template_select')
        expect(interruptPayload.recommendations.map((r: any) => r.id)).toEqual([1])
    })

    it('rerank fallback：LLM 失败时按粗筛顺序展示，仍能正常弹卡 + resume', async () => {
        ;(recommendDocumentTemplatesService as any).mockResolvedValue({
            items: [
                { id: 1, name: '民事起诉状', category: 'litigation', scope: 'global', description: null, priority: 100, score: 14, recentlyUsed: false },
                { id: 2, name: '答辩状', category: 'litigation', scope: 'global', description: null, priority: 100, score: 12, recentlyUsed: false },
            ],
            total: 2,
            usedKeywords: ['起诉状'],
            fallbackToRecency: false,
        })
        ;(rerankTemplatesService as any).mockResolvedValue({
            picks: [{ templateId: 1 }, { templateId: 2 }],
            fallback: true,
            fallbackReason: 'llm_error',
        })
        interruptMock.mockReturnValue({ resume: { 'call-id-x': { templateId: 1 } } })
        ;(getDocumentTemplateDAO as any).mockResolvedValue({ id: 1, name: '民事起诉状', placeholders: [] })

        const tool = createTool({ userId: 1, sessionId: 'sess-x' })
        const raw: any = await tool.invoke(
            { intent: '起诉' },
            { configurable: {}, toolCall: { id: 'call-id-x' } } as any,
        )
        const parsed = JSON.parse(typeof raw === 'string' ? raw : raw.content)
        expect(parsed.success).toBe(true)
        // fallback 时 interrupt payload 也要带 fallbackReason，便于前端可选展示降级提示
        const interruptPayload = interruptMock.mock.calls[0][0]
        expect(interruptPayload.rerankFallback).toBe(true)
        expect(interruptPayload.rerankFallbackReason).toBe('llm_error')
    })

    it('用户取消(resume value 为 null):返回 cancelled=true', async () => {
        ;(recommendDocumentTemplatesService as any).mockResolvedValue({
            items: [], total: 0, usedKeywords: [], fallbackToRecency: false,
        })
        ;(rerankTemplatesService as any).mockResolvedValue({
            picks: [],
            fallback: false,
        })
        interruptMock.mockReturnValue({ resume: { 'call-id-x': null } })

        const tool = createTool({ userId: 1, sessionId: 'sess-x' })
        const raw: any = await tool.invoke(
            { intent: '起草起诉状' },
            { configurable: {}, toolCall: { id: 'call-id-x' } } as any,
        )
        const parsed = JSON.parse(typeof raw === 'string' ? raw : raw.content)
        expect(parsed.success).toBe(false)
        expect(parsed.cancelled).toBe(true)
    })

    it('toolCallId 双层包装解包:支持 { resume: { [id]: value } } 形态', async () => {
        ;(recommendDocumentTemplatesService as any).mockResolvedValue({
            items: [
                { id: 5, name: '答辩状', category: 'litigation', scope: 'global', description: null, priority: 100, score: 10, recentlyUsed: false },
            ],
            total: 1,
            usedKeywords: [],
            fallbackToRecency: false,
        })
        ;(rerankTemplatesService as any).mockResolvedValue({
            picks: [{ templateId: 5 }],
            fallback: false,
        })
        interruptMock.mockReturnValue({ resume: { 'tc-789': { templateId: 5 } } })
        ;(getDocumentTemplateDAO as any).mockResolvedValue({ id: 5, name: '答辩状', placeholders: [] })

        const tool = createTool({ userId: 1, sessionId: 'sess-x' })
        const raw: any = await tool.invoke(
            { intent: '答辩' },
            { configurable: {}, toolCall: { id: 'tc-789' } } as any,
        )
        const parsed = JSON.parse(typeof raw === 'string' ? raw : raw.content)
        expect(parsed.templateId).toBe(5)
    })
})
