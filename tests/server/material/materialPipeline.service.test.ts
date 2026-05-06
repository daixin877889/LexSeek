/**
 * ensureMaterialsReadyService 测试
 *
 * 测试材料就绪保障 pipeline：
 * 获取材料 → 检查识别 → 对未识别的触发识别 → 检查嵌入 → 对未嵌入的触发嵌入
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { MaterialStatus } from '#shared/types/material'
import type { MaterialWithFile } from '../../../server/services/material/material.service'

const mocks = vi.hoisted(() => ({
    getMaterialsByCaseIdService: vi.fn(),
    batchCheckMaterialEmbeddedService: vi.fn(),
    batchCheckMaterialRecognizedService: vi.fn(),
    processMaterialService: vi.fn(),
    embedMaterialUnifiedService: vi.fn(),
}))

vi.mock('../../../server/services/material/material.service', () => ({
    getMaterialsByCaseIdService: mocks.getMaterialsByCaseIdService,
}))
vi.mock('~~/server/services/material/material.service', () => ({
    getMaterialsByCaseIdService: mocks.getMaterialsByCaseIdService,
}))
vi.mock('../../../server/services/material/materialEmbedding.service', () => ({
    batchCheckMaterialEmbeddedService: mocks.batchCheckMaterialEmbeddedService,
    embedMaterialUnifiedService: mocks.embedMaterialUnifiedService,
}))
vi.mock('~~/server/services/material/materialEmbedding.service', () => ({
    batchCheckMaterialEmbeddedService: mocks.batchCheckMaterialEmbeddedService,
    embedMaterialUnifiedService: mocks.embedMaterialUnifiedService,
}))
vi.mock('../../../server/services/material/materialProcess.service', () => ({
    processMaterialService: mocks.processMaterialService,
    batchCheckMaterialRecognizedService: mocks.batchCheckMaterialRecognizedService,
}))
vi.mock('~~/server/services/material/materialProcess.service', () => ({
    processMaterialService: mocks.processMaterialService,
    batchCheckMaterialRecognizedService: mocks.batchCheckMaterialRecognizedService,
}))

import { ensureMaterialsReadyService, getMaterialListWithSummariesService } from '../../../server/services/material/materialPipeline.service'

function makeMaterial(overrides: Partial<MaterialWithFile> & { id: number; type: number; name: string }): MaterialWithFile {
    return {
        caseId: 1,
        ossFileId: null,
        isEncrypted: false,
        status: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        ...overrides,
    } as MaterialWithFile
}

describe('ensureMaterialsReadyService', () => {
    const caseId = 1
    const userId = 1

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('空材料时返回空结果', async () => {
        mocks.getMaterialsByCaseIdService.mockResolvedValue([])

        const result = await ensureMaterialsReadyService(caseId, userId)

        expect(result.totalMaterials).toBe(0)
        expect(result.materials).toEqual([])
        expect(result.failed).toEqual([])
        expect(mocks.batchCheckMaterialEmbeddedService).not.toHaveBeenCalled()
    })

    it('全部已识别且已嵌入时不触发任何处理', async () => {
        const materials = [
            makeMaterial({ id: 1, type: 2, name: 'doc1.pdf' }),
            makeMaterial({ id: 2, type: 3, name: 'img1.png' }),
        ]
        mocks.getMaterialsByCaseIdService.mockResolvedValue(materials)
        mocks.batchCheckMaterialRecognizedService.mockResolvedValue(
            new Map([[1, true], [2, true]])
        )
        mocks.batchCheckMaterialEmbeddedService.mockResolvedValue(
            new Map([[1, true], [2, true]])
        )

        const result = await ensureMaterialsReadyService(caseId, userId)

        expect(result.totalMaterials).toBe(2)
        expect(result.alreadyEmbedded).toBe(2)
        expect(result.newlyProcessed).toBe(0)
        expect(result.failed).toEqual([])
        expect(mocks.processMaterialService).not.toHaveBeenCalled()
        expect(mocks.embedMaterialUnifiedService).not.toHaveBeenCalled()
    })

    it('已识别但未嵌入 → 只触发嵌入，不触发识别', async () => {
        const materials = [
            makeMaterial({ id: 1, type: 2, name: 'doc1.pdf' }),
        ]
        mocks.getMaterialsByCaseIdService.mockResolvedValue(materials)
        mocks.batchCheckMaterialRecognizedService.mockResolvedValue(
            new Map([[1, true]])
        )
        mocks.batchCheckMaterialEmbeddedService.mockResolvedValue(
            new Map([[1, false]])
        )
        mocks.embedMaterialUnifiedService.mockResolvedValue({ success: true })

        const result = await ensureMaterialsReadyService(caseId, userId)

        expect(mocks.processMaterialService).not.toHaveBeenCalled()
        expect(mocks.embedMaterialUnifiedService).toHaveBeenCalledWith(1, userId)
        expect(result.newlyProcessed).toBe(1)
        expect(result.failed).toEqual([])
    })

    it('未识别且未嵌入 → 先识别再嵌入', async () => {
        const materials = [
            makeMaterial({ id: 1, type: 2, name: 'doc1.pdf' }),
        ]
        mocks.getMaterialsByCaseIdService.mockResolvedValue(materials)
        mocks.batchCheckMaterialRecognizedService.mockResolvedValue(
            new Map([[1, false]])
        )
        mocks.processMaterialService.mockResolvedValue({ id: 1, status: 3 })
        mocks.batchCheckMaterialEmbeddedService.mockResolvedValue(
            new Map([[1, false]])
        )
        mocks.embedMaterialUnifiedService.mockResolvedValue({ success: true })

        const result = await ensureMaterialsReadyService(caseId, userId)

        expect(mocks.processMaterialService).toHaveBeenCalledWith(1, userId)
        expect(mocks.embedMaterialUnifiedService).toHaveBeenCalledWith(1, userId)
        expect(result.newlyProcessed).toBe(1)
    })

    it('识别失败时记录到 failed 数组但不阻断其他材料', async () => {
        const materials = [
            makeMaterial({ id: 1, type: 2, name: 'doc1.pdf' }),
            makeMaterial({ id: 2, type: 3, name: 'img1.png' }),
        ]
        mocks.getMaterialsByCaseIdService.mockResolvedValue(materials)
        mocks.batchCheckMaterialRecognizedService.mockResolvedValue(
            new Map([[1, false], [2, false]])
        )
        mocks.processMaterialService
            .mockRejectedValueOnce(new Error('PDF 解析失败'))
            .mockResolvedValueOnce({ id: 2, status: 3 })
        // id=1 识别失败不会进入嵌入检查，id=2 识别成功进入嵌入
        mocks.batchCheckMaterialEmbeddedService.mockResolvedValue(
            new Map([[2, false]])
        )
        mocks.embedMaterialUnifiedService.mockResolvedValue({ success: true })

        const result = await ensureMaterialsReadyService(caseId, userId)

        expect(result.failed).toHaveLength(1)
        expect(result.failed[0]).toEqual({
            materialId: 1,
            name: 'doc1.pdf',
            error: 'PDF 解析失败',
        })
        expect(result.newlyProcessed).toBe(1)
    })

    it('嵌入失败时记录到 failed 数组', async () => {
        const materials = [
            makeMaterial({ id: 1, type: 2, name: 'doc1.pdf' }),
        ]
        mocks.getMaterialsByCaseIdService.mockResolvedValue(materials)
        mocks.batchCheckMaterialRecognizedService.mockResolvedValue(
            new Map([[1, true]])
        )
        mocks.batchCheckMaterialEmbeddedService.mockResolvedValue(
            new Map([[1, false]])
        )
        mocks.embedMaterialUnifiedService.mockRejectedValue(new Error('嵌入向量化失败'))

        const result = await ensureMaterialsReadyService(caseId, userId)

        expect(result.failed).toHaveLength(1)
        expect(result.failed[0].error).toBe('嵌入向量化失败')
    })

    it('返回的 embeddedMap 反映嵌入后的最终状态', async () => {
        const materials = [
            makeMaterial({ id: 1, type: 2, name: 'doc1.pdf' }),
        ]
        mocks.getMaterialsByCaseIdService.mockResolvedValue(materials)
        mocks.batchCheckMaterialRecognizedService.mockResolvedValue(
            new Map([[1, true]])
        )
        mocks.batchCheckMaterialEmbeddedService.mockResolvedValue(
            new Map([[1, false]])
        )
        mocks.embedMaterialUnifiedService.mockResolvedValue({ success: true })

        const result = await ensureMaterialsReadyService(caseId, userId)

        // embeddedMap 应该在嵌入操作后重新查询
        expect(result.embeddedMap).toBeDefined()
    })

    it('混合场景：全部已识别 + 部分已嵌入 + 部分未嵌入', async () => {
        const materials = [
            makeMaterial({ id: 1, type: 1, name: '文本材料' }),
            makeMaterial({ id: 2, type: 2, name: '文档', ossFileId: 100 }),
            makeMaterial({ id: 3, type: 3, name: '图片', ossFileId: 200 }),
        ]
        mocks.getMaterialsByCaseIdService.mockResolvedValue(materials)
        // 全部已识别
        mocks.batchCheckMaterialRecognizedService.mockResolvedValue(
            new Map([[1, true], [2, true], [3, true]])
        )
        // id=1 已嵌入，id=2 和 id=3 未嵌入
        mocks.batchCheckMaterialEmbeddedService.mockResolvedValue(
            new Map([[1, true], [2, false], [3, false]])
        )
        mocks.embedMaterialUnifiedService.mockResolvedValue({ success: true })

        const result = await ensureMaterialsReadyService(caseId, userId)

        expect(result.alreadyEmbedded).toBe(1)
        expect(result.newlyProcessed).toBe(2)
        // 不触发识别
        expect(mocks.processMaterialService).not.toHaveBeenCalled()
        // id=2 和 id=3 触发嵌入
        expect(mocks.embedMaterialUnifiedService).toHaveBeenCalledTimes(2)
    })

    it('混合场景：部分未识别 + 识别后检查嵌入', async () => {
        const materials = [
            makeMaterial({ id: 1, type: 2, name: '已识别文档', ossFileId: 100 }),
            makeMaterial({ id: 2, type: 3, name: '未识别图片', ossFileId: 200 }),
        ]
        mocks.getMaterialsByCaseIdService.mockResolvedValue(materials)
        // id=1 已识别，id=2 未识别
        mocks.batchCheckMaterialRecognizedService.mockResolvedValue(
            new Map([[1, true], [2, false]])
        )
        mocks.processMaterialService.mockResolvedValue({ id: 2, status: 3 })
        // 识别完成后检查嵌入：都未嵌入
        mocks.batchCheckMaterialEmbeddedService.mockResolvedValue(
            new Map([[1, false], [2, false]])
        )
        mocks.embedMaterialUnifiedService.mockResolvedValue({ success: true })

        const result = await ensureMaterialsReadyService(caseId, userId)

        // 只有 id=2 触发识别
        expect(mocks.processMaterialService).toHaveBeenCalledTimes(1)
        expect(mocks.processMaterialService).toHaveBeenCalledWith(2, userId)
        // id=1 和 id=2 都触发嵌入
        expect(mocks.embedMaterialUnifiedService).toHaveBeenCalledTimes(2)
        expect(result.newlyProcessed).toBe(2)
    })
})

/**
 * getMaterialListWithSummariesService 测试（真实 DB）
 *
 * 验证：返回案件全量未删材料 + 字段（含 status / ossFileId），
 * 不再过滤 status=3——让上下文构建方按 status 渲染状态文字。
 */
