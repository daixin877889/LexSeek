/**
 * materialPipeline.service 上下文相关函数测试
 *
 * 测试：getSourceId, estimateTokens, getMaterialContextService,
 * buildMaterialContextMessage, buildIncrementalMaterialMessage
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MaterialWithFile } from '../../../server/services/material/material.service'
import { CaseMaterialType } from '#shared/types/case'

const mockPrisma = {
    textContentRecords: { findMany: vi.fn() },
    docRecognitionRecords: { findMany: vi.fn() },
    imageRecognitionRecords: { findMany: vi.fn() },
    asrRecords: { findMany: vi.fn() },
}
vi.stubGlobal('prisma', mockPrisma)

import {
    getSourceId,
    estimateTokens,
    getMaterialContextService,
    buildMaterialContextMessage,
    buildIncrementalMaterialMessage,
} from '../../../server/services/material/materialPipeline.service'

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

describe('getSourceId', () => {
    it('文本材料返回 materialId', () => {
        const m = makeMaterial({ id: 10, type: CaseMaterialType.CASE_CONTENT, name: '案情' })
        expect(getSourceId(m)).toBe(10)
    })

    it('文档材料返回 ossFileId', () => {
        const m = makeMaterial({ id: 10, type: CaseMaterialType.DOCUMENT, name: 'doc', ossFileId: 100 })
        expect(getSourceId(m)).toBe(100)
    })

    it('图片材料返回 ossFileId', () => {
        const m = makeMaterial({ id: 10, type: CaseMaterialType.IMAGE, name: 'img', ossFileId: 200 })
        expect(getSourceId(m)).toBe(200)
    })

    it('音频材料返回 ossFileId', () => {
        const m = makeMaterial({ id: 10, type: CaseMaterialType.AUDIO, name: 'audio', ossFileId: 300 })
        expect(getSourceId(m)).toBe(300)
    })
})

describe('estimateTokens', () => {
    it('空字符串返回 0', () => {
        expect(estimateTokens('')).toBe(0)
    })

    it('中文约 2 字符/token', () => {
        const text = '你好世界' // 4 个中文字符 → 约 2 tokens
        expect(estimateTokens(text)).toBe(2)
    })

    it('英文约 4 字符/token', () => {
        const text = 'hello world' // 11 个字符 → 约 2.75 → ceil → 3 tokens
        expect(estimateTokens(text)).toBe(3)
    })
})

describe('getMaterialContextService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockPrisma.textContentRecords.findMany.mockResolvedValue([])
        mockPrisma.docRecognitionRecords.findMany.mockResolvedValue([])
        mockPrisma.imageRecognitionRecords.findMany.mockResolvedValue([])
        mockPrisma.asrRecords.findMany.mockResolvedValue([])
    })

    it('空材料返回 empty 模式', async () => {
        const result = await getMaterialContextService([])
        expect(result.mode).toBe('empty')
        expect(result.materialList).toEqual([])
    })

    it('小量内容返回 full 模式', async () => {
        const materials = [
            makeMaterial({ id: 1, type: CaseMaterialType.CASE_CONTENT, name: '案情描述' }),
        ]
        mockPrisma.textContentRecords.findMany.mockResolvedValue([
            { materialId: 1, content: '短文本内容' },
        ])

        const result = await getMaterialContextService(materials)

        expect(result.mode).toBe('full')
        expect(result.materialList).toHaveLength(1)
        expect(result.materialList[0].content).toBe('短文本内容')
        expect(result.materialList[0].sourceId).toBe(1)
    })

    it('超过阈值返回 summary 模式', async () => {
        const materials = [
            makeMaterial({ id: 1, type: CaseMaterialType.CASE_CONTENT, name: '案情描述' }),
        ]
        // 制造一个超大内容
        const longContent = '这是一段很长的中文内容。'.repeat(10000)
        mockPrisma.textContentRecords.findMany.mockResolvedValue([
            { materialId: 1, content: longContent },
        ])

        const result = await getMaterialContextService(materials, 100) // 低阈值强制 summary

        expect(result.mode).toBe('summary')
        expect(result.materialList[0].summary).toBeDefined()
        expect(result.materialList[0].content).toBeUndefined()
    })

    it('无内容的材料 hasContent 为 false', async () => {
        const materials = [
            makeMaterial({ id: 1, type: CaseMaterialType.DOCUMENT, name: 'doc.pdf', ossFileId: 100 }),
        ]

        const result = await getMaterialContextService(materials)

        expect(result.materialList[0].hasContent).toBe(false)
    })
})

describe('buildMaterialContextMessage', () => {
    it('full 模式包含完整内容和 sourceId 标记', () => {
        const context = {
            mode: 'full' as const,
            totalTokens: 100,
            materialList: [
                { sourceId: 2, name: '起诉状.pdf', type: 2, hasContent: true, mode: 'full' as const, content: '起诉内容...' },
            ],
        }
        const msg = buildMaterialContextMessage(context)
        expect(msg).toContain('[sourceId=2]')
        expect(msg).toContain('起诉状.pdf')
        expect(msg).toContain('起诉内容...')
    })

    it('summary 模式包含摘要和检索提示', () => {
        const context = {
            mode: 'summary' as const,
            totalTokens: 50000,
            materialList: [
                { sourceId: 2, name: '起诉状.pdf', type: 2, hasContent: true, mode: 'summary' as const, summary: '摘要...' },
            ],
        }
        const msg = buildMaterialContextMessage(context)
        expect(msg).toContain('[sourceId=2]')
        expect(msg).toContain('search_case_materials')
        expect(msg).toContain('sourceId')
    })
})

describe('buildIncrementalMaterialMessage', () => {
    it('固定 summary 格式，包含新增提示', () => {
        const context = {
            mode: 'summary' as const,
            totalTokens: 100,
            materialList: [
                { sourceId: 8, name: '补充证据.pdf', type: 2, hasContent: true, mode: 'summary' as const, summary: '补充...' },
            ],
        }
        const msg = buildIncrementalMaterialMessage(context)
        expect(msg).toContain('新增')
        expect(msg).toContain('[sourceId=8]')
        expect(msg).toContain('search_case_materials')
    })
})
