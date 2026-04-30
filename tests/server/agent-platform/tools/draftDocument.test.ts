/**
 * draft_document 子代理工具单测
 *
 * 用 vi.mock 拦截：
 * - `interrupt()` —— 模拟 LangGraph resume 返回值
 * - templateRecommend / createDraft / runDocumentChat / runAndDrainStream / DAO 读取
 * - publishCustomEvent / DocumentTemplate / DocumentDraft DAO
 *
 * 覆盖 3 条主路径：
 * 1. 成功路径：interrupt 返回 templateId → 创建草稿 → drain 成功 → 发 DRAFT_SAVED → 返回成功 JSON
 * 2. 用户取消：interrupt 返回 null → 不创建草稿，返回 cancelled JSON
 * 3. interrupt 返回 templateId 非 number：当作取消处理
 *
 * **Feature: ai-unify-stage-5 / Task 3**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// 把全部依赖在 import 工具之前 mock 掉
vi.mock('@langchain/langgraph', async () => {
    const actual = await vi.importActual<any>('@langchain/langgraph')
    return { ...actual, interrupt: vi.fn() }
})
vi.mock('~~/server/agents/document/templateRecommend.service', () => ({
    recommendDocumentTemplatesService: vi.fn(),
}))
vi.mock('~~/server/agents/document/documentDraft.service', () => ({
    createDraftService: vi.fn(),
}))
vi.mock('~~/server/agents/document/documentDraft.dao', () => ({
    getDocumentDraftDAO: vi.fn(),
    updateDocumentDraftDAO: vi.fn(),
}))
vi.mock('~~/server/agents/document/documentTemplate.dao', () => ({
    getDocumentTemplateDAO: vi.fn(),
}))
vi.mock('~~/server/services/workflow/agents/documentMainAgent', () => ({
    runDocumentChat: vi.fn(),
}))
vi.mock('~~/server/services/agent-platform/subAgent/runAndDrain', () => ({
    runAndDrainStream: vi.fn(),
}))
vi.mock('~~/server/services/agent/agentEventBridge', () => ({
    publishCustomEvent: vi.fn().mockResolvedValue(undefined),
}))

import { interrupt } from '@langchain/langgraph'
import { createTool } from '~~/server/services/agent-platform/tools/draftDocument.tool'
import { recommendDocumentTemplatesService } from '~~/server/agents/document/templateRecommend.service'
import { createDraftService } from '~~/server/agents/document/documentDraft.service'
import { getDocumentDraftDAO } from '~~/server/agents/document/documentDraft.dao'
import { getDocumentTemplateDAO } from '~~/server/agents/document/documentTemplate.dao'
import { runDocumentChat } from '~~/server/services/workflow/agents/documentMainAgent'
import { runAndDrainStream } from '~~/server/services/agent-platform/subAgent/runAndDrain'
import { publishCustomEvent } from '~~/server/services/agent/agentEventBridge'

const ctx = { userId: 7, sessionId: 'sess-1', runId: 'run-1' }

const baseInput = { intent: '帮我写一份起诉状' }
/** 模拟 ToolRunnableConfig（仅含 toolCall.id） */
const cfg = { toolCall: { id: 'call-abc' } }

