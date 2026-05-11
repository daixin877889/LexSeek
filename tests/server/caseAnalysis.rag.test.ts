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

// completeAnalysisWithRAG 内部走 analysisSummary 节点取 apiKey + systemPrompt；测试 DB 里
// 该节点的 modelApiKeys 通常为空，会走"跳过摘要生成"分支让 summary 落空。
// Mock getValidNodeConfig 让它返回有效配置，进入 generateSummaryService（已被 mock）路径。
vi.mock('~~/server/services/node/node.service', async (orig) => {
    const actual: any = await (orig as any)()
    return {
        ...actual,
        getValidNodeConfig: vi.fn().mockResolvedValue({
            id: 999,
            name: 'analysisSummary',
            title: '案件分析结果摘要',
            type: 'extraction',
            modelName: 'gpt-4o-mini',
            modelSdkType: 'openai',
            modelProviderBaseUrl: 'https://api.openai.com/v1',
            modelApiKeys: [{ id: 1, apiKey: 'sk-test-fake', status: 1 }],
            prompts: [{ id: 1, type: 'system', status: 1, content: '你是分析摘要助手' }],
            outputSchema: null,
        }),
    }
})

// createChatModel 真实跑会去构造 SDK；mock 成 stub，generateSummaryService 已被 mock 不会真用它
vi.mock('~~/server/services/node/chatModelFactory', async (orig) => {
    const actual: any = await (orig as any)()
    return {
        ...actual,
        createChatModel: vi.fn(() => ({ _model: 'stub' })),
    }
})

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

describe('switchActiveVersionService · 同步 embeddings.metadata.isActive', () => {
    const testIds: CaseTestIds = createEmptyTestIds()
    const prisma = getTestPrisma()

    let dbAvailable = false
    let caseId: number
    let nodeId: number
    let sessionId: string
    let v1: number
    let v2: number

    beforeAll(async () => {
        dbAvailable = await isTestDbAvailable()
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

        const a1 = await prisma.caseAnalyses.create({
            data: { caseId, sessionId, nodeId, analysisType: 'risk_assessment', status: 2, version: 1, isActive: true },
        })
        const a2 = await prisma.caseAnalyses.create({
            data: { caseId, sessionId, nodeId, analysisType: 'risk_assessment', status: 2, version: 2, isActive: false },
        })
        v1 = a1.id
        v2 = a2.id
        testIds.analysisIds.push(v1, v2)

        await prisma.$executeRawUnsafe(
            `INSERT INTO case_analysis_embeddings (text, metadata) VALUES ('v1 text', $1::jsonb), ('v2 text', $2::jsonb)`,
            JSON.stringify({ caseId, analysisId: v1, nodeId, version: 1, isActive: true, chunkIndex: 0 }),
            JSON.stringify({ caseId, analysisId: v2, nodeId, version: 2, isActive: false, chunkIndex: 0 }),
        )
    })

    afterEach(async () => {
        if (!dbAvailable) return

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
    })

    it('切到 v2：v2 embedding.isActive=true，v1=false', async () => {
        if (!dbAvailable) return

        const { switchActiveVersionService } = await import('~~/server/services/case/analysis.service')
        await switchActiveVersionService(v2)

        const rows: any[] = await prisma.$queryRawUnsafe(
            `SELECT metadata->>'analysisId' AS aid, metadata->>'isActive' AS active
             FROM case_analysis_embeddings
             WHERE metadata->>'caseId' = $1
             ORDER BY (metadata->>'analysisId')::int ASC`,
            caseId.toString(),
        )
        const v1Row = rows.find((r) => Number(r.aid) === v1)
        const v2Row = rows.find((r) => Number(r.aid) === v2)
        expect(v1Row?.active).toBe('false')
        expect(v2Row?.active).toBe('true')
    })
})
