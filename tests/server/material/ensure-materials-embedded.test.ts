/**
 * ensureMaterialsEmbeddedService 测试
 *
 * 测试批量嵌入服务的分发逻辑、并行执行和容错行为
 * mock 向量化服务避免真实 embedding API 调用
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MaterialWithFile } from '../../../server/services/material/material.service'

// 使用 vi.hoisted 确保 mock fn 实例在所有路径别名中共享
const mocks = vi.hoisted(() => ({
    embedTextMaterialService: vi.fn(),
    embedMaterialService: vi.fn(),
    updateMaterialEmbeddingStatusDAO: vi.fn(),
}))

// mock caseMaterial.service（embedTextMaterialService 通过动态 import 加载）
vi.mock('../../../server/services/case/caseMaterial.service', () => ({
    embedTextMaterialService: mocks.embedTextMaterialService,
}))
vi.mock('~~/server/services/case/caseMaterial.service', () => ({
    embedTextMaterialService: mocks.embedTextMaterialService,
}))

// mock materialEmbedding.service（embedMaterialService 通过静态 import 被 materialProcess.service 使用）
vi.mock('../../../server/services/material/materialEmbedding.service', () => ({
    embedMaterialService: mocks.embedMaterialService,
}))
vi.mock('~~/server/services/material/materialEmbedding.service', () => ({
    embedMaterialService: mocks.embedMaterialService,
}))

// mock caseMaterial.dao（updateMaterialEmbeddingStatusDAO）
vi.mock('../../../server/services/case/caseMaterial.dao', () => ({
    updateMaterialEmbeddingStatusDAO: mocks.updateMaterialEmbeddingStatusDAO,
}))
vi.mock('~~/server/services/case/caseMaterial.dao', () => ({
    updateMaterialEmbeddingStatusDAO: mocks.updateMaterialEmbeddingStatusDAO,
}))

import { ensureMaterialsEmbeddedService } from '../../../server/services/material/materialProcess.service'

const { embedTextMaterialService, embedMaterialService, updateMaterialEmbeddingStatusDAO } = mocks

// 辅助：创建测试材料
function makeMaterial(overrides: Partial<MaterialWithFile> & { id: number; type: number; name: string }): MaterialWithFile {
    return {
        caseId: 1,
        content: '测试内容',
        originalContent: null,
        ossFileId: null,
        isEncrypted: false,
        status: 3,
        embeddingStatus: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        ...overrides,
    } as MaterialWithFile
}

describe('ensureMaterialsEmbeddedService', () => {
    const userId = 1
    const caseId = 1
    const sessionId = 'test-session-id'

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('空数组应返回全零统计', async () => {
        const result = await ensureMaterialsEmbeddedService([], userId, caseId, sessionId)
        expect(result).toEqual({ total: 0, success: 0, failed: 0, skipped: 0 })
    })

    it('文本材料应调用 embedTextMaterialService', async () => {
        vi.mocked(embedTextMaterialService).mockResolvedValue({
            success: true, materialId: 1, chunkCount: 3,
        })

        const materials = [makeMaterial({ id: 1, type: 1, name: '案情描述' })]
        const result = await ensureMaterialsEmbeddedService(materials, userId, caseId, sessionId)

        expect(embedTextMaterialService).toHaveBeenCalledWith(1, userId, caseId, sessionId)
        expect(result.success).toBe(1)
        expect(result.total).toBe(1)
    })

    it('非文本材料（有 content）应调用 embedMaterialService', async () => {
        vi.mocked(embedMaterialService).mockResolvedValue({
            ids: ['id1'], lastEmbeddingAt: '2026-01-01', chunkCount: 2,
        })
        vi.mocked(updateMaterialEmbeddingStatusDAO).mockResolvedValue(undefined)

        const materials = [makeMaterial({ id: 2, type: 2, name: '合同.pdf', content: 'PDF内容' })]
        const result = await ensureMaterialsEmbeddedService(materials, userId, caseId, sessionId)

        expect(embedMaterialService).toHaveBeenCalledWith(expect.objectContaining({
            content: 'PDF内容',
            userId,
            caseId,
            materialId: 2,
            sessionId,
            materialName: '合同.pdf',
            materialType: 2,
        }))
        expect(updateMaterialEmbeddingStatusDAO).toHaveBeenCalledWith(2, 'processing')
        expect(updateMaterialEmbeddingStatusDAO).toHaveBeenCalledWith(2, 'completed')
        expect(result.success).toBe(1)
    })

    it('非文本材料 content 为空应标记 skipped', async () => {
        const materials = [makeMaterial({ id: 3, type: 3, name: '证据.jpg', content: null })]
        const result = await ensureMaterialsEmbeddedService(materials, userId, caseId, sessionId)

        expect(embedMaterialService).not.toHaveBeenCalled()
        expect(updateMaterialEmbeddingStatusDAO).not.toHaveBeenCalled()
        expect(result.skipped).toBe(1)
        expect(result.success).toBe(0)
    })

    it('混合材料应全部并行处理并正确统计', async () => {
        vi.mocked(embedTextMaterialService).mockResolvedValue({
            success: true, materialId: 1, chunkCount: 3,
        })
        vi.mocked(embedMaterialService).mockResolvedValue({
            ids: ['id1'], lastEmbeddingAt: '2026-01-01', chunkCount: 2,
        })
        vi.mocked(updateMaterialEmbeddingStatusDAO).mockResolvedValue(undefined)

        const materials = [
            makeMaterial({ id: 1, type: 1, name: '案情描述' }),          // 文本
            makeMaterial({ id: 2, type: 2, name: '合同.pdf', content: 'PDF' }), // 文档有内容
            makeMaterial({ id: 3, type: 3, name: '证据.jpg', content: null }),  // 图片无内容
            makeMaterial({ id: 4, type: 4, name: '录音.mp3', content: '转写' }), // 音频有内容
        ]
        const result = await ensureMaterialsEmbeddedService(materials, userId, caseId, sessionId)

        expect(result).toEqual({ total: 4, success: 3, failed: 0, skipped: 1 })
    })

    it('embedTextMaterialService 失败应计为 failed', async () => {
        vi.mocked(embedTextMaterialService).mockRejectedValue(new Error('向量化失败'))

        const materials = [makeMaterial({ id: 1, type: 1, name: '案情描述' })]
        const result = await ensureMaterialsEmbeddedService(materials, userId, caseId, sessionId)

        expect(result.failed).toBe(1)
        expect(result.success).toBe(0)
    })

    it('embedMaterialService 失败应更新状态为 failed', async () => {
        vi.mocked(embedMaterialService).mockRejectedValue(new Error('向量化失败'))
        vi.mocked(updateMaterialEmbeddingStatusDAO).mockResolvedValue(undefined)

        const materials = [makeMaterial({ id: 2, type: 2, name: '合同.pdf', content: 'PDF' })]
        const result = await ensureMaterialsEmbeddedService(materials, userId, caseId, sessionId)

        expect(updateMaterialEmbeddingStatusDAO).toHaveBeenCalledWith(2, 'failed')
        expect(result.failed).toBe(1)
    })

    it('embedTextMaterialService 返回 success: false 应计为 failed', async () => {
        vi.mocked(embedTextMaterialService).mockResolvedValue({
            success: false, materialId: 1, error: '内容为空',
        })

        const materials = [makeMaterial({ id: 1, type: 1, name: '案情描述' })]
        const result = await ensureMaterialsEmbeddedService(materials, userId, caseId, sessionId)

        expect(result.failed).toBe(1)
    })

    it('状态更新失败不应阻断流程，仍返回 failed', async () => {
        vi.mocked(embedMaterialService).mockRejectedValue(new Error('向量化失败'))
        vi.mocked(updateMaterialEmbeddingStatusDAO)
            .mockResolvedValueOnce(undefined) // processing 成功
            .mockRejectedValueOnce(new Error('数据库连接失败')) // failed 状态更新失败

        const materials = [makeMaterial({ id: 2, type: 2, name: '合同.pdf', content: 'PDF' })]
        const result = await ensureMaterialsEmbeddedService(materials, userId, caseId, sessionId)

        expect(result.failed).toBe(1)
        expect(result.success).toBe(0)
    })
})
