/**
 * MinerU PDF 转换 DAO 层
 *
 * 提供文档识别记录的数据访问功能
 * Requirements: 3.1.1-3.1.19
 */

import type { docRecognitionRecords, Prisma } from '~~/generated/prisma/client'
import { DocRecognitionStatus } from './mineru.service'

/**
 * 创建文档识别记录
 */
export const createDocRecognitionRecordDao = async (
    data: {
        userId: number
        ossFileId: number
        status?: number
    },
    tx?: Prisma.TransactionClient
): Promise<docRecognitionRecords> => {
    try {
        const record = await (tx || prisma).docRecognitionRecords.create({
            data: {
                userId: data.userId,
                ossFileId: data.ossFileId,
                status: data.status ?? DocRecognitionStatus.PENDING,
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
            where: { ossFileId, deletedAt: null },
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
    data: {
        status?: number
        htmlContent?: string
        markdownContent?: string
        keywords?: any
        summary?: string
        vectorIds?: string[]
        lastEmbeddingAt?: Date
        lastEditAt?: Date
    },
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
