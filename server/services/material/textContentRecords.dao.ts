// server/services/material/textContentRecords.dao.ts

/**
 * 文本内容记录数据访问层
 *
 * 提供 textContentRecords 表的 CRUD 操作和嵌入状态更新
 */

import type { textContentRecords, Prisma } from '~~/generated/prisma/client'

/**
 * 创建文本内容记录
 */
export const createTextContentRecordDAO = async (
    data: {
        userId: number
        caseId: number
        materialId?: number | null
        content?: string | null
        htmlContent?: string | null
    },
    tx?: Prisma.TransactionClient
): Promise<textContentRecords> => {
    const client = tx || prisma
    return client.textContentRecords.create({
        data: {
            userId: data.userId,
            caseId: data.caseId,
            materialId: data.materialId ?? null,
            content: data.content ?? null,
            htmlContent: data.htmlContent ?? null,
        },
    })
}

/**
 * 按 ID 查询
 */
export const findTextContentRecordByIdDAO = async (
    id: number,
    tx?: Prisma.TransactionClient
): Promise<textContentRecords | null> => {
    const client = tx || prisma
    return client.textContentRecords.findFirst({
        where: { id, deletedAt: null },
    })
}

/**
 * 按 materialId 查询
 */
export const findTextContentRecordByMaterialIdDAO = async (
    materialId: number,
    tx?: Prisma.TransactionClient
): Promise<textContentRecords | null> => {
    const client = tx || prisma
    return client.textContentRecords.findFirst({
        where: { materialId, deletedAt: null },
    })
}

/**
 * 批量按 materialId 查询
 */
export const findTextContentRecordsByMaterialIdsDAO = async (
    materialIds: number[],
    tx?: Prisma.TransactionClient
): Promise<textContentRecords[]> => {
    const client = tx || prisma
    return client.textContentRecords.findMany({
        where: {
            materialId: { in: materialIds },
            deletedAt: null,
        },
    })
}

/**
 * 更新嵌入结果
 */
export const updateTextContentRecordEmbeddingDAO = async (
    id: number,
    data: {
        vectorIds?: string[]
        lastEmbeddingAt?: Date
        status?: number
    },
    tx?: Prisma.TransactionClient
): Promise<void> => {
    const client = tx || prisma
    await client.textContentRecords.update({
        where: { id },
        data: {
            ...(data.vectorIds !== undefined && { vectorIds: data.vectorIds }),
            ...(data.lastEmbeddingAt !== undefined && { lastEmbeddingAt: data.lastEmbeddingAt }),
            ...(data.status !== undefined && { status: data.status }),
            updatedAt: new Date(),
        },
    })
}
