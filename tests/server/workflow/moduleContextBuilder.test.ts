/**
 * 模块上下文构建器测试
 *
 * Mock 所有服务调用，测试 buildModuleContext 的组合逻辑
 *
 * **Feature: module-context-builder-coverage**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Nuxt 自动导入
vi.stubGlobal('logger', {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
})

// Mock 案件服务
const mockGetCaseByIdService = vi.fn()
vi.mock('~~/server/services/case/case.service', () => ({
    getCaseByIdService: (...args: any[]) => mockGetCaseByIdService(...args),
    getSessionByIdService: vi.fn(),
}))

// Mock 材料服务
const mockGetMaterialsByCaseIdService = vi.fn()
vi.mock('~~/server/services/material/material.service', () => ({
    getMaterialsByCaseIdService: (...args: any[]) => mockGetMaterialsByCaseIdService(...args),
}))

// Mock 材料管道服务
const mockGetMaterialContextService = vi.fn()
const mockBuildMaterialContextMessage = vi.fn()
vi.mock('~~/server/services/material/materialPipeline.service', () => ({
    getMaterialContextService: (...args: any[]) => mockGetMaterialContextService(...args),
    buildMaterialContextMessage: (...args: any[]) => mockBuildMaterialContextMessage(...args),
}))

// Mock 初始化分析服务
const mockLoadCompletedResultsService = vi.fn()
vi.mock('~~/server/services/case/initAnalysis.service', () => ({
    loadCompletedResultsService: (...args: any[]) => mockLoadCompletedResultsService(...args),
}))

// Mock checkpointer store
const mockStoreGet = vi.fn()
vi.mock('~~/server/services/workflow/checkpointer', () => ({
    getStore: () => Promise.resolve({ get: mockStoreGet }),
}))

// Mock tokenCounter（测试数据量远小于预算，使用简单的字符估算即可）
vi.mock('~~/server/utils/tokenCounter', () => ({
    countTokensSync: (text: string) => {
        if (!text) return 0
        // 简单估算：约 4 字符 = 1 token
        return Math.ceil(text.length / 4)
    },
}))

import {
    buildModuleContext,
    getCaseMemory,
} from '~~/server/services/workflow/context/moduleContextBuilder'

describe('模块上下文构建器测试', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('buildModuleContext - 构建完整模块上下文', () => {
        it('所有 section 都有数据时返回完整上下文', async () => {
            // 案件信息
            mockGetCaseByIdService.mockResolvedValue({
                title: '民事纠纷案件',
                caseType: { name: '民事案件' },
                plaintiff: ['张三'],
                defendant: ['李四'],
                summary: '一起合同纠纷',
                extractedInfo: null,
            })

            // 材料
            mockGetMaterialsByCaseIdService.mockResolvedValue([{ id: 1 }])
            mockGetMaterialContextService.mockResolvedValue({ mode: 'full' })
            mockBuildMaterialContextMessage.mockReturnValue('材料内容详情...')

            // 已完成分析结果
            mockLoadCompletedResultsService.mockResolvedValue({
                summary: '案件概要内容',
                chronicle: '大事记内容',
            })

            // 记忆
            mockStoreGet.mockResolvedValue({ value: { text: '案件关键记忆' } })

            const result = await buildModuleContext({
                caseId: 1,
                agentName: 'claim', // 排除自身
            })

            expect(result).toContain('## 案件基本信息')
            expect(result).toContain('民事纠纷案件')
            expect(result).toContain('张三')
            expect(result).toContain('李四')
            expect(result).toContain('## 案件材料')
            expect(result).toContain('材料内容详情...')
            expect(result).toContain('## 已完成的分析结果')
            expect(result).toContain('案件概要内容')
            // claim 是当前模块，不应在已完成结果中（因为 loadCompleted 返回的没有 claim）
            expect(result).toContain('## 案件记忆')
            expect(result).toContain('案件关键记忆')
        })

        it('案件不存在时对应 section 为空', async () => {
            mockGetCaseByIdService.mockResolvedValue(null)
            mockGetMaterialsByCaseIdService.mockResolvedValue([])
            mockLoadCompletedResultsService.mockResolvedValue({})
            mockStoreGet.mockResolvedValue(null)

            const result = await buildModuleContext({
                caseId: 999,
                agentName: 'summary',
            })

            expect(result).toBe('')
        })

        it('各 section 独立失败时降级为空', async () => {
            mockGetCaseByIdService.mockRejectedValue(new Error('数据库错误'))
            mockGetMaterialsByCaseIdService.mockRejectedValue(new Error('材料查询失败'))
            mockLoadCompletedResultsService.mockRejectedValue(new Error('分析结果查询失败'))
            mockStoreGet.mockRejectedValue(new Error('记忆查询失败'))

            const result = await buildModuleContext({
                caseId: 1,
                agentName: 'summary',
            })

            // 所有 section 都降级为空，结果为空字符串
            expect(result).toBe('')
        })

        it('排除当前模块的已完成结果', async () => {
            mockGetCaseByIdService.mockResolvedValue(null)
            mockGetMaterialsByCaseIdService.mockResolvedValue([])
            mockLoadCompletedResultsService.mockResolvedValue({
                summary: '概要',
                chronicle: '大事记',
            })
            mockStoreGet.mockResolvedValue(null)

            const result = await buildModuleContext({
                caseId: 1,
                agentName: 'summary', // 排除 summary
            })

            expect(result).toContain('大事记')
            expect(result).not.toContain('概要')
        })

        it('材料为空列表时不生成材料 section', async () => {
            mockGetCaseByIdService.mockResolvedValue(null)
            mockGetMaterialsByCaseIdService.mockResolvedValue([])
            mockLoadCompletedResultsService.mockResolvedValue({})
            mockStoreGet.mockResolvedValue(null)

            const result = await buildModuleContext({
                caseId: 1,
                agentName: 'summary',
            })

            expect(result).not.toContain('## 案件材料')
        })

        it('材料 context mode 为 empty 时不生成材料 section', async () => {
            mockGetCaseByIdService.mockResolvedValue(null)
            mockGetMaterialsByCaseIdService.mockResolvedValue([{ id: 1 }])
            mockGetMaterialContextService.mockResolvedValue({ mode: 'empty' })
            mockLoadCompletedResultsService.mockResolvedValue({})
            mockStoreGet.mockResolvedValue(null)

            const result = await buildModuleContext({
                caseId: 1,
                agentName: 'summary',
            })

            expect(result).not.toContain('## 案件材料')
        })
    })

    describe('buildCaseInfoSection - 案件基本信息', () => {
        it('包含 extractedInfo 扩展字段', async () => {
            mockGetCaseByIdService.mockResolvedValue({
                title: '测试案件',
                caseType: { name: '民事' },
                plaintiff: null,
                defendant: null,
                summary: null,
                extractedInfo: {
                    title: '测试', // 应被跳过
                    plaintiff: ['张三'], // 应被跳过（保留字段）
                    案件金额: '100万元',
                    争议焦点: '合同效力',
                },
            })
            mockGetMaterialsByCaseIdService.mockResolvedValue([])
            mockLoadCompletedResultsService.mockResolvedValue({})
            mockStoreGet.mockResolvedValue(null)

            const result = await buildModuleContext({ caseId: 1, agentName: 'test' })

            expect(result).toContain('案件金额：100万元')
            expect(result).toContain('争议焦点：合同效力')
        })

        it('仅有标题的案件也能生成 section', async () => {
            mockGetCaseByIdService.mockResolvedValue({
                title: '仅标题案件',
                caseType: null,
                plaintiff: null,
                defendant: null,
                summary: null,
                extractedInfo: null,
            })
            mockGetMaterialsByCaseIdService.mockResolvedValue([])
            mockLoadCompletedResultsService.mockResolvedValue({})
            mockStoreGet.mockResolvedValue(null)

            const result = await buildModuleContext({ caseId: 1, agentName: 'test' })

            expect(result).toContain('仅标题案件')
        })
    })

    describe('getCaseMemory - 获取案件长期记忆', () => {
        it('有记忆时返回文本', async () => {
            mockStoreGet.mockResolvedValue({ value: { text: '案件记忆内容' } })

            const result = await getCaseMemory(1)

            expect(result).toBe('案件记忆内容')
            expect(mockStoreGet).toHaveBeenCalledWith(['cases', '1'], 'basic_info')
        })

        it('无记忆时返回 null', async () => {
            mockStoreGet.mockResolvedValue(null)

            const result = await getCaseMemory(999)

            expect(result).toBeNull()
        })

        it('记忆 value.text 为空时返回 null', async () => {
            mockStoreGet.mockResolvedValue({ value: {} })

            const result = await getCaseMemory(1)

            expect(result).toBeNull()
        })
    })
})
