/**
 * completeAnalysisWithRAG 集成测试
 *
 * **Feature: M4 case-analysis-rag**
 * **Validates: Task 3 - 模块分析完成时同步生成 summary + 事务外写 embedding**
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import {
    getTestPrisma,
    createTestUser,
    createTestCaseType,
    createTestCase,
    createTestSession,
    createTestModelProvider,
    createTestModel,
    createTestNode,
    cleanupTestData,
    createEmptyTestIds,
    disconnectTestDb,
    isTestDbAvailable,
    resetDatabaseSequences,
    type CaseTestIds,
} from './case/test-db-helper'

// Mock generateSummaryService 避免真实调用 LLM
vi.mock('~~/server/services/ai/summaryService', () => ({
    generateSummaryService: vi.fn().mockResolvedValue('风险等级：中高。依据：违约条款明确，证据链完整。'),
}))

// Mock addDocumentsToVectorStore 避免真实写入向量库
vi.mock('~~/server/services/legal/vectorStore.service', async (orig) => {
    const actual: any = await (orig as any)()
    return {
        ...actual,
        addDocumentsToVectorStore: vi.fn().mockResolvedValue(undefined),
    }
})

describe('completeAnalysisWithRAG（集成测）', () => {
    const testIds: CaseTestIds = createEmptyTestIds()
    const prisma = getTestPrisma()

    let dbAvailable = false
    let caseId: number
    let analysisId: number
    let sessionId: string
    let nodeId: number

    beforeAll(async () => {
        dbAvailable = await isTestDbAvailable()
        if (dbAvailable) {
            await resetDatabaseSequences()
        }
    })

    afterAll(async () => {
        if (dbAvailable) {
            await disconnectTestDb()
        }
    })

    beforeEach(async () => {
        if (!dbAvailable) return

        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const caseType = await createTestCaseType()
        testIds.caseTypeIds.push(caseType.id)

        const testCase = await createTestCase({ userId: user.id, caseTypeId: caseType.id })
        testIds.caseIds.push(testCase.id)
        caseId = testCase.id

        const provider = await createTestModelProvider()
        testIds.modelProviderIds.push(provider.id)

        const model = await createTestModel({ providerId: provider.id })
        testIds.modelIds.push(model.id)

        const node = await createTestNode({ modelId: model.id })
        testIds.nodeIds.push(node.id)
        nodeId = node.id

        const session = await createTestSession({ caseId, type: 2 })
        testIds.sessionIds.push(session.sessionId)
        sessionId = session.sessionId

        const analysis = await prisma.caseAnalyses.create({
            data: {
                caseId,
                sessionId,
                nodeId,
                analysisType: 'risk_assessment',
                status: 1,
                version: 1,
                isActive: false,
            },
        })
        testIds.analysisIds.push(analysis.id)
        analysisId = analysis.id
    })

    afterEach(async () => {
        if (!dbAvailable) return

        // 清理 case_analysis_embeddings（按 caseId 删）
        await prisma.$executeRawUnsafe(
            `DELETE FROM case_analysis_embeddings WHERE metadata->>'caseId' = $1`,
            caseId.toString(),
        )

        await cleanupTestData(testIds)
        testIds.userIds.length = 0
        testIds.caseIds.length = 0
        testIds.caseTypeIds.length = 0
        testIds.sessionIds.length = 0
        testIds.analysisIds.length = 0
        testIds.nodeIds.length = 0
        testIds.modelIds.length = 0
        testIds.modelProviderIds.length = 0

        vi.clearAllMocks()
    })

    it('完成分析后 summary 被写入', async () => {
        if (!dbAvailable) return

        const { completeAnalysisWithRAG } = await import('~~/server/services/case/initAnalysis.service')
        await completeAnalysisWithRAG({
            analysisId,
            analysisResult: '风险评估分析全文：本案违约责任明确...',
            model: { invoke: vi.fn() } as any,
        })

        const updated = await prisma.caseAnalyses.findUnique({ where: { id: analysisId } })
        expect(updated?.status).toBe(2)
        expect(updated?.summary).toContain('风险等级')
        expect(updated?.isActive).toBe(true)
    })

    it('embedding 写入走 addDocumentsToVectorStore', async () => {
        if (!dbAvailable) return

        const { completeAnalysisWithRAG } = await import('~~/server/services/case/initAnalysis.service')
        const { addDocumentsToVectorStore } = await import('~~/server/services/legal/vectorStore.service')

        await completeAnalysisWithRAG({
            analysisId,
            analysisResult: '分析正文第一段。\n\n分析正文第二段。',
            model: { invoke: vi.fn() } as any,
        })

        expect(addDocumentsToVectorStore).toHaveBeenCalled()
        const call = (addDocumentsToVectorStore as any).mock.calls[0]
        expect(call[2]).toEqual({ tableName: 'case_analysis_embeddings' })

        // 切块 docs 结构验证
        const docs = call[0]
        expect(Array.isArray(docs)).toBe(true)
        expect(docs.length).toBeGreaterThan(0)
        expect(docs[0].metadata).toMatchObject({
            caseId,
            analysisId,
            nodeId,
            analysisType: 'risk_assessment',
            version: 1,
            isActive: true,
            chunkIndex: 0,
        })
        expect(typeof docs[0].metadata.id).toBe('string')

        // ids 参数为 uuid 数组，长度与 docs 一致
        const ids = call[1]
        expect(Array.isArray(ids)).toBe(true)
        expect(ids.length).toBe(docs.length)
    })

    it('embedding 失败只 warn，不回滚主分析', async () => {
        if (!dbAvailable) return

        const { completeAnalysisWithRAG } = await import('~~/server/services/case/initAnalysis.service')
        const { addDocumentsToVectorStore } = await import('~~/server/services/legal/vectorStore.service')
        ;(addDocumentsToVectorStore as any).mockRejectedValueOnce(new Error('embedding service down'))

        await completeAnalysisWithRAG({
            analysisId,
            analysisResult: '分析正文',
            model: { invoke: vi.fn() } as any,
        })

        const updated = await prisma.caseAnalyses.findUnique({ where: { id: analysisId } })
        expect(updated?.status).toBe(2)
        expect(updated?.summary).toBeTruthy()
    })
})
