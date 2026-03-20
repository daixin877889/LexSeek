/**
 * ensureMaterialsEmbeddedService 测试（重构后）
 *
 * 测试统一嵌入入口的分发、并行执行和容错
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MaterialWithFile } from '../../../server/services/material/material.service'

const mocks = vi.hoisted(() => ({
    embedMaterialUnifiedService: vi.fn(),
}))

vi.mock('../../../server/services/material/materialEmbedding.service', () => ({
    embedMaterialUnifiedService: mocks.embedMaterialUnifiedService,
}))
vi.mock('~~/server/services/material/materialEmbedding.service', () => ({
    embedMaterialUnifiedService: mocks.embedMaterialUnifiedService,
}))

import { ensureMaterialsEmbeddedService } from '../../../server/services/material/materialProcess.service'

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

describe('ensureMaterialsEmbeddedService', () => {
    const userId = 1

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('空数组应返回全零统计', async () => {
        const result = await ensureMaterialsEmbeddedService([], userId)
        expect(result).toEqual({ total: 0, success: 0, failed: 0, skipped: 0 })
    })

    it('成功嵌入应计为 success', async () => {
        mocks.embedMaterialUnifiedService.mockResolvedValue({ success: true, chunkCount: 3 })

        const materials = [makeMaterial({ id: 1, type: 1, name: '案情描述' })]
        const result = await ensureMaterialsEmbeddedService(materials, userId)

        expect(mocks.embedMaterialUnifiedService).toHaveBeenCalledWith(1, userId)
        expect(result.success).toBe(1)
    })

    it('嵌入失败应计为 failed', async () => {
        mocks.embedMaterialUnifiedService.mockResolvedValue({ success: false, error: '向量化失败' })

        const materials = [makeMaterial({ id: 2, type: 2, name: '合同.pdf' })]
        const result = await ensureMaterialsEmbeddedService(materials, userId)

        expect(result.failed).toBe(1)
    })

    it('内容为空返回应计为 skipped', async () => {
        mocks.embedMaterialUnifiedService.mockResolvedValue({ success: false, error: '文档识别记录内容为空' })

        const materials = [makeMaterial({ id: 3, type: 3, name: '证据.jpg' })]
        const result = await ensureMaterialsEmbeddedService(materials, userId)

        expect(result.skipped).toBe(1)
    })

    it('混合结果应正确统计', async () => {
        mocks.embedMaterialUnifiedService
            .mockResolvedValueOnce({ success: true, chunkCount: 3 })
            .mockResolvedValueOnce({ success: false, error: '向量化失败' })
            .mockResolvedValueOnce({ success: false, error: '图片识别记录内容为空' })
            .mockResolvedValueOnce({ success: true, chunkCount: 1 })

        const materials = [
            makeMaterial({ id: 1, type: 1, name: '文本' }),
            makeMaterial({ id: 2, type: 2, name: '文档' }),
            makeMaterial({ id: 3, type: 3, name: '图片' }),
            makeMaterial({ id: 4, type: 4, name: '音频' }),
        ]
        const result = await ensureMaterialsEmbeddedService(materials, userId)

        expect(result).toEqual({ total: 4, success: 2, failed: 1, skipped: 1 })
    })

    it('异常抛出应计为 failed', async () => {
        mocks.embedMaterialUnifiedService.mockRejectedValue(new Error('网络错误'))

        const materials = [makeMaterial({ id: 1, type: 1, name: '文本' })]
        const result = await ensureMaterialsEmbeddedService(materials, userId)

        expect(result.failed).toBe(1)
    })
})
