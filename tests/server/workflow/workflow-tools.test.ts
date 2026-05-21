/**
 * 工作流工具测试
 *
 * **Feature: workflow-tools-coverage**
 * **Validates: Requirements 12.1.1-12.1.5**
 *
 * 覆盖：
 * - processMaterials.tool - 材料处理工具
 * - searchLaw.tool - 法律检索工具
 * - index - 工具注册表（getAllToolsService 等）
 *
 * 说明：confirmPoints / rollbackPoints / reservePoints 三个预扣工具已在
 * commit be388702 删除（属未挂载死代码），对应单测同步移除。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock logger（Nuxt 自动导入的全局变量）
vi.stubGlobal('logger', {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
})

// Mock 材料相关服务
vi.mock('~~/server/services/material/materialPipeline.service', () => ({
    ensureMaterialsReadyService: vi.fn(),
    ensureMaterialsReadyByDraftService: vi.fn(),
    getMaterialContextService: vi.fn(),
    estimateTokens: vi.fn((content: string) => Math.ceil(content.length / 2)),
    getSourceId: vi.fn((m: any) => m.id),
    TOKEN_THRESHOLD: 50000,
    snapshotMaterialReadiness: vi.fn(async () => []),
}))

// process_materials.tool 用 countTokensSync 做 payload 硬封顶；测试用 mock 简化为字符长度
vi.mock('~~/server/utils/tokenCounter', () => ({
    countTokensSync: (text: string) => (text ? text.length : 0),
    // toolResultTruncator 在模块加载时会调 countTokens('').catch(...)，必须返回 Promise
    countTokens: vi.fn(async (text: string) => (text ? text.length : 0)),
}))

// Mock 法律检索服务
vi.mock('~~/server/services/legal/searchLaw.tool', () => ({
    searchLaw: vi.fn(),
}))

import {
    ensureMaterialsReadyService,
    getMaterialContextService,
} from '~~/server/services/material/materialPipeline.service'
import { searchLaw } from '~~/server/services/legal/searchLaw.tool'

import type { ToolContext } from '~~/server/services/workflow/tools/types'

// 导入工具模块
import * as processMaterialsTool from '~~/server/services/workflow/tools/processMaterials.tool'
import * as searchLawTool from '~~/server/services/workflow/tools/searchLaw.tool'

/** 创建测试上下文 */
const createTestContext = (overrides: Partial<ToolContext> = {}): ToolContext => ({
    userId: 1,
    caseId: 100,
    sessionId: 'test-session',
    ...overrides,
})

