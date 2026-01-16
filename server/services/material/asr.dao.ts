/**
 * ASR 识别记录 DAO 层
 *
 * 提供 ASR 识别记录的数据访问功能
 * Requirements: 3.2.1-3.2.10
 */

import type { asrRecords, Prisma } from '~~/generated/prisma/client'
import type { AsrRecordStatus as AsrRecordStatusType } from '#shared/types/recognition'

/** 创建 ASR 识别记录输入 */
export interface CreateAsrRecordInput {
    /** 用户 ID */
    userId: number
    /** OSS 文件 ID */
    ossFileId: number
    /** ASR 任务 ID */
    asrTasksId?: number
    /** 状态 */
    status?: number
    /** 音频 URL */
    audioUrl?: string
    /** 音频时长（秒） */
    audioDuration?: number
    /** 识别结果 */
    result?: Record<string, any>
    /** 说话人列表 */
    speakers?: Array<{ id: number; name: string; color?: string }>
    /** 临时文件路径（加密文件解密后上传的路径） */
    tempFilePath?: string
}

/** 更新 ASR 识别记录输入 */
export interface UpdateAsrRecordInput {
    /** 状态 */
    status?: number
    /** 音频 URL */
    audioUrl?: string
    /** 音频时长（秒） */
    audioDuration?: number
    /** 识别结果 */
    result?: Record<string, any>
    /** 转录原始 JSON 的 OSS 文件 ID */
    jsonOssFileId?: number
    /** 说话人列表 */
    speakers?: Array<{ id: number; name: string; color?: string }>
    /** 关键词 */
    keywords?: any
    /** 摘要 */
    summary?: string
    /** 向量存储 ID 集合 */
    vectorIds?: string[]
    /** 最后嵌入时间 */
    lastEmbeddingAt?: Date
    /** 最后编辑时间 */
    lastEditAt?: Date
    /** 临时文件路径（加密文件解密后上传的路径） */
    tempFilePath?: string | null
}

/**
 * 创建 ASR 识别记录
 */
export const createAsrRecordDao = async (
    data: CreateAsrRecordInput,
    tx?: Prisma.TransactionClient
): Promise<asrRecords> => {
    try {
        const record = await (tx || prisma).asrRecords.create({
            data: {
                userId: data.userId,
                ossFileId: data.ossFileId,
                asrTasksId: data.asrTasksId,
                status: data.status ?? AsrRecordStatus.PENDING,
                audioUrl: data.audioUrl,
                audioDuration: data.audioDuration,
                result: data.result ?? {},
                speakers: data.speakers ?? [],
                tempFilePath: data.tempFilePath,
            },
        })
        return record
    } catch (error) {
        logger.error('创建 ASR 识别记录失败：', error)
        throw error
    }
}

/**
 * 通过 ID 查询 ASR 识别记录
 */
export const findAsrRecordByIdDao = async (
    id: number,
    tx?: Prisma.TransactionClient
): Promise<asrRecords | null> => {
    try {
        const record = await (tx || prisma).asrRecords.findFirst({
            where: { id, deletedAt: null },
        })
        return record
    } catch (error) {
        logger.error('通过 ID 查询 ASR 识别记录失败：', error)
        throw error
    }
}

/**
 * 通过 ossFileId 查询 ASR 识别记录
 */
export const findAsrRecordByOssFileIdDao = async (
    ossFileId: number,
    tx?: Prisma.TransactionClient
): Promise<asrRecords | null> => {
    try {
        const record = await (tx || prisma).asrRecords.findFirst({
            where: { ossFileId, deletedAt: null },
        })
        return record
    } catch (error) {
        logger.error('通过 ossFileId 查询 ASR 识别记录失败：', error)
        throw error
    }
}

/**
 * 通过 ossFileId 集合查询 ASR 识别记录
 */
export const findAsrRecordsByOssFileIdsDao = async (
    ossFileIds: number[],
    tx?: Prisma.TransactionClient
): Promise<asrRecords[]> => {
    try {
        const records = await (tx || prisma).asrRecords.findMany({
            where: {
                ossFileId: { in: ossFileIds },
                deletedAt: null,
            },
        })
        return records
    } catch (error) {
        logger.error('通过 ossFileId 集合查询 ASR 识别记录失败：', error)
        throw error
    }
}

/**
 * 通过 asrTasksId 查询 ASR 识别记录列表
 */
export const findAsrRecordsByTaskIdDao = async (
    asrTasksId: number,
    tx?: Prisma.TransactionClient
): Promise<asrRecords[]> => {
    try {
        const records = await (tx || prisma).asrRecords.findMany({
            where: { asrTasksId, deletedAt: null },
        })
        return records
    } catch (error) {
        logger.error('通过 asrTasksId 查询 ASR 识别记录失败：', error)
        throw error
    }
}

/**
 * 更新 ASR 识别记录
 */
export const updateAsrRecordDao = async (
    id: number,
    data: UpdateAsrRecordInput,
    tx?: Prisma.TransactionClient
): Promise<asrRecords> => {
    try {
        const record = await (tx || prisma).asrRecords.update({
            where: { id },
            data: {
                ...data,
                updatedAt: new Date(),
            },
        })
        return record
    } catch (error) {
        logger.error('更新 ASR 识别记录失败：', error)
        throw error
    }
}

/**
 * 批量更新 ASR 识别记录状态
 */
export const updateAsrRecordsByTaskIdDao = async (
    asrTasksId: number,
    status: number,
    tx?: Prisma.TransactionClient
): Promise<number> => {
    try {
        const result = await (tx || prisma).asrRecords.updateMany({
            where: { asrTasksId, deletedAt: null },
            data: {
                status,
                updatedAt: new Date(),
            },
        })
        return result.count
    } catch (error) {
        logger.error('批量更新 ASR 识别记录状态失败：', error)
        throw error
    }
}
