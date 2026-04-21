/**
 * search_case_materials 工具测试
 *
 * 覆盖合并检索 5 场景：
 * 1. 仅 caseId（ctx.draftId 缺失）→ 合并服务传 {caseId, draftId: null}
 * 2. 仅 draftId（ctx.caseId 缺失）→ 合并服务传 {caseId: null, draftId}
 * 3. 双绑 ctx（caseId + draftId 都有）→ 合并服务同时传两者，天然去重
 * 4. input.draftId 覆盖 ctx.draftId → 使用 input 的 draftId
 * 5. ctx 两者都无 → 抛错，错误消息命中 "需要 caseId 或 draftId"
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock logger（Nuxt 自动导入的全局变量）
vi.stubGlobal('logger', {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
})

// Mock 材料检索服务（仅 mock 合并检索函数，旧二选一分支已移除）
vi.mock('~~/server/services/material/materialPipeline.service', () => ({
    searchMaterialsByCaseOrDraftService: vi.fn(),
}))

import { createTool } from '~~/server/services/workflow/tools/searchCaseMaterials.tool'
import type { ToolContext } from '~~/server/services/workflow/tools/types'
import { searchMaterialsByCaseOrDraftService } from '~~/server/services/material/materialPipeline.service'

describe('search_case_materials 工具', () => {
    const userId = 123
    const sessionId = 'test-session-id'

    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('场景 1: 仅 caseId（ctx.draftId 缺失）', () => {
        it('应调用合并服务，draftId 传 null', async () => {
            const caseId = 456
            const context: ToolContext = { userId, caseId, sessionId }

            const mockResults = [
                {
                    index: 1,
                    content: '案件内容',
                    source: { sourceId: 1, sourceName: '案件基本信息' },
                },
            ]
            vi.mocked(searchMaterialsByCaseOrDraftService).mockResolvedValue(mockResults)

            const tool = createTool(context)
            const result = await tool.invoke({
                query: '证人证言',
                sourceId: undefined,
                k: 5,
            })

            expect(searchMaterialsByCaseOrDraftService).toHaveBeenCalledWith(
                userId,
                { caseId: 456, draftId: null },
                { query: '证人证言', sourceId: undefined, k: 5 },
            )
            const parsed = JSON.parse(result as string)
            expect(parsed).toHaveLength(1)
        })
    })

    describe('场景 2: 仅 draftId（ctx.caseId 缺失）', () => {
        it('应调用合并服务，caseId 传 null', async () => {
            const draftId = 789
            const context: ToolContext = { userId, draftId, sessionId }

            const mockResults = [
                {
                    index: 1,
                    content: '文书内容',
                    source: { sourceId: 2, sourceName: '法律意见书' },
                },
            ]
            vi.mocked(searchMaterialsByCaseOrDraftService).mockResolvedValue(mockResults)

            const tool = createTool(context)
            const result = await tool.invoke({ query: '法律分析', k: 5 })

            expect(searchMaterialsByCaseOrDraftService).toHaveBeenCalledWith(
                userId,
                { caseId: null, draftId: 789 },
                { query: '法律分析', sourceId: undefined, k: 5 },
            )
            const parsed = JSON.parse(result as string)
            expect(parsed).toHaveLength(1)
        })
    })

    describe('场景 3: 双绑 ctx（caseId + draftId 都有）', () => {
        it('从案件进入的 draft 助手：同时传 caseId 和 draftId 给合并服务', async () => {
            const caseId = 456
            const draftId = 789
            const context: ToolContext = { userId, caseId, draftId, sessionId }

            const mockResults = [
                { index: 1, content: '合集片段 A', source: { sourceId: 1, sourceName: '案件材料' } },
                { index: 2, content: '合集片段 B', source: { sourceId: 2, sourceName: '草稿材料' } },
            ]
            vi.mocked(searchMaterialsByCaseOrDraftService).mockResolvedValue(mockResults)

            const tool = createTool(context)
            const result = await tool.invoke({ query: '合并查询', k: 5 })

            expect(searchMaterialsByCaseOrDraftService).toHaveBeenCalledWith(
                userId,
                { caseId: 456, draftId: 789 },
                { query: '合并查询', sourceId: undefined, k: 5 },
            )
            const parsed = JSON.parse(result as string)
            expect(parsed).toHaveLength(2)
        })
    })

    describe('场景 4: input.draftId 覆盖 ctx.draftId', () => {
        it('当 input 提供 draftId 时应覆盖 context 的 draftId', async () => {
            const contextDraftId = 111
            const inputDraftId = 222
            const context: ToolContext = { userId, draftId: contextDraftId, sessionId }

            vi.mocked(searchMaterialsByCaseOrDraftService).mockResolvedValue([])

            const tool = createTool(context)
            await tool.invoke({ draftId: inputDraftId, query: '查询内容' })

            expect(searchMaterialsByCaseOrDraftService).toHaveBeenCalledWith(
                userId,
                { caseId: null, draftId: inputDraftId },
                expect.any(Object),
            )
        })
    })

    describe('场景 5: ctx 两者都无', () => {
        it('应抛错，错误消息命中 "search_case_materials 需要 caseId 或 draftId"', async () => {
            const context: ToolContext = { userId, sessionId }

            const tool = createTool(context)
            const result = await tool.invoke({ query: '测试查询' })

            const parsed = JSON.parse(result as string)
            expect(parsed).toHaveProperty('error')
            expect(parsed.message).toBe('search_case_materials 需要 caseId 或 draftId')
            // 不允许静默 fallback 为空
            expect(searchMaterialsByCaseOrDraftService).not.toHaveBeenCalled()
        })
    })

    describe('schema 参数验证', () => {
        it('query 和 sourceId 都缺失时 schema 验证会失败', async () => {
            const context: ToolContext = { userId, caseId: 456, sessionId }
            const tool = createTool(context)

            await expect(
                tool.invoke({ draftId: 123 } as any),
            ).rejects.toThrow(/至少需要提供 query 或 sourceId/)
        })
    })

    describe('无结果处理', () => {
        it('当检索无结果时应返回 error 信息', async () => {
            const context: ToolContext = { userId, caseId: 456, sessionId }

            vi.mocked(searchMaterialsByCaseOrDraftService).mockResolvedValue([])

            const tool = createTool(context)
            const result = await tool.invoke({ query: '不存在的材料' })

            const parsed = JSON.parse(result as string)
            expect(parsed).toHaveProperty('error')
            expect(parsed.error).toContain('未找到')
        })
    })
})