describe('工作流工具', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    // ==================== processMaterials.tool ====================

    describe('processMaterials.tool - 材料处理工具', () => {
        it('toolDefinition 包含正确的名称', () => {
            expect(processMaterialsTool.toolDefinition.name).toBe('process_materials')
        })

        it('无材料时返回 empty 模式', async () => {
            vi.mocked(ensureMaterialsReadyService).mockResolvedValueOnce({
                materials: [],
                embeddedMap: new Map(),
            })

            const tool = processMaterialsTool.createTool(createTestContext())
            const result = await tool.invoke({})
            const parsed = JSON.parse(result as string)

            expect(parsed.mode).toBe('empty')
            expect(parsed.materials).toEqual([])
        })

        it('有材料时返回处理结果', async () => {
            const materials = [
                { id: 1, name: '起诉状.pdf' },
                { id: 2, name: '合同.pdf' },
            ]
            vi.mocked(ensureMaterialsReadyService).mockResolvedValueOnce({
                materials,
                embeddedMap: new Map([[1, true], [2, false]]),
            } as any)
            vi.mocked(getMaterialContextService).mockResolvedValueOnce({
                mode: 'full',
                totalTokens: 5000,
                materialList: [
                    { sourceId: 1, hasContent: true, content: '起诉状内容...' },
                    { sourceId: 2, hasContent: true, content: '合同内容...' },
                ],
            } as any)

            const tool = processMaterialsTool.createTool(createTestContext())
            const result = await tool.invoke({})
            const parsed = JSON.parse(result as string)

            expect(parsed.mode).toBe('full')
            expect(parsed.materialCount).toBe(2)
            expect(parsed.materials).toHaveLength(2)
            expect(parsed.materials[0].embedded).toBe(true)
            expect(parsed.materials[1].embedded).toBe(false)
        })

        it('摘要模式时包含检索提示', async () => {
            const materials = [{ id: 1, name: '大文件.pdf' }]
            vi.mocked(ensureMaterialsReadyService).mockResolvedValueOnce({
                materials,
                embeddedMap: new Map([[1, true]]),
            } as any)
            vi.mocked(getMaterialContextService).mockResolvedValueOnce({
                mode: 'summary',
                totalTokens: 60000,
                materialList: [
                    { sourceId: 1, hasContent: true, content: '摘要...' },
                ],
            } as any)

            const tool = processMaterialsTool.createTool(createTestContext())
            const result = await tool.invoke({})
            const parsed = JSON.parse(result as string)

            expect(parsed.mode).toBe('summary')
            expect(parsed.hint).toContain('search_case_materials')
        })

        it('处理失败返回错误信息', async () => {
            vi.mocked(ensureMaterialsReadyService).mockRejectedValueOnce(
                new Error('OSS 服务不可用')
            )

            const tool = processMaterialsTool.createTool(createTestContext())
            const result = await tool.invoke({})
            const parsed = JSON.parse(result as string)

            expect(parsed.error).toBe('材料处理失败')
            expect(parsed.message).toBe('OSS 服务不可用')
        })
    })

    // ==================== searchLaw.tool ====================

    describe('searchLaw.tool - 法律检索工具', () => {
        it('toolDefinition 包含正确的名称', () => {
            expect(searchLawTool.toolDefinition.name).toBe('search_law')
        })

        it('成功检索法律条文', async () => {
            const mockResults = [
                {
                    score: 0.95,
                    content: '合同法第一百零七条',
                    metadata: {
                        legal_name: '中华人民共和国合同法',
                        document_number: 'DOC-001',
                        chapter_hierarchy: '第七章 违约责任',
                        publish_date: '1999-03-15',
                        effective_date: '1999-10-01',
                        invalid_date: null,
                    },
                },
            ]
            vi.mocked(searchLaw).mockResolvedValueOnce(mockResults as any)

            const tool = searchLawTool.createTool(createTestContext())
            const result = await tool.invoke({ query: '违约责任', k: 5 })
            const parsed = JSON.parse(result as string)

            expect(parsed).toHaveLength(1)
            expect(parsed[0].score).toBe(0.95)
            expect(parsed[0].metadata.legal_name).toBe('中华人民共和国合同法')
        })

        it('使用默认 k 值', async () => {
            vi.mocked(searchLaw).mockResolvedValueOnce([])

            const tool = searchLawTool.createTool(createTestContext())
            await tool.invoke({ query: '合同纠纷' })

            expect(searchLaw).toHaveBeenCalledWith(expect.objectContaining({ k: 5 }))
        })

        it('支持按法律类型筛选', async () => {
            vi.mocked(searchLaw).mockResolvedValueOnce([])

            const tool = searchLawTool.createTool(createTestContext())
            await tool.invoke({
                query: '知识产权',
                legalType: 'law',
                legalName: '著作权法',
                isEffective: true,
            })

            expect(searchLaw).toHaveBeenCalledWith(expect.objectContaining({
                legalType: 'law',
                legalName: '著作权法',
                isEffective: true,
            }))
        })

        it('检索失败返回错误信息', async () => {
            vi.mocked(searchLaw).mockRejectedValueOnce(new Error('向量数据库连接失败'))

            const tool = searchLawTool.createTool(createTestContext())
            const result = await tool.invoke({ query: '测试' })
            const parsed = JSON.parse(result as string)

            expect(parsed.error).toBe('法律检索失败')
            expect(parsed.message).toBe('向量数据库连接失败')
        })
    })

    // ==================== 工具注册表 ====================

    describe('工具注册表 (index)', () => {
        // 使用动态导入避免与上方 mock 冲突
        let toolsIndex: typeof import('~~/server/services/workflow/tools/index')

        beforeEach(async () => {
            toolsIndex = await import('~~/server/services/workflow/tools/index')
        })

        it('getAllToolNamesService 返回所有注册的工具名称', () => {
            const names = toolsIndex.getAllToolNamesService()
            expect(names).toContain('search_law')
            expect(names).toContain('process_materials')
            expect(names).toContain('search_case_materials')
        })

        it('hasToolService 正确判断工具是否存在', () => {
            expect(toolsIndex.hasToolService('search_law')).toBe(true)
            expect(toolsIndex.hasToolService('nonexistent_tool')).toBe(false)
        })

        it('getToolMetaService 返回工具元信息', () => {
            const meta = toolsIndex.getToolMetaService('search_law')
            expect(meta).not.toBeNull()
            expect(meta!.name).toBe('search_law')
            expect(meta!.description).toBeDefined()
            expect(meta!.parameters).toBeDefined()
        })

        it('getToolMetaService 不存在的工具返回 null', () => {
            const meta = toolsIndex.getToolMetaService('no_such_tool')
            expect(meta).toBeNull()
        })

        it('getAllToolsService 返回所有工具元信息', () => {
            const allTools = toolsIndex.getAllToolsService()
            expect(allTools.length).toBeGreaterThan(0)
            for (const tool of allTools) {
                expect(tool.name).toBeDefined()
                expect(tool.description).toBeDefined()
            }
        })

        it('getToolInstancesService 创建工具实例', () => {
            const context = createTestContext()
            const instances = toolsIndex.getToolInstancesService(
                ['search_law', 'process_materials'],
                context
            )

            expect(instances).toHaveLength(2)
            expect(instances[0].name).toBe('search_law')
            expect(instances[1].name).toBe('process_materials')
        })

        it('getToolInstancesService 跳过不存在的工具', () => {
            const context = createTestContext()
            const instances = toolsIndex.getToolInstancesService(
                ['search_law', 'nonexistent'],
                context
            )

            expect(instances).toHaveLength(1)
            expect(instances[0].name).toBe('search_law')
        })
    })
})
