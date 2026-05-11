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
vi.mock('~~/server/agents/document/documentTemplate.dao', () => ({
    getDocumentTemplateDAO: vi.fn(),
}))

import { createTool, toolDefinition } from '~~/server/services/agent-platform/tools/saveDocumentDraft.tool'
import { createDraftService, applyAITitleIfAllowedService } from '~~/server/agents/document/documentDraft.service'
import { updateDocumentDraftDAO } from '~~/server/agents/document/documentDraft.dao'
import { publishCustomEvent } from '~~/server/services/agent/agentEventBridge'
import { getDocumentTemplateDAO } from '~~/server/agents/document/documentTemplate.dao'

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

    // 回归：summary 的分母必须是模板 placeholders 总数，不能用 LLM 输入的 fieldValues.length。
    // 历史 bug：LLM 第一次只填 16/17 字段时分母被算成 16 → 显示"16/16"误导用户已全部填完。
    it('summary 分母用模板 placeholders 总数，而非 fieldValues 长度', async () => {
        ;(createDraftService as any).mockResolvedValue({ draftId: 100, sessionId: 'session-100' })
        ;(updateDocumentDraftDAO as any).mockResolvedValue({ id: 100 })
        // 模板有 17 个占位符
        ;(getDocumentTemplateDAO as any).mockResolvedValue({
            id: 1,
            name: '民事起诉状（公民提起民事诉讼用）',
            placeholders: [
                '原告', '被告', '法院名称', '诉讼请求', '事实和理由', '证据和证据来源',
                '证人姓名和住所', '住址', '性别', '民族', '出生年月日', '联系电话',
                '工作单位和职务职业', '委托诉讼代理人', '附件数量', '起诉人姓名', '落款日期',
            ],
        })

        const tool = createTool({ userId: 1, sessionId: 'sess-x', runId: 'run-x' })
        // LLM 只传了 16 个字段（漏了"落款日期"）；其中 1 个是空值
        const result = await tool.invoke({
            templateId: 1,
            fieldValues: {
                原告: '张三', 被告: '李四', 法院名称: '北京市朝阳区人民法院',
                诉讼请求: '继续履行合同', 事实和理由: '...', 证据和证据来源: '租赁合同',
                证人姓名和住所: null, 住址: '北京', 性别: '男', 民族: '汉', 出生年月日: '1990-01-01',
                联系电话: '13800000000', 工作单位和职务职业: '...', 委托诉讼代理人: '',
                附件数量: '3', 起诉人姓名: '张三',
            },
        })

        const parsed = JSON.parse(result as string)
        expect(parsed.success).toBe(true)
        // 14 个非空字段（去掉 null 和 ''）/ 17 个模板字段
        expect(parsed.totalFields).toBe(17)
        expect(parsed.filledFieldCount).toBe(14)
        expect(parsed.summary).toBe('已自动填写 14/17 个字段')
    })

    it('取模板失败时 totalFields 兜底用 fieldValues.length', async () => {
        ;(createDraftService as any).mockResolvedValue({ draftId: 100, sessionId: 'session-100' })
        ;(updateDocumentDraftDAO as any).mockResolvedValue({ id: 100 })
        ;(getDocumentTemplateDAO as any).mockRejectedValue(new Error('DB connection lost'))

        const tool = createTool({ userId: 1, sessionId: 'sess-x', runId: 'run-x' })
        const result = await tool.invoke({
            templateId: 1,
            fieldValues: { 原告: '张三', 被告: '李四' },
        })

        const parsed = JSON.parse(result as string)
        expect(parsed.success).toBe(true)
        expect(parsed.totalFields).toBe(2)
        expect(parsed.filledFieldCount).toBe(2)
    })

    // 回归：截图 bug——LLM 把"【待补充：xxx】"占位字符串当 fieldValue 传入,
    // 后端原样落库,前端显示"15/15 已填"假象 + 文档正文出现占位串。
    // 兜底逻辑：normalizeAIInitialFieldValues 把占位符转 null,统计自然变准。
    it('LLM 占位字符串「【待补充:xxx】」被转 null,不算入 filledFieldCount,不写入 values', async () => {
        ;(createDraftService as any).mockResolvedValue({ draftId: 100, sessionId: 'session-100' })
        ;(updateDocumentDraftDAO as any).mockResolvedValue({ id: 100 })
        ;(getDocumentTemplateDAO as any).mockResolvedValue({
            id: 1,
            name: '民事答辩状',
            placeholders: ['法院名称', '案件号', '原告', '被告', '答辩理由'],
        })

        const tool = createTool({ userId: 1, sessionId: 'sess-x', runId: 'run-x' })
        const result = await tool.invoke({
            templateId: 1,
            fieldValues: {
                法院名称: '【待补充：法院名称】', // 占位 → null
                案件号: '【未提供】',                // 占位 → null
                原告: '葛某飞',                     // 真值
                被告: '某传媒公司',                  // 真值
                答辩理由: '【暂无】',                // 占位 → null
            },
        })

        const parsed = JSON.parse(result as string)
        expect(parsed.success).toBe(true)
        // 5 个模板字段；只有 2 个被真填(原告/被告)
        expect(parsed.totalFields).toBe(5)
        expect(parsed.filledFieldCount).toBe(2)
        expect(parsed.summary).toBe('已自动填写 2/5 个字段')

        // values 写库时占位符应已变 null,不会带"【待补充：xxx】"字符串
        expect(updateDocumentDraftDAO).toHaveBeenCalledWith(100, expect.objectContaining({
            values: {
                法院名称: null,
                案件号: null,
                原告: '葛某飞',
                被告: '某传媒公司',
                答辩理由: null,
            },
        }))
    })

    it('LLM 全部回传占位字符串时,等同 null 全空,拒绝创建', async () => {
        const tool = createTool({ userId: 1, sessionId: 'sess-x' })
        const result = await tool.invoke({
            templateId: 1,
            fieldValues: {
                原告: '【待补充：原告】',
                被告: '【未提供】',
            },
        })

        const parsed = JSON.parse(result as string)
        expect(parsed.success).toBe(false)
        expect(parsed.error).toContain('至少一个非 null')
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