describe('draft_document tool', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('成功路径：interrupt 拿 templateId → 创建草稿 → drain → 发 DRAFT_SAVED → 返回 success JSON', async () => {
        ;(recommendDocumentTemplatesService as any).mockResolvedValue({
            items: [{ templateId: 11, name: '起诉状' }],
            total: 12,
            usedKeywords: ['起诉状'],
            fallbackToRecency: false,
        })
        ;(interrupt as any).mockReturnValueOnce({ templateId: 11, sourceText: '欠薪 5 万' })
        ;(createDraftService as any).mockResolvedValue({
            draftId: 101,
            sessionId: 'sub-sess-101',
        })
        ;(runDocumentChat as any).mockResolvedValue(new ReadableStream())
        ;(runAndDrainStream as any).mockResolvedValue({ success: true, finalState: {} })
        ;(getDocumentDraftDAO as any).mockResolvedValue({
            id: 101,
            title: '民事起诉状（劳动争议）',
            // tool 不再轮询 status（双实例 race 已通过 enqueueAgentRun:false 修掉），
            // runAndDrainStream 返回时 LangGraph hook 已 await 完成
            status: 'ready',
            values: { plaintiff: '张三', defendant: '某公司' },
        })
        ;(getDocumentTemplateDAO as any).mockResolvedValue({
            id: 11,
            name: '起诉状',
            placeholders: [{ key: 'plaintiff' }, { key: 'defendant' }, { key: 'amount' }],
        })

        const tool = createTool(ctx)
        const raw: any = await tool.invoke(baseInput, cfg as any)
        // tool.invoke 返回 ToolMessage（content: 工具返回的字符串）；解 content 拿 JSON
        const result = JSON.parse(typeof raw === 'string' ? raw : raw.content)

        // interrupt payload 形态：type 顶层 + toolCallId + 推荐数据
        expect(interrupt).toHaveBeenCalledWith(expect.objectContaining({
            type: 'template_select',
            toolCallId: 'call-abc',
            intent: '帮我写一份起诉状',
            total: 12,
        }))
        // createDraft 用了 resume value 的 sourceText；
        // enqueueAgentRun:false 关掉 createDraftService 内部的入队，避免 worker + tool 双实例并发同 thread_id
        expect(createDraftService).toHaveBeenCalledWith(expect.objectContaining({
            userId: 7,
            templateId: 11,
            sourceText: '欠薪 5 万',
            enqueueAgentRun: false,
        }))
        // 子流执行 + drain
        expect(runDocumentChat).toHaveBeenCalledWith('sub-sess-101', undefined, expect.objectContaining({ userId: 7 }))
        expect(runAndDrainStream).toHaveBeenCalled()
        // DRAFT_SAVED 事件发出
        expect(publishCustomEvent).toHaveBeenCalledWith(expect.objectContaining({
            name: 'draft_saved',
            data: expect.objectContaining({ draftId: 101, title: '民事起诉状（劳动争议）' }),
        }))
        // 返回 LLM 的 JSON
        expect(result.success).toBe(true)
        expect(result.draftId).toBe(101)
        expect(result.title).toBe('民事起诉状（劳动争议）')
        expect(result.filledFieldCount).toBe(2)
        expect(result.totalFields).toBe(3)
        expect(result.href).toMatch(/^\/dashboard\/document\/drafts\/101\?from=assistant/)
    })

    it('用户取消（interrupt 返回 null）→ 不创建草稿 + 返回 cancelled JSON', async () => {
        ;(recommendDocumentTemplatesService as any).mockResolvedValue({
            items: [], total: 0, usedKeywords: [], fallbackToRecency: false,
        })
        ;(interrupt as any).mockReturnValueOnce(null)

        const tool = createTool(ctx)
        const raw: any = await tool.invoke(baseInput, cfg as any)
        // tool.invoke 返回 ToolMessage（content: 工具返回的字符串）；解 content 拿 JSON
        const result = JSON.parse(typeof raw === 'string' ? raw : raw.content)

        expect(result).toEqual({ success: false, cancelled: true, message: '用户已取消模板选择' })
        expect(createDraftService).not.toHaveBeenCalled()
        expect(runDocumentChat).not.toHaveBeenCalled()
        expect(publishCustomEvent).not.toHaveBeenCalled()
    })

    it('resume value 缺 templateId（如 templateId 非 number）→ 当作取消', async () => {
        ;(recommendDocumentTemplatesService as any).mockResolvedValue({
            items: [], total: 0, usedKeywords: [], fallbackToRecency: false,
        })
        ;(interrupt as any).mockReturnValueOnce({ templateId: 'not-a-number' })

        const tool = createTool(ctx)
        const raw: any = await tool.invoke(baseInput, cfg as any)
        // tool.invoke 返回 ToolMessage（content: 工具返回的字符串）；解 content 拿 JSON
        const result = JSON.parse(typeof raw === 'string' ? raw : raw.content)

        expect(result.cancelled).toBe(true)
        expect(createDraftService).not.toHaveBeenCalled()
    })

    it('drain 失败 → 抛错（让 LLM 看到工具失败）+ 把 draft.status 改成 failed', async () => {
        ;(recommendDocumentTemplatesService as any).mockResolvedValue({
            items: [], total: 0, usedKeywords: [], fallbackToRecency: false,
        })
        ;(interrupt as any).mockReturnValueOnce({ templateId: 11 })
        ;(createDraftService as any).mockResolvedValue({ draftId: 101, sessionId: 'sub' })
        ;(runDocumentChat as any).mockResolvedValue(new ReadableStream())
        ;(runAndDrainStream as any).mockResolvedValue({ success: false, error: 'LLM 超时' })
        // graph 抛错时 hook 不跑，draft 还卡在 filling；tool 必须主动改 failed
        const { updateDocumentDraftDAO } = await import('~~/server/agents/document/documentDraft.dao')
        ;(updateDocumentDraftDAO as any).mockResolvedValue({})

        const tool = createTool(ctx)
        await expect(tool.invoke(baseInput, cfg as any)).rejects.toThrow(/文书 Agent 执行失败.*LLM 超时/)
        // 兜底：tool 应主动把 draft 标 failed，避免 status 卡 filling
        expect(updateDocumentDraftDAO).toHaveBeenCalledWith(101, { status: 'failed' })
    })

    it('drain 成功但 draft.status=failed（hook 内 catch 写 failed）→ 抛错防止假成功', async () => {
        ;(recommendDocumentTemplatesService as any).mockResolvedValue({
            items: [], total: 0, usedKeywords: [], fallbackToRecency: false,
        })
        ;(interrupt as any).mockReturnValueOnce({ templateId: 11 })
        ;(createDraftService as any).mockResolvedValue({ draftId: 101, sessionId: 'sub' })
        ;(runDocumentChat as any).mockResolvedValue(new ReadableStream())
        ;(runAndDrainStream as any).mockResolvedValue({ success: true, finalState: {} })
        // hook 已经把 status 写成 failed（structuredResponse 缺失 + 所有 fallback 都失败）
        ;(getDocumentDraftDAO as any).mockResolvedValue({
            id: 101,
            title: '民事起诉状',
            status: 'failed',
            values: {},
        })
        ;(getDocumentTemplateDAO as any).mockResolvedValue({
            id: 11, name: '起诉状', placeholders: [{ key: 'a' }],
        })

        const tool = createTool(ctx)
        // 不应再返回"已建好空白草稿"假成功——必须显式抛错
        await expect(tool.invoke(baseInput, cfg as any)).rejects.toThrow(/起草失败.*status=failed|toolStrategy/)
    })
})
