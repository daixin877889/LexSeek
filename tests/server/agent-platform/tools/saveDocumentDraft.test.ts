import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock 依赖
vi.mock('~~/server/agents/document/documentDraft.service', () => ({
    createDraftService: vi.fn(),
    applyAITitleIfAllowedService: vi.fn(),
}))
vi.mock('~~/server/agents/document/documentDraft.dao', () => ({
    updateDocumentDraftDAO: vi.fn(),
    getDocumentDraftDAO: vi.fn(),
}))
vi.mock('~~/server/agents/document/documentDraftSnapshot.service', () => ({
    createSnapshotService: vi.fn(),
}))
vi.mock('~~/server/services/material/materialPipeline.service', () => ({
    ensureMaterialsReadyForDraftService: vi.fn(),
}))
vi.mock('~~/server/services/agent/agentEventBridge', () => ({
    publishCustomEvent: vi.fn(),
}))

import { createTool, toolDefinition } from '~~/server/services/agent-platform/tools/saveDocumentDraft.tool'
import { createDraftService, applyAITitleIfAllowedService } from '~~/server/agents/document/documentDraft.service'
import { updateDocumentDraftDAO } from '~~/server/agents/document/documentDraft.dao'
import { publishCustomEvent } from '~~/server/services/agent/agentEventBridge'

describe('save_document_draft tool', () => {
    beforeEach(() => {
        vi.resetAllMocks()
    })

    it('toolDefinition 有正确的 name 和 schema', () => {
        expect(toolDefinition.name).toBe('save_document_draft')
        expect(toolDefinition.schema).toBeDefined()
    })

    it('成功路径:创建 draft + 写 values + 发 SSE event', async () => {
        ;(createDraftService as any).mockResolvedValue({ draftId: 100, sessionId: 'session-100' })
        ;(updateDocumentDraftDAO as any).mockResolvedValue({ id: 100 })
        ;(publishCustomEvent as any).mockResolvedValue(undefined)

        const tool = createTool({ userId: 1, sessionId: 'sess-x', runId: 'run-x', caseId: 5 })
        const result = await tool.invoke({
            templateId: 1,
            fieldValues: { 原告: '张三', 被告: '李四' },
        })

        const parsed = JSON.parse(result as string)
        expect(parsed.success).toBe(true)
        expect(parsed.draftId).toBe(100)
        expect(parsed.sessionId).toBe('session-100')
        expect(parsed.href).toContain('/dashboard/document/drafts/100')

        // 验证 createDraftService 调用
        expect(createDraftService).toHaveBeenCalledWith(expect.objectContaining({
            userId: 1,
            templateId: 1,
            caseId: 5,
            enqueueAgentRun: false,
        }))

        // 验证立即 update 写 values + status='ready'
        expect(updateDocumentDraftDAO).toHaveBeenCalledWith(100, expect.objectContaining({
            values: expect.any(Object),
            status: 'ready',
        }))

        // 验证 SSE event 用 await 模式发(返回值已 resolve)
        expect(publishCustomEvent).toHaveBeenCalledWith(expect.objectContaining({
            name: 'draft_saved', // SSECustomEventType.DRAFT_SAVED 枚举值
        }))
    })

    it('校验失败:fieldValues 全部为 null 拒绝', async () => {
        const tool = createTool({ userId: 1, sessionId: 'sess-x' })
        const result = await tool.invoke({
            templateId: 1,
            fieldValues: { 原告: null, 被告: null },
        })

        const parsed = JSON.parse(result as string)
        expect(parsed.success).toBe(false)
        expect(parsed.error).toContain('至少一个非 null')
    })

    it('createDraftService 失败时 throw 让 LLM 重试', async () => {
        ;(createDraftService as any).mockResolvedValue({ error: '模板不存在', code: 404 })

        const tool = createTool({ userId: 1, sessionId: 'sess-x' })
        const result = await tool.invoke({
            templateId: 999,
            fieldValues: { 原告: '张三' },
        })

        const parsed = JSON.parse(result as string)
        expect(parsed.success).toBe(false)
        expect(parsed.error).toContain('模板不存在')
    })

    // 回归：与 update_document_draft 同款隐患——LLM 偶尔把数字 ID 当字符串传出（包括 templateId、fileIds），
    // schema 应当 coerce 字符串 → number，对齐 reviewContract.tool / updateDocumentDraft.tool。
    it('schema 自动把字符串 templateId / fileIds coerce 为 number', async () => {
        ;(createDraftService as any).mockResolvedValue({ draftId: 100, sessionId: 'session-100' })
        ;(updateDocumentDraftDAO as any).mockResolvedValue({ id: 100 })

        const tool = createTool({ userId: 1, sessionId: 'sess-x', runId: 'run-x' })
        const result = await tool.invoke({
            templateId: '1' as unknown as number,
            fileIds: ['7', '8'] as unknown as number[],
            fieldValues: { 原告: '张三' },
        })

        const parsed = JSON.parse(result as string)
        expect(parsed.success).toBe(true)
        // createDraftService 应收到 number 1 / number[7,8]
        expect(createDraftService).toHaveBeenCalledWith(expect.objectContaining({
            templateId: 1,
            sourceFileIds: [7, 8],
        }))
    })

    it('SSE event 必须 await(检查 mock 调用是 await 后才返回)', async () => {
        let publishResolved = false
        ;(createDraftService as any).mockResolvedValue({ draftId: 100, sessionId: 'session-100' })
        ;(updateDocumentDraftDAO as any).mockResolvedValue({ id: 100 })
        ;(publishCustomEvent as any).mockImplementation(async () => {
            await new Promise(r => setTimeout(r, 10))
            publishResolved = true
        })

        const tool = createTool({ userId: 1, sessionId: 'sess-x', runId: 'run-x' })
        await tool.invoke({
            templateId: 1,
            fieldValues: { 原告: '张三' },
        })

        // tool 返回时 publishCustomEvent 应已 resolve
        expect(publishResolved).toBe(true)
    })
})
