/**
 * MinerU PDF 转换 DAO 层
 *
 * 提供文档识别记录的数据访问功能
 * Requirements: 3.1.1-3.1.19
 */

import type { docRecognitionRecords, Prisma } from '~~/generated/prisma/client'
import { DocRecognitionStatus } from '#shared/types/recognition'

interface DocRecognitionRecordUpdateData {
    status?: number
    htmlContent?: string
    markdownContent?: string
    keywords?: any
    summary?: string
    vectorIds?: string[]
    lastEmbeddingAt?: Date
    lastEditAt?: Date
}

/**
 * 创建文档识别记录
 */
export const createDocRecognitionRecordDao = async (
    data: {
        userId: number
        ossFileId: number
        status?: number
        markdownContent?: string
        htmlContent?: string
    },
    tx?: Prisma.TransactionClient
): Promise<docRecognitionRecords> => {
    try {
        const record = await (tx || prisma).docRecognitionRecords.create({
            data: {
                userId: data.userId,
                ossFileId: data.ossFileId,
                status: data.status ?? DocRecognitionStatus.PENDING,
                markdownContent: data.markdownContent,
                htmlContent: data.htmlContent,
            },
        })
        return record
    } catch (error) {
        logger.error('创建文档识别记录失败：', error)
        throw error
    }
}

/**
 * 通过 ossFileId 查询文档识别记录
 */
export const findDocRecognitionByOssFileIdDao = async (
    ossFileId: number,
    tx?: Prisma.TransactionClient
): Promise<docRecognitionRecords | null> => {
    try {
        const record = await (tx || prisma).docRecognitionRecords.findFirst({
            where: {
                ossFileId,
                deletedAt: null
            },
        })
        return record
    } catch (error) {
        logger.error('通过 ossFileId 查询文档识别记录失败：', error)
        throw error
    }
}

/**
 * 更新文档识别记录
 */
export const updateDocRecognitionRecordDao = async (
    id: number,
    data: DocRecognitionRecordUpdateData,
    tx?: Prisma.TransactionClient
): Promise<docRecognitionRecords> => {
    try {
        const record = await (tx || prisma).docRecognitionRecords.update({
            where: { id },
            data: {
                ...data,
                updatedAt: new Date(),
            },
        })
        return record
    } catch (error) {
        logger.error('更新文档识别记录失败：', error)
        throw error
    }
}

/**
 * 按记录 ID + 用户 ID 更新文档识别记录，供用户端 owner-only 写接口使用
 */
export const updateDocRecognitionRecordByIdAndUserIdDao = async (
    id: number,
    userId: number,
    data: DocRecognitionRecordUpdateData,
    tx?: Prisma.TransactionClient
): Promise<docRecognitionRecords | null> => {
    try {
        const client = tx || prisma
        const result = await client.docRecognitionRecords.updateMany({
            where: {
                id,
                userId,
                deletedAt: null,
            },
            data: {
                ...data,
                updatedAt: new Date(),
            },
        })

        if (result.count !== 1) {
            return null
        }

        return await client.docRecognitionRecords.findFirst({
            where: {
                id,
                userId,
                deletedAt: null,
            },
        })
    } catch (error) {
        logger.error('按用户归属更新文档识别记录失败：', error)
        throw error
    }
}

/**
 * 批量获取文档识别记录
 */
export const findDocRecognitionsByOssFileIdsDao = async (
    ossFileIds: number[],
    tx?: Prisma.TransactionClient
): Promise<docRecognitionRecords[]> => {
    try {
        const records = await (tx || prisma).docRecognitionRecords.findMany({
            where: {
                ossFileId: { in: ossFileIds },
                deletedAt: null,
            },
        })
        return records
    } catch (error) {
        logger.error('批量获取文档识别记录失败：', error)
        throw error
    }
}
