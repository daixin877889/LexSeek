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

    it('interrupt 单层包装：resume value 直接是 { templateId } 不带 toolCallId 嵌套', async () => {
        ;(recommendDocumentTemplatesService as any).mockResolvedValue({
            items: [
                { id: 7, name: '上诉状', category: 'litigation', scope: 'global', description: null, priority: 100, score: 8, recentlyUsed: false },
            ],
            total: 1, usedKeywords: [], fallbackToRecency: false,
        })
        ;(rerankTemplatesService as any).mockResolvedValue({
            picks: [{ templateId: 7 }],
            fallback: false,
        })
        // 单层包装：interrupt 直接返回 { templateId } 不带 resume 嵌套，layer1 就是结果本身
        interruptMock.mockReturnValue({ templateId: 7, sourceText: '附加说明' })
        ;(getDocumentTemplateDAO as any).mockResolvedValue({ id: 7, name: '上诉状', placeholders: [] })

        const tool = createTool({ userId: 1, sessionId: 'sess-x' })
        const raw: any = await tool.invoke(
            { intent: '上诉' },
            { configurable: {}, toolCall: { id: 'no-match-id' } } as any,
        )
        const parsed = JSON.parse(typeof raw === 'string' ? raw : raw.content)
        expect(parsed.success).toBe(true)
        expect(parsed.templateId).toBe(7)
        expect(parsed.sourceText).toBe('附加说明')
    })

    it('ToolContext 缺 sessionId → 工具返回 error JSON（不抛冒泡）', async () => {
        const tool = createTool({ userId: 1, sessionId: '' as any })
        const raw: any = await tool.invoke(
            { intent: 'x' },
            { configurable: {}, toolCall: { id: 'tc' } } as any,
        )
        const parsed = JSON.parse(typeof raw === 'string' ? raw : raw.content)
        expect(parsed.success).toBe(false)
        expect(parsed.error).toContain('缺少 sessionId/userId')
    })

    it('ToolContext sessionId 存在但 userId 缺失 → 同样返回 error JSON', async () => {
        const tool = createTool({ userId: 0 as any, sessionId: 'sess-x' })
        const raw: any = await tool.invoke(
            { intent: 'x' },
            { configurable: {}, toolCall: { id: 'tc' } } as any,
        )
        const parsed = JSON.parse(typeof raw === 'string' ? raw : raw.content)
        expect(parsed.success).toBe(false)
        expect(parsed.error).toContain('缺少 sessionId/userId')
    })

    it('toolCall.id 缺失 → unpackInterruptResume 仍能识别单层包装', async () => {
        ;(recommendDocumentTemplatesService as any).mockResolvedValue({
            items: [
                { id: 8, name: '其它状', category: 'litigation', scope: 'global', description: null, priority: 100, score: 5, recentlyUsed: false },
            ],
            total: 1, usedKeywords: [], fallbackToRecency: false,
        })
        ;(rerankTemplatesService as any).mockResolvedValue({
            picks: [{ templateId: 8 }], fallback: false,
        })
        // resumed 是 null（resume 缺失）→ unpackInterruptResume 命中 `!resumed` 短路返回 null → cancelled
        interruptMock.mockReturnValue(null)

        const tool = createTool({ userId: 1, sessionId: 'sess-x' })
        const raw: any = await tool.invoke(
            { intent: 'x' },
            { configurable: {}, toolCall: { id: 'tc' } } as any,
        )
        const parsed = JSON.parse(typeof raw === 'string' ? raw : raw.content)
        expect(parsed.cancelled).toBe(true)
    })

    it('getDocumentTemplateDAO 返回 null → success=false 提示模板不存在', async () => {
        ;(recommendDocumentTemplatesService as any).mockResolvedValue({
            items: [
                { id: 9, name: '某状', category: 'litigation', scope: 'global', description: null, priority: 100, score: 10, recentlyUsed: false },
            ],
            total: 1, usedKeywords: [], fallbackToRecency: false,
        })
        ;(rerankTemplatesService as any).mockResolvedValue({
            picks: [{ templateId: 9 }], fallback: false,
        })
        interruptMock.mockReturnValue({ resume: { 'tc-9': { templateId: 9 } } })
        ;(getDocumentTemplateDAO as any).mockResolvedValue(null)  // 模板被软删

        const tool = createTool({ userId: 1, sessionId: 'sess-x' })
        const raw: any = await tool.invoke(
            { intent: 'x' },
            { configurable: {}, toolCall: { id: 'tc-9' } } as any,
        )
        const parsed = JSON.parse(typeof raw === 'string' ? raw : raw.content)
        expect(parsed.success).toBe(false)
        expect(parsed.error).toContain('不存在或已删除')
    })

    it('粗筛 service 抛错（非 GraphInterrupt）→ catch 返回 error JSON', async () => {
        ;(recommendDocumentTemplatesService as any).mockRejectedValue(new Error('数据库连接失败'))

        const tool = createTool({ userId: 1, sessionId: 'sess-x' })
        const raw: any = await tool.invoke(
            { intent: 'x' },
            { configurable: {}, toolCall: { id: 'tc' } } as any,
        )
        const parsed = JSON.parse(typeof raw === 'string' ? raw : raw.content)
        expect(parsed.success).toBe(false)
        expect(parsed.error).toBe('数据库连接失败')
    })

    it('粗筛 service 抛非 Error 类型异常 → catch 返回兜底文案', async () => {
        ;(recommendDocumentTemplatesService as any).mockRejectedValue('字符串异常')

        const tool = createTool({ userId: 1, sessionId: 'sess-x' })
        const raw: any = await tool.invoke(
            { intent: 'x' },
            { configurable: {}, toolCall: { id: 'tc' } } as any,
        )
        const parsed = JSON.parse(typeof raw === 'string' ? raw : raw.content)
        expect(parsed.success).toBe(false)
        expect(parsed.error).toBe('推荐模板失败')
    })

    it('粗筛 service 抛 GraphInterrupt-like 错误 → 工具重抛不吞掉', async () => {
        // 用 __BUBBLE__ 前缀，让 mock 中的 isGraphBubbleUp 识别为冒泡错误
        ;(recommendDocumentTemplatesService as any).mockRejectedValue(new Error('__BUBBLE__ParentCommand'))

        const tool = createTool({ userId: 1, sessionId: 'sess-x' })
        await expect(tool.invoke(
            { intent: 'x' },
            { configurable: {}, toolCall: { id: 'tc' } } as any,
        )).rejects.toThrow('__BUBBLE__ParentCommand')
    })
})
