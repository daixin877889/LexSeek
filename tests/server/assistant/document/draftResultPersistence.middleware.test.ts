import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
    updateDocumentDraftDAO: vi.fn(),
    createSnapshotService: vi.fn(),
    applyAITitleIfAllowedService: vi.fn(),
}))

vi.mock('~~/server/agents/document/documentDraft.dao', () => ({
    updateDocumentDraftDAO: mocks.updateDocumentDraftDAO,
}))
vi.mock('~~/server/agents/document/documentDraftSnapshot.service', () => ({
    createSnapshotService: mocks.createSnapshotService,
}))
vi.mock('~~/server/agents/document/documentDraft.service', () => ({
    applyAITitleIfAllowedService: mocks.applyAITitleIfAllowedService,
}))

import { draftResultPersistenceMiddleware } from '~~/server/services/workflow/middleware/draftResultPersistence.middleware'

function invokeAfter(state: any, draftId = 1) {
    const mw = draftResultPersistenceMiddleware({ draftId, sessionId: 'sid' })
    return (mw as any).afterAgent.hook(state)
}

describe('draftResultPersistence afterAgent', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.updateDocumentDraftDAO.mockResolvedValue({})
        mocks.createSnapshotService.mockResolvedValue({ id: 1 })
        mocks.applyAITitleIfAllowedService.mockResolvedValue(true)
    })

    it('structuredResponse 含 values + aiTitle → 写 snapshot、更新 values、应用 aiTitle', async () => {
        await invokeAfter({
            structuredResponse: {
                values: { f1: 'v1' },
                suggestions: { f1: '来自材料' },
                aiTitle: '张三诉李四起诉状',
            },
        })
        expect(mocks.createSnapshotService).toHaveBeenCalledWith(
            1, 'ai-extract',
            expect.objectContaining({ values: { f1: 'v1' }, aiTitle: '张三诉李四起诉状' }),
        )
        expect(mocks.updateDocumentDraftDAO).toHaveBeenCalledWith(1, expect.objectContaining({
            values: { f1: 'v1' },
            status: 'ready',
        }))
        expect(mocks.applyAITitleIfAllowedService).toHaveBeenCalledWith(1, '张三诉李四起诉状')
    })

    it('无 aiTitle 时不调用 applyAITitleIfAllowedService，但仍写 snapshot 与 values', async () => {
        await invokeAfter({
            structuredResponse: { values: { f1: 'v1' } },
        })
        expect(mocks.createSnapshotService).toHaveBeenCalled()
        expect(mocks.applyAITitleIfAllowedService).not.toHaveBeenCalled()
    })

    it('结构化缺失且消息体无 JSON → status=failed，不写 snapshot', async () => {
        await invokeAfter({ messages: [] })
        expect(mocks.createSnapshotService).not.toHaveBeenCalled()
        expect(mocks.updateDocumentDraftDAO).toHaveBeenCalledWith(1, { status: 'failed' })
    })

    it('snapshot 创建失败不阻塞主流程（仍能更新 draft.values）', async () => {
        mocks.createSnapshotService.mockRejectedValueOnce(new Error('snapshot boom'))
        await invokeAfter({
            structuredResponse: { values: { f1: 'v1' } },
        })
        // 即使 snapshot 失败，draft.values 仍应被写入 + status=ready
        expect(mocks.updateDocumentDraftDAO).toHaveBeenCalledWith(1, expect.objectContaining({
            values: { f1: 'v1' },
            status: 'ready',
        }))
    })

    // 真根因修复：LLM 输出含未转义内嵌引号的 broken JSON，toolStrategy 静默拒绝，
    // structuredResponse 通道不创建。hook 必须从 tool_use.input 抢救数据（jsonrepair 容错）
    it('Fallback A：structuredResponse 缺失 + 最后 AIMessage 含 broken JSON 的 tool_use → 用 jsonrepair 抢救', async () => {
        // 真实 dev 复现的 broken JSON：第 758 字符 `"犯错"` 未转义双引号
        const brokenInput = '{"values": {"原告": "张三", "事实和理由": "原告认为被告"犯错"扣款2000元违反劳动法。"}, "aiTitle": "张三诉某公司起诉状"}'
        await invokeAfter({
            messages: [
                { type: 'human', content: '帮我起草起诉状' },
                {
                    type: 'ai',
                    content: [
                        { type: 'text', text: '信息已充分，现在填充字段。' },
                        { type: 'tool_use', name: 'extract-2', id: 'call_x', input: brokenInput },
                    ],
                },
            ],
        })
        // 应当成功修复 + 写 ready
        expect(mocks.updateDocumentDraftDAO).toHaveBeenCalledWith(1, expect.objectContaining({
            status: 'ready',
            values: expect.objectContaining({
                原告: '张三',
                事实和理由: expect.stringContaining('犯错'),
            }),
        }))
        expect(mocks.applyAITitleIfAllowedService).toHaveBeenCalledWith(1, '张三诉某公司起诉状')
    })

    it('Fallback A：tool_use.input 是合法 JSON 时也能识别（不需要 jsonrepair 时直接走 JSON.parse）', async () => {
        const validInput = JSON.stringify({ values: { f1: 'v1', f2: 'v2' }, aiTitle: 'OK' })
        await invokeAfter({
            messages: [
                {
                    type: 'ai',
                    content: [{ type: 'tool_use', name: 'extract-2', id: 'call_x', input: validInput }],
                },
            ],
        })
        expect(mocks.updateDocumentDraftDAO).toHaveBeenCalledWith(1, expect.objectContaining({
            status: 'ready',
            values: { f1: 'v1', f2: 'v2' },
        }))
    })

    it('Fallback A：tool_use.input 是 object（已被 LangChain parse）时也能识别', async () => {
        await invokeAfter({
            messages: [
                {
                    type: 'ai',
                    content: [{ type: 'tool_use', name: 'extract-2', id: 'call_x', input: { values: { f1: 'v1' } } }],
                },
            ],
        })
        expect(mocks.updateDocumentDraftDAO).toHaveBeenCalledWith(1, expect.objectContaining({
            status: 'ready',
            values: { f1: 'v1' },
        }))
    })

    it('Fallback A：messages 不含 tool_use 时优雅降级（不抢救）', async () => {
        await invokeAfter({
            messages: [
                { type: 'ai', content: '只是普通回复，没有工具调用' },
            ],
        })
        // 没救到 → 应走 status=failed
        expect(mocks.updateDocumentDraftDAO).toHaveBeenCalledWith(1, { status: 'failed' })
    })
})
