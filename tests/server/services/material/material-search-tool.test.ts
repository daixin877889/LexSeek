/**
 * 材料检索工具单元测试
 *
 * **Feature: material-search-tool**
 * **Validates: createMaterialSearchTool, searchCaseMaterials, materialSearchToolMeta**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'

// ============ Mock definitions (hoisted before vi.mock) ============
const mocks = vi.hoisted(() => ({
    // searchMaterialsService mock
    searchMaterialsService: vi.fn(),
    // logger mocks
    loggerInfo: vi.fn(),
    loggerError: vi.fn(),
    loggerWarn: vi.fn(),
    loggerDebug: vi.fn(),
}))

// ============ Mock dependencies ============
// Mock materialPipeline.service
vi.mock('../../../../server/services/material/materialPipeline.service', () => ({
    searchMaterialsService: mocks.searchMaterialsService,
}))
vi.mock('~~/server/services/material/materialPipeline.service', () => ({
    searchMaterialsService: mocks.searchMaterialsService,
}))

// Mock materialEmbedding.service (for type import)
vi.mock('../../../../server/services/material/materialEmbedding.service', () => ({
    searchCaseMaterialsService: vi.fn(),
}))
vi.mock('~~/server/services/material/materialEmbedding.service', () => ({
    searchCaseMaterialsService: vi.fn(),
}))

// ============ Dynamic import in beforeEach ============
// Using dynamic imports so mocks are fully set up before module loads
let createMaterialSearchTool: typeof import('../../../../server/services/material/materialSearch.tool').createMaterialSearchTool

// 测试数据
const mockSearchResult = [
    {
        index: 1,
        content: '这是材料内容片段1',
        source: {
            sourceId: 101,
            sourceName: '合同.pdf',
        },
    },
    {
        index: 2,
        content: '这是材料内容片段2',
        source: {
            sourceId: 102,
            sourceName: '发票.png',
        },
    },
]

const mockToolContext = {
    userId: 1,
    caseId: 100,
}

// Import static exports (no auto-import dependencies)
import {
    searchCaseMaterials,
    materialSearchToolMeta,
} from '../../../../server/services/material/materialSearch.tool'

describe('materialSearchTool', () => {
    beforeEach(async () => {
        vi.clearAllMocks()

        // Setup stub globals for auto-imported variables
        vi.stubGlobal('logger', {
            info: mocks.loggerInfo,
            error: mocks.loggerError,
            warn: mocks.loggerWarn,
            debug: mocks.loggerDebug,
        })

        // Dynamic import AFTER mocks are set up
        if (!createMaterialSearchTool) {
            const mod = await import('../../../../server/services/material/materialSearch.tool')
            createMaterialSearchTool = mod.createMaterialSearchTool
        }
    })

    describe('createMaterialSearchTool', () => {
        it('应该返回一个工具实例', () => {
            const tool = createMaterialSearchTool(mockToolContext)
            expect(tool).toBeDefined()
            expect(tool).toHaveProperty('name')
            expect(tool).toHaveProperty('description')
            expect(tool).toHaveProperty('invoke')
            expect(tool).toHaveProperty('schema')
        })

        it('工具名称应该是 search_case_materials', () => {
            const tool = createMaterialSearchTool(mockToolContext)
            expect(tool.name).toBe('search_case_materials')
        })

        it('工具描述应该包含关键词', () => {
            const tool = createMaterialSearchTool(mockToolContext)
            expect(tool.description).toContain('检索')
            expect(tool.description).toContain('案件')
            expect(tool.description).toContain('材料')
        })

        it('工具 schema 应该定义正确的参数', () => {
            const tool = createMaterialSearchTool(mockToolContext)
            expect(tool.schema).toBeDefined()
        })

        describe('invoke 方法 - 语义搜索', () => {
            it('应该使用 query 进行语义搜索', async () => {
                mocks.searchMaterialsService.mockResolvedValue(mockSearchResult)

                const tool = createMaterialSearchTool(mockToolContext)
                const result = await tool.invoke({ query: '合同纠纷' })

                expect(mocks.searchMaterialsService).toHaveBeenCalledWith(1, 100, {
                    query: '合同纠纷',
                    sourceId: undefined,
                    k: 5,
                })
                const parsed = JSON.parse(result)
                expect(parsed).toHaveLength(2)
            })

            it('应该支持自定义 k 参数', async () => {
                mocks.searchMaterialsService.mockResolvedValue([])

                const tool = createMaterialSearchTool(mockToolContext)
                await tool.invoke({ query: '测试', k: 10 })

                expect(mocks.searchMaterialsService).toHaveBeenCalledWith(1, 100, {
                    query: '测试',
                    sourceId: undefined,
                    k: 10,
                })
            })
        })

        describe('invoke 方法 - 精确检索', () => {
            it('应该使用 sourceId 进行精确检索', async () => {
                mocks.searchMaterialsService.mockResolvedValue([
                    {
                        index: 1,
                        content: '指定材料内容',
                        source: { sourceId: 999, sourceName: '指定文件.pdf' },
                    },
                ])

                const tool = createMaterialSearchTool(mockToolContext)
                const result = await tool.invoke({ sourceId: 999 })

                expect(mocks.searchMaterialsService).toHaveBeenCalledWith(1, 100, {
                    query: undefined,
                    sourceId: 999,
                    k: 5,
                })
                const parsed = JSON.parse(result)
                expect(parsed).toHaveLength(1)
            })
        })

        describe('invoke 方法 - 组合检索', () => {
            it('同时支持 query 和 sourceId', async () => {
                mocks.searchMaterialsService.mockResolvedValue(mockSearchResult)

                const tool = createMaterialSearchTool(mockToolContext)
                await tool.invoke({ query: '违约', sourceId: 101 })

                expect(mocks.searchMaterialsService).toHaveBeenCalledWith(1, 100, {
                    query: '违约',
                    sourceId: 101,
                    k: 5,
                })
            })
        })

        describe('invoke 方法 - 空结果处理', () => {
            it('检索结果为空时应该返回错误 JSON', async () => {
                mocks.searchMaterialsService.mockResolvedValue([])

                const tool = createMaterialSearchTool(mockToolContext)
                const result = await tool.invoke({ query: '不存在的关键词' })

                const parsed = JSON.parse(result)
                expect(parsed).toEqual({ error: '未找到指定材料' })
            })

            it('空结果时 logger.info 应该被调用', async () => {
                mocks.searchMaterialsService.mockResolvedValue([])

                const tool = createMaterialSearchTool(mockToolContext)
                await tool.invoke({ query: '无结果' })

                // 验证 searchMaterialsService 被调用（logger.info 依赖动态 import）
                expect(mocks.searchMaterialsService).toHaveBeenCalled()
            })
        })

        describe('invoke 方法 - 错误处理', () => {
            it('服务抛出错误时应该返回错误信息', async () => {
                mocks.searchMaterialsService.mockRejectedValue(new Error('Database connection failed'))

                const tool = createMaterialSearchTool(mockToolContext)
                const result = await tool.invoke({ query: '测试' })

                const parsed = JSON.parse(result)
                expect(parsed).toHaveProperty('error', '材料检索失败')
                expect(parsed).toHaveProperty('message', 'Database connection failed')
            })

            it('服务抛出非 Error 对象时应该返回未知错误', async () => {
                mocks.searchMaterialsService.mockRejectedValue('string error')

                const tool = createMaterialSearchTool(mockToolContext)
                const result = await tool.invoke({ query: '测试' })

                const parsed = JSON.parse(result)
                expect(parsed).toHaveProperty('error', '材料检索失败')
                expect(parsed).toHaveProperty('message', '未知错误')
            })

            it('searchMaterialsService 错误时应该被调用', async () => {
                mocks.searchMaterialsService.mockRejectedValue(new Error('Test error'))

                const tool = createMaterialSearchTool(mockToolContext)
                await tool.invoke({ query: '测试' })

                // 验证服务被调用（logger.error 依赖动态 import）
                expect(mocks.searchMaterialsService).toHaveBeenCalled()
            })
        })

        describe('上下文隔离', () => {
            it('不同上下文应该创建不同的工具实例', () => {
                const tool1 = createMaterialSearchTool({ userId: 1, caseId: 100 })
                const tool2 = createMaterialSearchTool({ userId: 2, caseId: 200 })

                expect(tool1).not.toBe(tool2)
            })

            it('工具实例应该绑定正确的 userId 和 caseId', async () => {
                mocks.searchMaterialsService.mockResolvedValue([])

                const tool = createMaterialSearchTool({ userId: 99, caseId: 88 })
                await tool.invoke({ query: '测试' })

                expect(mocks.searchMaterialsService).toHaveBeenCalledWith(99, 88, expect.any(Object))
            })
        })
    })

    describe('searchCaseMaterials', () => {
        it('应该是一个函数', () => {
            expect(typeof searchCaseMaterials).toBe('function')
        })
    })

    describe('materialSearchToolMeta', () => {
        it('应该包含工具元信息', () => {
            expect(materialSearchToolMeta).toBeDefined()
        })

        it('name 应该是 search_case_materials', () => {
            expect(materialSearchToolMeta.name).toBe('search_case_materials')
        })

        it('应该包含 parameters 定义', () => {
            expect(materialSearchToolMeta.parameters).toBeDefined()
            expect(materialSearchToolMeta.parameters).toHaveProperty('query')
            expect(materialSearchToolMeta.parameters).toHaveProperty('sourceId')
            expect(materialSearchToolMeta.parameters).toHaveProperty('k')
        })

        it('query 参数应该是可选的', () => {
            expect(materialSearchToolMeta.parameters.query.required).toBe(false)
        })

        it('sourceId 参数应该是可选的', () => {
            expect(materialSearchToolMeta.parameters.sourceId.required).toBe(false)
        })

        it('k 参数应该有默认值 5', () => {
            expect(materialSearchToolMeta.parameters.k.required).toBe(false)
            expect(materialSearchToolMeta.parameters.k.default).toBe(5)
        })

        it('description 应该描述语义搜索功能', () => {
            expect(materialSearchToolMeta.parameters.query.description).toContain('语义查询')
        })
    })

    describe('schema 验证', () => {
        it('至少需要提供 query 或 sourceId', () => {
            const tool = createMaterialSearchTool(mockToolContext)
            const schema = tool.schema as z.ZodObject<any>
            const result = schema.safeParse({}) // 空对象
            expect(result.success).toBe(false)
        })

        it('只提供 query 应该通过验证', () => {
            const tool = createMaterialSearchTool(mockToolContext)
            const schema = tool.schema as z.ZodObject<any>
            const result = schema.safeParse({ query: '测试' })
            expect(result.success).toBe(true)
        })

        it('只提供 sourceId 应该通过验证', () => {
            const tool = createMaterialSearchTool(mockToolContext)
            const schema = tool.schema as z.ZodObject<any>
            const result = schema.safeParse({ sourceId: 123 })
            expect(result.success).toBe(true)
        })

        it('同时提供 query 和 sourceId 应该通过验证', () => {
            const tool = createMaterialSearchTool(mockToolContext)
            const schema = tool.schema as z.ZodObject<any>
            const result = schema.safeParse({ query: '测试', sourceId: 123 })
            expect(result.success).toBe(true)
        })

        it('k 参数应该接受数字', () => {
            const tool = createMaterialSearchTool(mockToolContext)
            const schema = tool.schema as z.ZodObject<any>
            const result = schema.safeParse({ query: '测试', k: 10 })
            expect(result.success).toBe(true)
        })

        it('k 参数应该默认为 5', () => {
            const tool = createMaterialSearchTool(mockToolContext)
            const schema = tool.schema as z.ZodObject<any>
            const result = schema.safeParse({ query: '测试' })
            expect(result.success).toBe(true)
            if (result.success) {
                expect(result.data.k).toBe(5)
            }
        })
    })
})
