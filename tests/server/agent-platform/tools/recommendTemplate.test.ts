import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('~~/server/agents/document/templateRecommend.service', () => ({
    recommendDocumentTemplatesService: vi.fn(),
}))
vi.mock('~~/server/agents/document/documentTemplate.dao', () => ({
    getDocumentTemplateDAO: vi.fn(),
}))

// vi.mock 会被 hoist 到文件顶部，factory 中不能引用外部变量。
// 用 vi.hoisted 把 mock 函数提升到与 vi.mock 同级，避免 TDZ 报错。
const { interruptMock } = vi.hoisted(() => ({ interruptMock: vi.fn() }))
vi.mock('@langchain/langgraph', () => ({
    interrupt: interruptMock,
}))

import { createTool, toolDefinition } from '~~/server/services/agent-platform/tools/recommendTemplate.tool'
import { recommendDocumentTemplatesService } from '~~/server/agents/document/templateRecommend.service'
import { getDocumentTemplateDAO } from '~~/server/agents/document/documentTemplate.dao'

describe('recommend_template tool', () => {
    beforeEach(() => {
        vi.resetAllMocks()
    })

    it('toolDefinition 有正确的 name 和 schema', () => {
        expect(toolDefinition.name).toBe('recommend_template')
    })

    it('成功路径:推荐 + interrupt + resume + 拉 placeholders', async () => {
        ;(recommendDocumentTemplatesService as any).mockResolvedValue({
            items: [{ id: 1, name: '民事起诉状' }],
            total: 1,
            usedKeywords: ['起诉状'],
            fallbackToRecency: false,
        })
        // interrupt 返回包装的 resume value:{ resume: { [toolCallId]: { templateId: 1 } } }
        interruptMock.mockReturnValue({
            resume: { 'call-id-x': { templateId: 1 } },
        })
        ;(getDocumentTemplateDAO as any).mockResolvedValue({
            id: 1,
            name: '民事起诉状',
            category: '民事',
            placeholders: [
                { name: '原告', firstContext: '原告:{{原告}}' },
                { name: '被告', firstContext: '被告:{{被告}}' },
            ],
        })

        // tool() 第二个参数是 cfg,通过 toolCall.id 传 toolCallId
        const tool = createTool({ userId: 1, sessionId: 'sess-x' })
        const raw: any = await tool.invoke(
            { intent: '起草起诉状', keywords: ['起诉状'] },
            { configurable: {}, toolCall: { id: 'call-id-x' } } as any,
        )
        // tool.invoke 返回 ToolMessage（content 为工具返回的字符串），需解 content 取 JSON
        const parsed = JSON.parse(typeof raw === 'string' ? raw : raw.content)
        expect(parsed.success).toBe(true)
        expect(parsed.templateId).toBe(1)
        expect(parsed.templateName).toBe('民事起诉状')
        expect(parsed.placeholders).toEqual([
            { name: '原告', firstContext: '原告:{{原告}}' },
            { name: '被告', firstContext: '被告:{{被告}}' },
        ])
    })

    it('用户取消(resume value 为 null):返回 cancelled=true', async () => {
        ;(recommendDocumentTemplatesService as any).mockResolvedValue({
            items: [], total: 0, usedKeywords: [], fallbackToRecency: false,
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
            items: [{ id: 5, name: '答辩状' }], total: 1, usedKeywords: [], fallbackToRecency: false,
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
