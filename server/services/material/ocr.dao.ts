/**
 * 图片识别记录 DAO 层
 *
 * 提供图片识别记录的数据库操作
 * Requirements: 3.3.1-3.3.11
 */

import type { imageRecognitionRecords, Prisma } from '~~/generated/prisma/client'

/** 图片识别状态枚举 */
export enum ImageRecognitionStatus {
    /** 待处理 */
    PENDING = 0,
    /** 处理中 */
    PROCESSING = 1,
    /** 已完成 */
    COMPLETED = 2,
    /** 失败 */
    FAILED = 3,
}

/** 图片类型枚举 */
export enum ImageType {
    /** 文档 */
    DOC = 'doc',
    /** 照片 */
    PHOTO = 'photo',
}

/**
 * 创建图片识别记录
 */
export const createImageRecognitionRecordDao = async (
    data: {
        userId: number
        ossFileId: number
        status?: ImageRecognitionStatus
        imageType?: ImageType
        htmlContent?: string
        markdownContent?: string
    },
    tx?: Prisma.TransactionClient
): Promise<imageRecognitionRecords> => {
    try {
        const record = await (tx || prisma).imageRecognitionRecords.create({
            data: {
                userId: data.userId,
                ossFileId: data.ossFileId,
                status: data.status ?? ImageRecognitionStatus.PENDING,
                imageType: data.imageType,
                htmlContent: data.htmlContent,
                markdownContent: data.markdownContent,
                lastEditAt: new Date(),
            },
        })
        return record
    } catch (error) {
        logger.error('创建图片识别记录失败:', error)
        throw error
    }
}

/**
 * 通过 ossFileId 查询图片识别记录
 */
export const findImageRecognitionByOssFileIdDao = async (
    ossFileId: number,
    tx?: Prisma.TransactionClient
): Promise<imageRecognitionRecords | null> => {
    try {
        const record = await (tx || prisma).imageRecognitionRecords.findFirst({
            where: { ossFileId, deletedAt: null },
        })
        return record
    } catch (error) {
        logger.error('查询图片识别记录失败:', error)
        throw error
    }
}

/**
 * 通过 ID 查询图片识别记录
 */
export const findImageRecognitionByIdDao = async (
    id: number,
    tx?: Prisma.TransactionClient
): Promise<imageRecognitionRecords | null> => {
    try {
        const record = await (tx || prisma).imageRecognitionRecords.findFirst({
            where: { id, deletedAt: null },
        })
        return record
    } catch (error) {
        logger.error('查询图片识别记录失败:', error)
        throw error
    }
}

/**
 * 更新图片识别记录
 */
export const updateImageRecognitionRecordDao = async (
    id: number,
    data: {
        status?: ImageRecognitionStatus
        imageType?: ImageType
        htmlContent?: string
        markdownContent?: string
        keywords?: any
        summary?: string
        vectorIds?: string[]
        lastEmbeddingAt?: Date
    },
    tx?: Prisma.TransactionClient
): Promise<imageRecognitionRecords> => {
    try {
        // 如果更新了内容，同时更新 lastEditAt
        const updateData: Prisma.imageRecognitionRecordsUpdateInput = {
            ...data,
            updatedAt: new Date(),
        }

        if (data.htmlContent !== undefined || data.markdownContent !== undefined) {
            updateData.lastEditAt = new Date()
        }

        const record = await (tx || prisma).imageRecognitionRecords.update({
            where: { id },
            data: updateData,
        })
        return record
    } catch (error) {
        logger.error('更新图片识别记录失败:', error)
        throw error
    }
}

/**
 * 批量获取图片识别记录
 */
export const findImageRecognitionsByOssFileIdsDao = async (
    ossFileIds: number[],
    tx?: Prisma.TransactionClient
): Promise<imageRecognitionRecords[]> => {
    try {
        const records = await (tx || prisma).imageRecognitionRecords.findMany({
            where: {
                ossFileId: { in: ossFileIds },
                deletedAt: null,
            },
        })
        return records
    } catch (error) {
        logger.error('批量查询图片识别记录失败:', error)
        throw error
    }
}

/**
 * 软删除图片识别记录
 */
export const deleteImageRecognitionRecordDao = async (
    id: number,
    tx?: Prisma.TransactionClient
): Promise<imageRecognitionRecords> => {
    try {
        const record = await (tx || prisma).imageRecognitionRecords.update({
            where: { id },
            data: {
                deletedAt: new Date(),
                updatedAt: new Date(),
            },
        })
        return record
    } catch (error) {
        logger.error('删除图片识别记录失败:', error)
        throw error
    }
}
