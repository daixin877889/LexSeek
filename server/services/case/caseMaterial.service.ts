/**
 * 案件材料服务层
 *
 * 提供案件材料的业务逻辑处理，包括材料添加、验证等
 */

import type { Prisma } from '~~/generated/prisma/client'
import type { CaseMaterialParam } from '#shared/types/case'
import { CaseMaterialType } from '#shared/types/case'
import { findOssFileByIdDao } from '../files/ossFiles.dao'
import { batchAddCaseMaterialsDAO } from './caseMaterial.dao'

/**
 * 批量添加案件材料
 * 
 * 职责：
 * 1. 遍历材料参数列表
 * 2. 对于文本材料：直接构建材料数据
 * 3. 对于文件材料：
 *    - 查询 OSS 文件记录
 *    - 验证文件存在
 *    - 验证文件属于当前用户
 *    - 使用文件名作为默认材料名称
 * 4. 调用 DAO 层批量创建
 * 
 * @param caseId 案件 ID
 * @param userId 用户 ID
 * @param materials 材料参数列表
 * @param tx 事务对象（可选）
 */
export const batchAddCaseMaterialsService = async (
    caseId: number,
    userId: number,
    materials: CaseMaterialParam[],
    tx?: Prisma.TransactionClient
): Promise<void> => {
    // 如果没有材料，直接返回
    if (!materials || materials.length === 0) {
        return
    }

    // 构建材料数据列表
    const materialDataList: Array<{
        name: string
        type: number
        content?: string | null
        originalContent?: string | null
        ossFileId?: number | null
        isEncrypted?: boolean
        status?: number
        embeddingStatus?: 'pending' | 'processing' | 'completed' | 'failed'
    }> = []

    // 遍历材料参数，构建材料数据
    for (const material of materials) {
        // 验证材料类型
        if (!Object.values(CaseMaterialType).includes(material.type)) {
            throw new Error(`无效的材料类型: ${material.type}`)
        }

        // 处理文本材料
        if (material.type === CaseMaterialType.CASE_CONTENT) {
            // 验证文本内容
            if (!material.content || material.content.trim() === '') {
                throw new Error('文本材料必须包含内容')
            }

            materialDataList.push({
                name: material.name || '案情描述',
                type: material.type,
                content: material.content,
                originalContent: material.content,
                status: 1, // 待处理
            })
        } else {
            // 处理文件材料（文档、图片、音频）
            if (!material.ossFileId) {
                throw new Error('文件材料必须提供 OSS 文件 ID')
            }

            // 查询 OSS 文件记录
            const ossFile = await findOssFileByIdDao(material.ossFileId, tx)

            // 验证文件存在
            if (!ossFile) {
                throw new Error('OSS 文件不存在')
            }

            // 验证文件属于当前用户
            if (ossFile.userId !== userId) {
                throw new Error('无权使用该文件，请检查文件权限')
            }

            // 使用文件名作为默认材料名称
            const materialName = material.name || ossFile.fileName

            // 检查文件是否已完成识别和向量化
            // 如果已完成，则直接设置 embedding_status 为 completed
            let embeddingStatus: 'pending' | 'processing' | 'completed' | 'failed' = 'pending'

            try {
                const client = tx || prisma

                if (material.type === CaseMaterialType.DOCUMENT) {
                    // 检查文档识别记录
                    const docRecord = await client.docRecognitionRecords.findFirst({
                        where: {
                            ossFileId: material.ossFileId,
                            status: 2, // 成功
                            deletedAt: null,
                        },
                        select: {
                            vectorIds: true,
                        },
                    })

                    if (docRecord && docRecord.vectorIds && Array.isArray(docRecord.vectorIds) && docRecord.vectorIds.length > 0) {
                        embeddingStatus = 'completed'
                        logger.info(`文档 ${material.ossFileId} 已完成向量化，设置 embedding_status 为 completed`)
                    }
                } else if (material.type === CaseMaterialType.IMAGE) {
                    // 检查图片识别记录
                    const imageRecord = await client.imageRecognitionRecords.findFirst({
                        where: {
                            ossFileId: material.ossFileId,
                            status: 2, // 成功
                            deletedAt: null,
                        },
                        select: {
                            vectorIds: true,
                        },
                    })

                    if (imageRecord && imageRecord.vectorIds && Array.isArray(imageRecord.vectorIds) && imageRecord.vectorIds.length > 0) {
                        embeddingStatus = 'completed'
                        logger.info(`图片 ${material.ossFileId} 已完成向量化，设置 embedding_status 为 completed`)
                    }
                } else if (material.type === CaseMaterialType.AUDIO) {
                    // 检查音频识别记录
                    const audioRecord = await client.asrRecords.findFirst({
                        where: {
                            ossFileId: material.ossFileId,
                            status: 2, // 成功
                            deletedAt: null,
                        },
                        select: {
                            vectorIds: true,
                        },
                    })

                    if (audioRecord && audioRecord.vectorIds && Array.isArray(audioRecord.vectorIds) && audioRecord.vectorIds.length > 0) {
                        embeddingStatus = 'completed'
                        logger.info(`音频 ${material.ossFileId} 已完成向量化，设置 embedding_status 为 completed`)
                    }
                }
            } catch (checkError: any) {
                // 检查失败不影响材料创建，使用默认的 pending 状态
                logger.warn(`检查文件 ${material.ossFileId} 向量化状态失败`, {
                    error: checkError.message,
                })
            }

            materialDataList.push({
                name: materialName,
                type: material.type,
                ossFileId: material.ossFileId,
                isEncrypted: ossFile.encrypted || false,
                status: 1, // 待处理
                embeddingStatus, // 根据识别记录设置向量化状态
            })
        }
    }

    // 调用 DAO 层批量创建材料
    await batchAddCaseMaterialsDAO(caseId, materialDataList, tx)
}

