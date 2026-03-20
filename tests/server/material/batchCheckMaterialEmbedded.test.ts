// tests/server/material/batchCheckMaterialEmbedded.test.ts

/**
 * 统一嵌入状态查询测试
 *
 * 测试 batchCheckMaterialEmbeddedService 按材料类型查对应识别记录表的 lastEmbeddingAt
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// mock prisma
const mockPrisma = {
    caseMaterials: {
        findMany: vi.fn(),
    },
    textContentRecords: {
        findMany: vi.fn(),
    },
    docRecognitionRecords: {
        findMany: vi.fn(),
    },
    imageRecognitionRecords: {
        findMany: vi.fn(),
    },
    asrRecords: {
        findMany: vi.fn(),
    },
}

vi.stubGlobal('prisma', mockPrisma)

import {
    isMaterialEmbeddedService,
    batchCheckMaterialEmbeddedService,
} from '../../../server/services/material/materialEmbedding.service'

describe('batchCheckMaterialEmbeddedService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('空数组应返回空 Map', async () => {
        const result = await batchCheckMaterialEmbeddedService([])
        expect(result.size).toBe(0)
    })

    it('文本材料应查 textContentRecords 的 lastEmbeddingAt', async () => {
        mockPrisma.caseMaterials.findMany.mockResolvedValue([
            { id: 1, type: 1, ossFileId: null },
        ])
        mockPrisma.textContentRecords.findMany.mockResolvedValue([
            { materialId: 1, lastEmbeddingAt: new Date() },
        ])

        const result = await batchCheckMaterialEmbeddedService([1])
        expect(result.get(1)).toBe(true)
    })

    it('文档材料应查 docRecognitionRecords 的 lastEmbeddingAt', async () => {
        mockPrisma.caseMaterials.findMany.mockResolvedValue([
            { id: 2, type: 2, ossFileId: 100 },
        ])
        mockPrisma.docRecognitionRecords.findMany.mockResolvedValue([
            { ossFileId: 100, lastEmbeddingAt: new Date() },
        ])

        const result = await batchCheckMaterialEmbeddedService([2])
        expect(result.get(2)).toBe(true)
    })

    it('未嵌入的材料应返回 false', async () => {
        mockPrisma.caseMaterials.findMany.mockResolvedValue([
            { id: 3, type: 3, ossFileId: 200 },
        ])
        mockPrisma.imageRecognitionRecords.findMany.mockResolvedValue([
            { ossFileId: 200, lastEmbeddingAt: null },
        ])

        const result = await batchCheckMaterialEmbeddedService([3])
        expect(result.get(3)).toBe(false)
    })

    it('混合类型应正确分发查询', async () => {
        mockPrisma.caseMaterials.findMany.mockResolvedValue([
            { id: 1, type: 1, ossFileId: null },
            { id: 2, type: 2, ossFileId: 100 },
            { id: 3, type: 3, ossFileId: 200 },
            { id: 4, type: 4, ossFileId: 300 },
        ])
        mockPrisma.textContentRecords.findMany.mockResolvedValue([
            { materialId: 1, lastEmbeddingAt: new Date() },
        ])
        mockPrisma.docRecognitionRecords.findMany.mockResolvedValue([
            { ossFileId: 100, lastEmbeddingAt: null },
        ])
        mockPrisma.imageRecognitionRecords.findMany.mockResolvedValue([
            { ossFileId: 200, lastEmbeddingAt: new Date() },
        ])
        mockPrisma.asrRecords.findMany.mockResolvedValue([
            { ossFileId: 300, lastEmbeddingAt: new Date() },
        ])

        const result = await batchCheckMaterialEmbeddedService([1, 2, 3, 4])
        expect(result.get(1)).toBe(true)   // 文本，已嵌入
        expect(result.get(2)).toBe(false)  // 文档，未嵌入
        expect(result.get(3)).toBe(true)   // 图片，已嵌入
        expect(result.get(4)).toBe(true)   // 音频，已嵌入
    })

    it('找不到材料的 ID 应返回 false', async () => {
        mockPrisma.caseMaterials.findMany.mockResolvedValue([])

        const result = await batchCheckMaterialEmbeddedService([999])
        expect(result.get(999)).toBe(false)
    })
})

describe('isMaterialEmbeddedService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('单个材料已嵌入应返回 true', async () => {
        mockPrisma.caseMaterials.findMany.mockResolvedValue([
            { id: 1, type: 1, ossFileId: null },
        ])
        mockPrisma.textContentRecords.findMany.mockResolvedValue([
            { materialId: 1, lastEmbeddingAt: new Date() },
        ])

        const result = await isMaterialEmbeddedService(1)
        expect(result).toBe(true)
    })
})
