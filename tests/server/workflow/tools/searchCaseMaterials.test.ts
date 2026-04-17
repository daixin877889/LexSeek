/**
 * search_case_materials 工具测试
 *
 * 覆盖三条路径：
 * 1. 仅 draftId（无 caseId）→ 调用 searchMaterialsByDraftService
 * 2. 仅 caseId（无 draftId）→ 调用 searchMaterialsService
 * 3. 两者都无 → 抛错
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock logger（Nuxt 自动导入的全局变量）
vi.stubGlobal('logger', {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
})

// Mock 材料检索服务
vi.mock('~~/server/services/material/materialPipeline.service', () => ({
    searchMaterialsService: vi.fn(),
    searchMaterialsByDraftService: vi.fn(),
}))

import { createTool } from '~~/server/services/workflow/tools/searchCaseMaterials.tool'
import type { ToolContext } from '~~/server/services/workflow/tools/types'
import { searchMaterialsService, searchMaterialsByDraftService } from '~~/server/services/material/materialPipeline.service'

describe('search_case_materials 工具', () => {
    const userId = 123
    const sessionId = 'test-session-id'

    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('路径 1: 仅 caseId（无 draftId）', () => {
        it('应调用 searchMaterialsService 并返回结果', async () => {
            const caseId = 456
            const context: ToolContext = { userId, caseId, sessionId }

            const mockResults = [
                {
                    index: 1,
                    content: '案件内容',
                    source: { sourceId: 1, sourceName: '案件基本信息' },
                },
            ]

            vi.mocked(searchMaterialsService).mockResolvedValue(mockResults)

            const tool = createTool(context)
            const result = await tool.invoke({
                query: '证人证言',
                sourceId: undefined,
                k: 5,
            })

            expect(searchMaterialsService).toHaveBeenCalledWith(userId, caseId, {
                query: '证人证言',
                sourceId: undefined,
                k: 5,
            })
            expect(result).toBeTruthy()
            const parsed = JSON.parse(result as string)
            expect(parsed).toHaveLength(1)
        })

        it('当 caseId 缺失时应抛错', async () => {
            const context: ToolContext = { userId, sessionId }

            const tool = createTool(context)
            const result = await tool.invoke({
                query: '证人证言',
            })

            const parsed = JSON.parse(result as string)
            expect(parsed).toHaveProperty('error')
            expect(parsed.message).toContain('需要 caseId 或 draftId')
        })
    })

    describe('路径 2: 仅 draftId（无 caseId）', () => {
        it('应调用 searchMaterialsByDraftService 并返回结果', async () => {
            const draftId = 789
            const context: ToolContext = { userId, draftId, sessionId }

            const mockResults = [
                {
                    index: 1,
                    content: '文书内容',
                    source: { sourceId: 2, sourceName: '法律意见书' },
                },
            ]

            vi.mocked(searchMaterialsByDraftService).mockResolvedValue(mockResults)

            const tool = createTool(context)
            const result = await tool.invoke({
                query: '法律分析',
                k: 5,
            })

            expect(searchMaterialsByDraftService).toHaveBeenCalledWith(userId, draftId, {
                query: '法律分析',
                sourceId: undefined,
                k: 5,
            })
            expect(result).toBeTruthy()
            const parsed = JSON.parse(result as string)
            expect(parsed).toHaveLength(1)
        })
    })

    describe('路径 3: 两者都无', () => {
        it('应抛错并包含 "需要 caseId 或 draftId" 信息', async () => {
            const context: ToolContext = { userId, sessionId }

            const tool = createTool(context)
            const result = await tool.invoke({
                query: '测试查询',
            })

            const parsed = JSON.parse(result as string)
            expect(parsed).toHaveProperty('error')
            expect(parsed.message).toMatch(/需要.*caseId.*draftId/)
        })
    })

    describe('input draftId 覆盖 context draftId', () => {
        it('当 input 提供 draftId 时应覆盖 context', async () => {
            const contextDraftId = 111
            const inputDraftId = 222
            const context: ToolContext = { userId, draftId: contextDraftId, sessionId }

            const mockResults = []
            vi.mocked(searchMaterialsByDraftService).mockResolvedValue(mockResults)

            const tool = createTool(context)
            await tool.invoke({
                draftId: inputDraftId,
                query: '查询内容',
            })

            // 验证使用了 input 中的 draftId
            expect(searchMaterialsByDraftService).toHaveBeenCalledWith(
                userId,
                inputDraftId,
                expect.any(Object)
            )
        })
    })

    describe('schema 参数验证', () => {
        it('应接受 draftId 参数', async () => {
            const context: ToolContext = { userId, sessionId }
            const tool = createTool(context)

            // 应该不抛错
            expect(() => {
                tool.invoke({
                    draftId: 123,
                    query: '查询',
                })
            }).not.toThrow()
        })

        it('query 和 sourceId 都缺失时 schema 验证会失败', async () => {
            const context: ToolContext = { userId, caseId: 456, sessionId }
            const tool = createTool(context)

            // Zod schema 验证在调用时被拒绝（抛错，不是返回 error 对象）
            await expect(
                tool.invoke({
                    draftId: 123,
                    // 都不提供 query 和 sourceId
                } as any)
            ).rejects.toThrow(/至少需要提供 query 或 sourceId/)
        })
    })

    describe('无结果处理', () => {
        it('当检索无结果时应返回错误信息', async () => {
            const context: ToolContext = { userId, caseId: 456, sessionId }

            vi.mocked(searchMaterialsService).mockResolvedValue([])

            const tool = createTool(context)
            const result = await tool.invoke({
                query: '不存在的材料',
            })

            const parsed = JSON.parse(result as string)
            expect(parsed).toHaveProperty('error')
            expect(parsed.error).toContain('未找到')
        })
    })
})
