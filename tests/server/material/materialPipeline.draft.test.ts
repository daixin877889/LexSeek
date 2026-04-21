/**
 * materialPipeline.service - draftId 相关函数测试
 *
 * 验证：
 * - getMaterialsByDraftIdService：按 draftId 查询材料并附加文件信息
 * - searchMaterialsByDraftService：基于 draftId 的材料检索
 * - ensureMaterialsReadyForDraftService：单文件 OCR + embedding 保障
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MaterialWithFile } from '../../../server/services/material/material.service'

// ===========================================================
// Prisma 全局 mock（避免测试环境数据库连接）
// ===========================================================

const prismaMock = vi.hoisted(() => ({
    ossFiles: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
    },
    caseMaterials: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
    },
}))

vi.mock('~~/server/utils/prisma', () => ({
    default: prismaMock,
    prisma: prismaMock,
}))

vi.mock('~/server/utils/prisma', () => ({
    default: prismaMock,
    prisma: prismaMock,
}))

// ===========================================================
// Section 1: material.dao mock
// ===========================================================

const mocksMaterialDao = vi.hoisted(() => ({
    findMaterialsByDraftIdDao: vi.fn(),
    findMaterialByIdDao: vi.fn(),
    createMaterialDao: vi.fn(),
    findMaterialsByCaseIdDao: vi.fn(),
    findActiveMaterialByOssFileIdDao: vi.fn(),
}))

vi.mock('../../../server/services/material/material.dao', () => ({
    findMaterialsByDraftIdDao: mocksMaterialDao.findMaterialsByDraftIdDao,
    findMaterialByIdDao: mocksMaterialDao.findMaterialByIdDao,
    createMaterialDao: mocksMaterialDao.createMaterialDao,
    findMaterialsByCaseIdDao: mocksMaterialDao.findMaterialsByCaseIdDao,
    findActiveMaterialByOssFileIdDao: mocksMaterialDao.findActiveMaterialByOssFileIdDao,
}))

vi.mock('~~/server/services/material/material.dao', () => ({
    findMaterialsByDraftIdDao: mocksMaterialDao.findMaterialsByDraftIdDao,
    findMaterialByIdDao: mocksMaterialDao.findMaterialByIdDao,
    createMaterialDao: mocksMaterialDao.createMaterialDao,
    findMaterialsByCaseIdDao: mocksMaterialDao.findMaterialsByCaseIdDao,
    findActiveMaterialByOssFileIdDao: mocksMaterialDao.findActiveMaterialByOssFileIdDao,
}))

// ===========================================================
// Section 2: material.service mock（searchMaterialsByDraftService 内部依赖）
// ===========================================================

const mocksMaterialService = vi.hoisted(() => ({
    getMaterialsByDraftIdService: vi.fn(),
    getMaterialsByCaseIdService: vi.fn(),
    getMaterialByIdService: vi.fn(),
    updateMaterialStatusService: vi.fn(),
}))

// 注意：materialPipeline.service 内部 import 了 getMaterialsByDraftIdService。
// 针对 searchMaterialsByDraftService/ensureMaterialsReadyForDraftService 的测试，
// 需要 mock 掉 material.service 的整个导出，以便控制 getMaterialsByDraftIdService 的返回值。
vi.mock('../../../server/services/material/material.service', () => ({
    getMaterialsByCaseIdService: mocksMaterialService.getMaterialsByCaseIdService,
    getMaterialsByDraftIdService: mocksMaterialService.getMaterialsByDraftIdService,
    getMaterialByIdService: mocksMaterialService.getMaterialByIdService,
    updateMaterialStatusService: mocksMaterialService.updateMaterialStatusService,
}))
vi.mock('~~/server/services/material/material.service', () => ({
    getMaterialsByCaseIdService: mocksMaterialService.getMaterialsByCaseIdService,
    getMaterialsByDraftIdService: mocksMaterialService.getMaterialsByDraftIdService,
    getMaterialByIdService: mocksMaterialService.getMaterialByIdService,
    updateMaterialStatusService: mocksMaterialService.updateMaterialStatusService,
}))

// ===========================================================
// Section 3: retrieval mock
// ===========================================================

const mocksRetrieval = vi.hoisted(() => ({
    retrievalRouterService: vi.fn(),
}))

vi.mock('../../../server/services/retrieval/retrievalRouter.service', () => ({
    retrievalRouterService: mocksRetrieval.retrievalRouterService,
}))
vi.mock('~~/server/services/retrieval/retrievalRouter.service', () => ({
    retrievalRouterService: mocksRetrieval.retrievalRouterService,
}))

// ===========================================================
// Section 4: embedding mock
// ===========================================================

const mocksEmbedding = vi.hoisted(() => ({
    embedMaterialUnifiedService: vi.fn(),
    batchCheckMaterialEmbeddedService: vi.fn().mockResolvedValue(new Map()),
}))

vi.mock('../../../server/services/material/materialEmbedding.service', () => ({
    batchCheckMaterialEmbeddedService: mocksEmbedding.batchCheckMaterialEmbeddedService,
    embedMaterialUnifiedService: mocksEmbedding.embedMaterialUnifiedService,
}))
vi.mock('~~/server/services/material/materialEmbedding.service', () => ({
    batchCheckMaterialEmbeddedService: mocksEmbedding.batchCheckMaterialEmbeddedService,
    embedMaterialUnifiedService: mocksEmbedding.embedMaterialUnifiedService,
}))
const mocksProcess = vi.hoisted(() => ({
    processMaterialService: vi.fn(),
    batchCheckMaterialRecognizedService: vi.fn().mockResolvedValue(new Map()),
}))
vi.mock('../../../server/services/material/materialProcess.service', () => ({
    processMaterialService: mocksProcess.processMaterialService,
    batchCheckMaterialRecognizedService: mocksProcess.batchCheckMaterialRecognizedService,
}))
vi.mock('~~/server/services/material/materialProcess.service', () => ({
    processMaterialService: mocksProcess.processMaterialService,
    batchCheckMaterialRecognizedService: mocksProcess.batchCheckMaterialRecognizedService,
}))

import {
    searchMaterialsByDraftService,
    ensureMaterialsReadyForDraftService,
} from '../../../server/services/material/materialPipeline.service'

// ===========================================================
// 工厂函数
// ===========================================================

function makeMaterialWithFile(overrides: Partial<MaterialWithFile> & { id: number }): MaterialWithFile {
    return {
        caseId: null,
        draftId: 1,
        ossFileId: null,
        isEncrypted: false,
        status: 3,
        name: `材料_${overrides.id}`,
        type: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        summary: null,
        ...overrides,
    } as MaterialWithFile
}

// ===========================================================
// Tests: searchMaterialsByDraftService
// ===========================================================

describe('searchMaterialsByDraftService', () => {
    const userId = 1
    const draftId = 10

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('无材料时返回空数组', async () => {
        mocksMaterialService.getMaterialsByDraftIdService.mockResolvedValue([])

        const result = await searchMaterialsByDraftService(userId, draftId, { query: '测试' })

        expect(result).toEqual([])
        expect(mocksRetrieval.retrievalRouterService).not.toHaveBeenCalled()
    })

    it('有 query 时调用检索路由器', async () => {
        const materials = [
            makeMaterialWithFile({ id: 1, draftId, ossFileId: 100 }),
        ]
        mocksMaterialService.getMaterialsByDraftIdService.mockResolvedValue(materials)
        mocksRetrieval.retrievalRouterService.mockResolvedValue([
            {
                content: '检索结果内容',
                score: 0.9,
                metadata: { sourceId: '100', sourceName: '材料_1', chunkIndex: 0 },
            },
        ])

        const result = await searchMaterialsByDraftService(userId, draftId, { query: '测试查询', k: 5 })

        expect(result).toHaveLength(1)
        expect(result[0]!.content).toBe('检索结果内容')
        expect(result[0]!.relevanceScore).toBe(0.9)
        expect(mocksRetrieval.retrievalRouterService).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'case_material', query: '测试查询' })
        )
    })

    it('传递正确的 type="case_material" 给检索路由器', async () => {
        const materials = [makeMaterialWithFile({ id: 2, draftId, ossFileId: 200 })]
        mocksMaterialService.getMaterialsByDraftIdService.mockResolvedValue(materials)
        mocksRetrieval.retrievalRouterService.mockResolvedValue([])

        await searchMaterialsByDraftService(userId, draftId, { query: '合同条款' })

        expect(mocksRetrieval.retrievalRouterService).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'case_material' })
        )
    })
})

// ===========================================================
// Tests: ensureMaterialsReadyForDraftService
// ===========================================================

describe('ensureMaterialsReadyForDraftService', () => {
    const ossFileId = 100
    const draftId = 10
    const userId = 1

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('已有 draftId + ossFileId 记录且已处理完成时直接返回', async () => {
        // 模拟精确查找已有记录（status=3 表示已完成）
        mocksMaterialDao.findActiveMaterialByOssFileIdDao.mockResolvedValue(
            { id: 99, draftId, ossFileId, status: 3, name: '已有材料', type: 2, caseId: null, isEncrypted: false, createdAt: new Date(), updatedAt: new Date(), deletedAt: null, summary: null }
        )

        const result = await ensureMaterialsReadyForDraftService(ossFileId, draftId, userId)

        expect(result.id).toBe(99)
        // 不应该创建新材料，也不需要轮询
        expect(mocksMaterialDao.createMaterialDao).not.toHaveBeenCalled()
        expect(mocksMaterialDao.findMaterialByIdDao).not.toHaveBeenCalled()
    })

    it('不存在记录时应创建新材料（caseId=null, draftId=X）', async () => {
        // 精确查找返回 null（无记录）
        mocksMaterialDao.findActiveMaterialByOssFileIdDao.mockResolvedValue(null)
        // prisma.ossFiles.findFirst 返回 null（fallback 文件名）
        prismaMock.ossFiles.findFirst.mockResolvedValue(null)
        // 创建后返回新材料
        const newMaterial = { id: 200, draftId, ossFileId, status: 1, name: `材料_${ossFileId}`, type: 2, caseId: null, isEncrypted: false, createdAt: new Date(), updatedAt: new Date(), deletedAt: null, summary: null }
        mocksMaterialDao.createMaterialDao.mockResolvedValue(newMaterial)
        // 触发 embed
        mocksEmbedding.embedMaterialUnifiedService.mockResolvedValue({ success: true })
        // 轮询：第一次 processing，第二次 processed
        mocksMaterialDao.findMaterialByIdDao
            .mockResolvedValueOnce({ id: 200, status: 2, draftId, ossFileId })
            .mockResolvedValueOnce({ id: 200, status: 3, draftId, ossFileId })

        const result = await ensureMaterialsReadyForDraftService(ossFileId, draftId, userId)

        expect(mocksMaterialDao.createMaterialDao).toHaveBeenCalledWith(
            expect.objectContaining({ caseId: null, draftId, ossFileId })
        )
        expect(result.id).toBe(200)
    })

    it('材料处理失败时应抛出错误', async () => {
        mocksMaterialDao.findActiveMaterialByOssFileIdDao.mockResolvedValue(null)
        prismaMock.ossFiles.findFirst.mockResolvedValue(null)
        const newMaterial = { id: 201, draftId, ossFileId, status: 1, name: `材料_${ossFileId}`, type: 2, caseId: null, isEncrypted: false, createdAt: new Date(), updatedAt: new Date(), deletedAt: null, summary: null }
        mocksMaterialDao.createMaterialDao.mockResolvedValue(newMaterial)
        mocksEmbedding.embedMaterialUnifiedService.mockResolvedValue({ success: true })
        // 轮询返回 failed 状态
        mocksMaterialDao.findMaterialByIdDao.mockResolvedValue({ id: 201, status: 4, draftId, ossFileId })

        await expect(
            ensureMaterialsReadyForDraftService(ossFileId, draftId, userId)
        ).rejects.toThrow(/材料处理失败/)
    })

    it('XOR 校验：创建的材料记录 caseId 必须为 null', async () => {
        mocksMaterialDao.findActiveMaterialByOssFileIdDao.mockResolvedValue(null)
        prismaMock.ossFiles.findFirst.mockResolvedValue({ fileName: 'doc.pdf' })
        const newMaterial = { id: 203, draftId, ossFileId, status: 3, name: 'doc.pdf', type: 2, caseId: null, isEncrypted: false, createdAt: new Date(), updatedAt: new Date(), deletedAt: null, summary: null }
        mocksMaterialDao.createMaterialDao.mockResolvedValue(newMaterial)
        mocksEmbedding.embedMaterialUnifiedService.mockResolvedValue({ success: true })
        mocksMaterialDao.findMaterialByIdDao.mockResolvedValue({ id: 203, status: 3, draftId, ossFileId })

        await ensureMaterialsReadyForDraftService(ossFileId, draftId, userId)

        const createCall = mocksMaterialDao.createMaterialDao.mock.calls[0]?.[0]
        expect(createCall).toBeDefined()
        expect(createCall.caseId).toBeNull()
        expect(createCall.draftId).toBe(draftId)
    })

    it('已有记录但处于 processing 状态时应轮询等待', async () => {
        // 精确查找已存在记录但未处理完（status=2）
        mocksMaterialDao.findActiveMaterialByOssFileIdDao.mockResolvedValue(
            { id: 204, draftId, ossFileId, status: 2, name: '处理中材料', type: 2, caseId: null, isEncrypted: false, createdAt: new Date(), updatedAt: new Date(), deletedAt: null, summary: null }
        )
        // 不需要创建新材料，不需要触发 embed
        // 轮询第一次仍 processing，第二次 processed
        mocksMaterialDao.findMaterialByIdDao
            .mockResolvedValueOnce({ id: 204, status: 2, draftId, ossFileId })
            .mockResolvedValueOnce({ id: 204, status: 3, draftId, ossFileId })

        const result = await ensureMaterialsReadyForDraftService(ossFileId, draftId, userId)

        expect(result.id).toBe(204)
        expect(mocksMaterialDao.createMaterialDao).not.toHaveBeenCalled()
    })

    it('该 ossFile 已识别且已嵌入（跨 draft 复用）时短路，不再跑 processMaterialService', async () => {
        // 当前 draft 已存在 caseMaterial 但尚未置 COMPLETED（status=PENDING=1）
        const existing = { id: 205, draftId, ossFileId, status: 1, name: 'shared.pdf', type: 2, caseId: null, isEncrypted: false, createdAt: new Date(), updatedAt: new Date(), deletedAt: null, summary: null }
        mocksMaterialDao.findActiveMaterialByOssFileIdDao.mockResolvedValue(existing)
        // 详情查询返回同一条（给短路使用）
        mocksMaterialService.getMaterialByIdService.mockResolvedValue(existing)
        // 命中跨 draft 识别 + 嵌入
        mocksProcess.batchCheckMaterialRecognizedService.mockResolvedValue(new Map([[205, true]]))
        mocksEmbedding.batchCheckMaterialEmbeddedService.mockResolvedValue(new Map([[205, true]]))

        const result = await ensureMaterialsReadyForDraftService(ossFileId, draftId, userId)

        expect(result.id).toBe(205)
        expect(result.status).toBe(3)
        expect(mocksMaterialService.updateMaterialStatusService).toHaveBeenCalledWith(205, 3)
        expect(mocksProcess.processMaterialService).not.toHaveBeenCalled()
        expect(mocksMaterialDao.findMaterialByIdDao).not.toHaveBeenCalled()
    })
})