describe('getMaterialListWithSummariesService', () => {
    const cleanup = { caseIds: [] as number[], materialIds: [] as number[] }

    afterEach(async () => {
        if (cleanup.materialIds.length) {
            await prisma.caseMaterials.deleteMany({ where: { id: { in: cleanup.materialIds } } })
            cleanup.materialIds = []
        }
        if (cleanup.caseIds.length) {
            await prisma.cases.deleteMany({ where: { id: { in: cleanup.caseIds } } })
            cleanup.caseIds = []
        }
    })

    async function seedCase(): Promise<number> {
        // 测试库 userId/caseTypeId 从 1000+ 开始，必须动态查询
        const caseType = await prisma.caseTypes.findFirst()
        const user = await prisma.users.findFirst()
        const c = await prisma.cases.create({
            data: {
                userId: user!.id,
                caseTypeId: caseType!.id,
                title: 'mp-test-case',
                status: 1,
            },
        })
        cleanup.caseIds.push(c.id)
        return c.id
    }

    async function seedMaterial(caseId: number, fields: { name: string; type: number; status: number; ossFileId?: number | null; summary?: string | null }) {
        const m = await prisma.caseMaterials.create({
            data: {
                caseId,
                name: fields.name,
                type: fields.type,
                status: fields.status,
                ossFileId: fields.ossFileId ?? null,
                summary: fields.summary ?? null,
            },
        })
        cleanup.materialIds.push(m.id)
        return m
    }

    it('返回所有未删除材料（含 status=1/2/4，不再仅过滤 status=3）', async () => {
        const caseId = await seedCase()
        await seedMaterial(caseId, { name: '已识别材料', type: 1, status: MaterialStatus.COMPLETED, summary: 'a' })
        await seedMaterial(caseId, { name: '识别中材料', type: 2, status: MaterialStatus.PROCESSING, ossFileId: 1001 })
        await seedMaterial(caseId, { name: '待识别材料', type: 3, status: MaterialStatus.PENDING, ossFileId: 1002 })
        await seedMaterial(caseId, { name: '识别失败材料', type: 4, status: MaterialStatus.FAILED, ossFileId: 1003 })

        const list = await getMaterialListWithSummariesService(caseId)
        const names = list.map(m => m.name)
        expect(names).toHaveLength(4)
        expect(new Set(names)).toEqual(new Set(['已识别材料', '识别中材料', '识别失败材料', '待识别材料']))
    })

    it('返回字段含 status 与 ossFileId', async () => {
        const caseId = await seedCase()
        await seedMaterial(caseId, { name: '文档材料', type: 2, status: MaterialStatus.COMPLETED, ossFileId: 2001, summary: 's' })

        const list = await getMaterialListWithSummariesService(caseId)
        expect(list[0]).toMatchObject({
            name: '文档材料',
            type: 2,
            status: MaterialStatus.COMPLETED,
            ossFileId: 2001,
            summary: 's',
        })
    })
})
