import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('~~/server/agents/document/documentDraft.service', () => ({
    patchDraftService: vi.fn(),
    applyAITitleIfAllowedService: vi.fn(),
}))
vi.mock('~~/server/services/agent/agentEventBridge', () => ({
    publishCustomEvent: vi.fn(),
}))

import { createTool, toolDefinition } from '~~/server/services/agent-platform/tools/updateDocumentDraft.tool'
import { patchDraftService, applyAITitleIfAllowedService } from '~~/server/agents/document/documentDraft.service'
import { publishCustomEvent } from '~~/server/services/agent/agentEventBridge'

describe('update_document_draft tool', () => {
    beforeEach(() => {
        vi.resetAllMocks()
    })

    it('toolDefinition 有正确的 name 和 schema', () => {
        expect(toolDefinition.name).toBe('update_document_draft')
        expect(toolDefinition.schema).toBeDefined()
    })

    it('成功路径:复用 patchDraftService + 发 SSE event', async () => {
        ;(patchDraftService as any).mockResolvedValue({
            draft: { id: 100, values: { 原告: '张三', 被告: '李四' } },
        })
        ;(publishCustomEvent as any).mockResolvedValue(undefined)

        const tool = createTool({ userId: 1, sessionId: 'sess-x', runId: 'run-x' })
        const result = await tool.invoke({
            draftId: 100,
            fieldUpdates: { 被告: '李四' },
        })

        const parsed = JSON.parse(result as string)
        expect(parsed.success).toBe(true)
        expect(parsed.draftId).toBe(100)
        expect(parsed.changedFields).toContain('被告')

        expect(patchDraftService).toHaveBeenCalledWith(1, 100, expect.objectContaining({
            values: { 被告: '李四' },
        }))

        expect(publishCustomEvent).toHaveBeenCalledWith(expect.objectContaining({
            name: 'draft_updated', // SSECustomEventType.DRAFT_UPDATED 枚举值
        }))
    })

    it('patchDraftService 返回 ServiceError 时 throw', async () => {
        ;(patchDraftService as any).mockResolvedValue({ error: '草稿不存在', code: 404 })

        const tool = createTool({ userId: 1, sessionId: 'sess-x' })
        const result = await tool.invoke({
            draftId: 999,
            fieldUpdates: { 被告: '李四' },
        })

        const parsed = JSON.parse(result as string)
        expect(parsed.success).toBe(false)
        expect(parsed.error).toContain('草稿不存在')
    })

    it('传入 suggestions 时一并写入 metadata', async () => {
        ;(patchDraftService as any).mockResolvedValue({ draft: { id: 100, values: {} } })

        const tool = createTool({ userId: 1, sessionId: 'sess-x' })
        await tool.invoke({
            draftId: 100,
            fieldUpdates: { 被告: '李四' },
            suggestions: { 被告住址: '请补充' },
        })

        expect(patchDraftService).toHaveBeenCalledWith(1, 100, expect.objectContaining({
            metadata: expect.objectContaining({
                suggestions: { 被告住址: '请补充' },
            }),
        }))
    })

    it('传入 aiTitle 时调 applyAITitleIfAllowedService', async () => {
        ;(patchDraftService as any).mockResolvedValue({ draft: { id: 100, values: {} } })
        ;(applyAITitleIfAllowedService as any).mockResolvedValue(true)

        const tool = createTool({ userId: 1, sessionId: 'sess-x' })
        await tool.invoke({
            draftId: 100,
            fieldUpdates: { 被告: '李四' },
            aiTitle: '新标题',
        })

        expect(applyAITitleIfAllowedService).toHaveBeenCalledWith(100, '新标题')
    })

    // 回归：截图 bug 同源——LLM 在 update 时也会回传"【待补充：xxx】"占位字符串。
    // 兜底逻辑：cleanAIFieldUpdates 直接丢弃占位符 key,保持原值不变(避免误清空)。
    it('LLM 占位字符串被丢弃,只 patch 真值,不进 changedFields', async () => {
        ;(patchDraftService as any).mockResolvedValue({
            draft: { id: 100, values: { 被告: '李四', 被告住址: '原住址不动' } },
        })

        const tool = createTool({ userId: 1, sessionId: 'sess-x', runId: 'run-x' })
        const result = await tool.invoke({
            draftId: 100,
            fieldUpdates: {
                被告: '李四',                       // 真值,要 patch
                被告住址: '【待补充：被告住址】',     // 占位,跳过
                法院名称: '【未提供】',              // 占位,跳过
            },
        })

        const parsed = JSON.parse(result as string)
        expect(parsed.success).toBe(true)
        expect(parsed.changedFields).toEqual(['被告'])

        // patchDraftService 只收到非占位字段
        expect(patchDraftService).toHaveBeenCalledWith(1, 100, expect.objectContaining({
            values: { 被告: '李四' },
        }))
    })

    it('LLM 全部回传占位字符串时,patchDraftService 收到空对象,changedFields 为空', async () => {
        ;(patchDraftService as any).mockResolvedValue({ draft: { id: 100, values: {} } })

        const tool = createTool({ userId: 1, sessionId: 'sess-x' })
        const result = await tool.invoke({
            draftId: 100,
            fieldUpdates: {
                被告住址: '【待补充：被告住址】',
                法院名称: '【未提供】',
            },
        })

        const parsed = JSON.parse(result as string)
        expect(parsed.success).toBe(true)
        expect(parsed.changedFields).toEqual([])
        expect(patchDraftService).toHaveBeenCalledWith(1, 100, expect.objectContaining({
            values: {},
        }))
    })

    it('返回值含跳转 href：caseId 存在 → from=xiaosuo&caseId=...，否则 from=assistant', async () => {
        ;(patchDraftService as any).mockResolvedValue({
            draft: { id: 100, values: { 被告: '李四' } },
        })

        // case 1: 通用问答场景，无 caseId
        const tool1 = createTool({ userId: 1, sessionId: 'sess-x', runId: 'run-x' })
        const out1 = JSON.parse(await tool1.invoke({ draftId: 100, fieldUpdates: { 被告: '李四' } }) as string)
        expect(out1.href).toBe('/dashboard/document/drafts/100?from=assistant&sessionId=sess-x')

        // case 2: 小索场景，带 caseId
        const tool2 = createTool({ userId: 1, sessionId: 'sess-y', runId: 'run-y', caseId: 42 })
        const out2 = JSON.parse(await tool2.invoke({ draftId: 100, fieldUpdates: { 被告: '李四' } }) as string)
        expect(out2.href).toBe('/dashboard/document/drafts/100?from=xiaosuo&sessionId=sess-y&caseId=42')
    })

    // 回归：documentMain system prompt 里把 draftId 渲染成"草稿 ID:90"，LLM 偶尔会原样把 "90"
    // 字符串当成 draftId 回传，导致 zod 抛 "expected number, received string"。
    // schema 应当 coerce 字符串 → number，对齐 reviewContract.tool 的同类修复。
    it('schema 自动把字符串 draftId coerce 为 number(LLM 把 prompt 中的草稿 ID 当字符串回传)', async () => {
        ;(patchDraftService as any).mockResolvedValue({
            draft: { id: 90, values: { 被告: '李四' } },
        })

        const tool = createTool({ userId: 1, sessionId: 'sess-x', runId: 'run-x' })
        const result = await tool.invoke({
            draftId: '90' as unknown as number,
            fieldUpdates: { 被告: '李四' },
        })

        const parsed = JSON.parse(result as string)
        expect(parsed.success).toBe(true)
        expect(parsed.draftId).toBe(90)
        expect(patchDraftService).toHaveBeenCalledWith(1, 90, expect.any(Object))
    })
})
