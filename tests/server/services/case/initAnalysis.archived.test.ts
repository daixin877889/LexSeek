/**
 * initAnalysisService ARCHIVED 守卫测试
 *
 * **Feature: case-archived-guard**
 * **Validates: M1 spec §1.4 / §12 铁律 — ARCHIVED 案件不可启动分析**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFindUnique = vi.fn()
const mockUpdate = vi.fn()
const mockUpdateMany = vi.fn()
const mockTransaction = vi.fn()

// Mock prisma global (Nuxt auto-import)
vi.stubGlobal('prisma', {
    caseAnalyses: {
        findUnique: (...args: any[]) => mockFindUnique(...args),
        update: (...args: any[]) => mockUpdate(...args),
        updateMany: (...args: any[]) => mockUpdateMany(...args),
    },
    $transaction: (...args: any[]) => mockTransaction(...args),
    $executeRawUnsafe: vi.fn(),
})

vi.stubGlobal('logger', {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
})

// Mock 下游依赖（避免真实调用 LLM / vector store）
vi.mock('~~/server/services/ai/summaryService', () => ({
    generateSummaryService: vi.fn().mockResolvedValue('summary'),
}))
vi.mock('~~/server/services/legal/vectorStore.service', () => ({
    addDocumentsToVectorStore: vi.fn().mockResolvedValue(undefined),
}))

describe('initAnalysisService ARCHIVED 守卫', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('completeAnalysisWithRAG 对 ARCHIVED 案件抛出"案件已归档"错误', async () => {
        const { completeAnalysisWithRAG } = await import('~~/server/services/case/initAnalysis.service')

        mockFindUnique.mockResolvedValue({
            id: 100,
            caseId: 1,
            nodeId: 10,
            analysisType: 'overview',
            version: 1,
            case: { status: 999 }, // ARCHIVED
        })

        await expect(
            completeAnalysisWithRAG({
                analysisId: 100,
                analysisResult: '分析正文',
                model: {} as any,
            }),
        ).rejects.toThrow('案件已归档，不可启动分析')

        // 守卫应在 LLM 调用前阻断，不会进入事务写入
        expect(mockTransaction).not.toHaveBeenCalled()
    })

    it('completeAnalysisWithRAG 对非 ARCHIVED 案件正常进入主流程', async () => {
        const { completeAnalysisWithRAG } = await import('~~/server/services/case/initAnalysis.service')

        mockFindUnique.mockResolvedValue({
            id: 100,
            caseId: 1,
            nodeId: 10,
            analysisType: 'overview',
            version: 1,
            case: { status: 1 }, // CONSULTING
        })

        // 事务回调返回写入结果
        mockTransaction.mockImplementation(async (fn: any) => {
            return fn({
                caseAnalyses: {
                    update: vi.fn().mockResolvedValue({
                        id: 100,
                        caseId: 1,
                        nodeId: 10,
                        analysisType: 'overview',
                        version: 1,
                    }),
                    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
                },
            })
        })

        // 函数签名为 Promise<string>，summary 节点未配置时返回 ''（initial value）
        // 旧测试断言 toBeUndefined 是基于 implicit return undefined 的 pre-existing bug；
        // Langfuse 集成时实施者把 inner 函数补成 explicit `return summary`，与签名对齐
        await expect(
            completeAnalysisWithRAG({
                analysisId: 100,
                analysisResult: '分析正文',
                model: {} as any,
            }),
        ).resolves.toBe('')

        expect(mockTransaction).toHaveBeenCalled()
    })
})
