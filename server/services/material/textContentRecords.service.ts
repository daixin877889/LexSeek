// server/services/material/textContentRecords.service.ts

/**
 * 文本内容记录服务层
 *
 * 提供文本材料的嵌入编排（查找记录 → 调用向量化 → 更新状态）
 */

import {
    findTextContentRecordByIdDAO,
    findTextContentRecordByMaterialIdDAO,
    updateTextContentRecordEmbeddingDAO,
} from './textContentRecords.dao'
import { embedTextService } from './materialEmbedding.service'

/**
 * 嵌入文本内容记录
 *
 * @param textRecordId textContentRecords.id
 * @param userId 用户 ID
 * @returns 嵌入结果
 */
export const embedTextContentService = async (
    textRecordId: number,
    userId: number,
): Promise<{ success: boolean; chunkCount?: number; error?: string }> => {
    try {
        // 1. 查找记录
        const record = await findTextContentRecordByIdDAO(textRecordId)
        if (!record) {
            return { success: false, error: '文本内容记录不存在' }
        }

        // 2. 验证内容
        if (!record.content || record.content.trim() === '') {
            return { success: false, error: '文本内容为空' }
        }

        // 3. 更新状态为处理中
        await updateTextContentRecordEmbeddingDAO(textRecordId, { status: 1 })

        // 4. 调用向量化服务
        // embedTextService 签名: (input: EmbedTextInput) => Promise<EmbedTextResult>
        // EmbedTextInput: { content, userId, materialId, materialName }
        // EmbedTextResult: { ids, lastEmbeddingAt, chunkCount }
        const result = await embedTextService({
            content: record.content,
            userId,
            materialId: record.materialId ?? textRecordId,
            materialName: `text-record-${textRecordId}`,
        })

        // 5. 更新嵌入结果
        await updateTextContentRecordEmbeddingDAO(textRecordId, {
            vectorIds: result.ids,
            lastEmbeddingAt: new Date(result.lastEmbeddingAt),
            status: 2,
        })

        return { success: true, chunkCount: result.chunkCount }
    } catch (error: any) {
        // 更新状态为失败
        try {
            await updateTextContentRecordEmbeddingDAO(textRecordId, { status: 3 })
        } catch {
            // 忽略状态更新失败
        }

        logger.error(`文本内容记录 ${textRecordId} 嵌入失败`, error)
        return { success: false, error: error.message || '嵌入失败' }
    }
}

/**
 * 按 materialId 嵌入文本内容
 *
 * 先通过 materialId 查找 textContentRecords 记录，再执行嵌入
 *
 * @param materialId case_materials.id
 * @param userId 用户 ID
 * @returns 嵌入结果
 */
export const embedTextContentByMaterialIdService = async (
    materialId: number,
    userId: number,
): Promise<{ success: boolean; chunkCount?: number; error?: string }> => {
    const record = await findTextContentRecordByMaterialIdDAO(materialId)
    if (!record) {
        return { success: false, error: `materialId=${materialId} 对应的文本内容记录不存在` }
    }
    return embedTextContentService(record.id, userId)
}
