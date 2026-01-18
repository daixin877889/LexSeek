/**
 * 文本材料向量化测试
 * 
 * 测试 CASE_CONTENT 类型材料使用新版元数据格式进行向量化
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { embedTextService, isTextEmbedded, getTextEmbeddingIds, deleteContentEmbeddings } from '../../../server/services/material/materialEmbedding.service'

describe('文本材料向量化', () => {
    const testUserId = 1
    const testMaterialId = 999999 // 使用一个不存在的 ID 进行测试
    const testMaterialName = '测试案情描述'
    const testContent = '这是一个测试案情描述。原告张三诉被告李四合同纠纷一案。'

    afterAll(async () => {
        // 清理测试数据
        await deleteContentEmbeddings('text', testMaterialId)
    })

    it('应该成功向量化文本材料', async () => {
        const result = await embedTextService({
            content: testContent,
            userId: testUserId,
            materialId: testMaterialId,
            materialName: testMaterialName,
        })

        expect(result).toBeDefined()
        expect(result.ids).toBeInstanceOf(Array)
        expect(result.ids.length).toBeGreaterThan(0)
        expect(result.chunkCount).toBeGreaterThan(0)
        expect(result.lastEmbeddingAt).toBeDefined()
    })

    it('应该能检查文本材料是否已向量化', async () => {
        const isEmbedded = await isTextEmbedded(testMaterialId)
        expect(isEmbedded).toBe(true)
    })

    it('应该能获取文本材料的向量 ID 列表', async () => {
        const ids = await getTextEmbeddingIds(testMaterialId)
        expect(ids).toBeInstanceOf(Array)
        expect(ids.length).toBeGreaterThan(0)
    })

    it('应该能删除文本材料的向量数据', async () => {
        const count = await deleteContentEmbeddings('text', testMaterialId)
        expect(count).toBeGreaterThan(0)

        const isEmbedded = await isTextEmbedded(testMaterialId)
        expect(isEmbedded).toBe(false)
    })
})
