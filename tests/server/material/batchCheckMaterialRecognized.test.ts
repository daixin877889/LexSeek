/**
 * batchCheckMaterialRecognizedService 测试
 *
 * 批量检查材料是否已在各识别记录表中完成识别
 * - 文本(1): textContentRecords 中 content 非空
 * - 文档(2): docRecognitionRecords 中 status === 2
 * - 图片(3): imageRecognitionRecords 中 status === 2
 * - 音频(4): asrRecords 中 status === 2
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MaterialWithFile } from '../../../server/services/material/material.service'

const mockPrisma = {
    textContentRecords: { findMany: vi.fn() },
    docRecognitionRecords: { findMany: vi.fn() },
    imageRecognitionRecords: { findMany: vi.fn() },
    asrRecords: { findMany: vi.fn() },
}

vi.stubGlobal('prisma', mockPrisma)

import { batchCheckMaterialRecognizedService } from '../../../server/services/material/materialProcess.service'

function makeMaterial(overrides: Partial<MaterialWithFile> & { id: number; type: number; name: string }): MaterialWithFile {
    return {
        caseId: 1,
        ossFileId: null,
        isEncrypted: false,
        status: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        ...overrides,
    } as MaterialWithFile
}

describe('batchCheckMaterialRecognizedService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockPrisma.textContentRecords.findMany.mockResolvedValue([])
        mockPrisma.docRecognitionRecords.findMany.mockResolvedValue([])
        mockPrisma.imageRecognitionRecords.findMany.mockResolvedValue([])
        mockPrisma.asrRecords.findMany.mockResolvedValue([])
    })

    it('空数组返回空 Map', async () => {
        const result = await batchCheckMaterialRecognizedService([])
        expect(result.size).toBe(0)
    })

    it('文本材料：content 非空则已识别', async () => {
        const materials = [
            makeMaterial({ id: 1, type: 1, name: '文本1' }),
            makeMaterial({ id: 2, type: 1, name: '文本2' }),
        ]
        mockPrisma.textContentRecords.findMany.mockResolvedValue([
            { materialId: 1 },
        ])

        const result = await batchCheckMaterialRecognizedService(materials)

        expect(result.get(1)).toBe(true)
        expect(result.get(2)).toBe(false)
    })

    it('文档材料：status === 2 则已识别', async () => {
        const materials = [
            makeMaterial({ id: 10, type: 2, name: 'doc.pdf', ossFileId: 100 }),
            makeMaterial({ id: 11, type: 2, name: 'doc2.pdf', ossFileId: 101 }),
        ]
        mockPrisma.docRecognitionRecords.findMany.mockResolvedValue([
            { ossFileId: 100 },
        ])

        const result = await batchCheckMaterialRecognizedService(materials)

        expect(result.get(10)).toBe(true)
        expect(result.get(11)).toBe(false)
    })

    it('图片材料：status === 2 则已识别', async () => {
        const materials = [
            makeMaterial({ id: 20, type: 3, name: 'img.png', ossFileId: 200 }),
        ]
        mockPrisma.imageRecognitionRecords.findMany.mockResolvedValue([
            { ossFileId: 200 },
        ])

        const result = await batchCheckMaterialRecognizedService(materials)

        expect(result.get(20)).toBe(true)
    })

    it('音频材料：status === 2 则已识别', async () => {
        const materials = [
            makeMaterial({ id: 30, type: 4, name: 'audio.mp3', ossFileId: 300 }),
        ]
        mockPrisma.asrRecords.findMany.mockResolvedValue([
            { ossFileId: 300 },
        ])

        const result = await batchCheckMaterialRecognizedService(materials)

        expect(result.get(30)).toBe(true)
    })

    it('混合类型材料批量检查', async () => {
        const materials = [
            makeMaterial({ id: 1, type: 1, name: '文本' }),
            makeMaterial({ id: 2, type: 2, name: '文档', ossFileId: 100 }),
            makeMaterial({ id: 3, type: 3, name: '图片', ossFileId: 200 }),
            makeMaterial({ id: 4, type: 4, name: '音频', ossFileId: 300 }),
        ]
        mockPrisma.textContentRecords.findMany.mockResolvedValue([{ materialId: 1 }])
        mockPrisma.docRecognitionRecords.findMany.mockResolvedValue([])
        mockPrisma.imageRecognitionRecords.findMany.mockResolvedValue([{ ossFileId: 200 }])
        mockPrisma.asrRecords.findMany.mockResolvedValue([{ ossFileId: 300 }])

        const result = await batchCheckMaterialRecognizedService(materials)

        expect(result.get(1)).toBe(true)
        expect(result.get(2)).toBe(false)
        expect(result.get(3)).toBe(true)
        expect(result.get(4)).toBe(true)
    })

    it('无 ossFileId 的非文本材料视为未识别', async () => {
        const materials = [
            makeMaterial({ id: 5, type: 2, name: '无文件文档', ossFileId: null }),
        ]

        const result = await batchCheckMaterialRecognizedService(materials)

        expect(result.get(5)).toBe(false)
    })
})