/**
 * 为文本材料生成向量嵌入
 * Requirements: 8.2
 * 
 * @param materialId 材料 ID
 * @param userId 用户 ID
 * @param caseId 案件 ID（保留参数以保持接口兼容，但不再使用）
 * @param sessionId 会话 ID（保留参数以保持接口兼容，但不再使用）
 * @returns 向量化结果
 */
export const embedTextMaterialService = async (
    materialId: number,
    userId: number,
    caseId: number,
    sessionId: string
): Promise<{
    success: boolean
    materialId: number
    chunkCount?: number
    error?: string
}> => {
    try {
        // 导入 DAO 和向量化服务
        const { findMaterialByIdDAO, updateMaterialEmbeddingStatusDAO } = await import('./caseMaterial.dao')
        const { embedTextService } = await import('../material/materialEmbedding.service')

        // 1. 查询材料
        const material = await findMaterialByIdDAO(materialId)

        if (!material) {
            throw new Error('材料不存在')
        }

        // 2. 验证材料类型（只处理文本材料）
        if (material.type !== CaseMaterialType.CASE_CONTENT) {
            throw new Error('只能为文本材料生成向量')
        }

        // 3. 验证材料内容
        if (!material.content || material.content.trim() === '') {
            throw new Error('材料内容为空')
        }

        // 4. 更新状态为处理中
        await updateMaterialEmbeddingStatusDAO(materialId, 'processing')

        // 5. 调用新版向量化服务（使用统一的元数据格式）
        const result = await embedTextService({
            content: material.content,
            userId,
            materialId,
            materialName: material.name,
        })

        // 6. 更新状态为完成
        await updateMaterialEmbeddingStatusDAO(materialId, 'completed')

        logger.info(`文本材料 ${materialId} 向量化成功`, {
            materialId,
            chunkCount: result.chunkCount,
        })

        return {
            success: true,
            materialId,
            chunkCount: result.chunkCount,
        }
    } catch (error: any) {
        // 更新状态为失败
        try {
            const { updateMaterialEmbeddingStatusDAO } = await import('./caseMaterial.dao')
            await updateMaterialEmbeddingStatusDAO(materialId, 'failed')
        } catch (updateError) {
            logger.error('更新材料向量化状态失败', updateError)
        }

        logger.error(`文本材料 ${materialId} 向量化失败`, error)

        return {
            success: false,
            materialId,
            error: error.message || '向量化失败',
        }
    }
}

/**
 * 批量为文本材料生成向量嵌入
 * Requirements: 8.2
 * 
 * @param materialIds 材料 ID 列表
 * @param userId 用户 ID
 * @param caseId 案件 ID
 * @param sessionId 会话 ID
 * @returns 批量向量化结果
 */
export const batchEmbedTextMaterialsService = async (
    materialIds: number[],
    userId: number,
    caseId: number,
    sessionId: string
): Promise<{
    total: number
    success: number
    failed: number
    results: Array<{
        success: boolean
        materialId: number
        chunkCount?: number
        error?: string
    }>
}> => {
    const results: Array<{
        success: boolean
        materialId: number
        chunkCount?: number
        error?: string
    }> = []

    // 逐个处理材料向量化
    for (const materialId of materialIds) {
        const result = await embedTextMaterialService(materialId, userId, caseId, sessionId)
        results.push(result)
    }

    // 统计结果
    const success = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length

    logger.info(`批量向量化完成`, {
        total: materialIds.length,
        success,
        failed,
    })

    return {
        total: materialIds.length,
        success,
        failed,
        results,
    }
}
