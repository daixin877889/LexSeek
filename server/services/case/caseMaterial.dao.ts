/**
 * 案件材料数据访问层
 *
 * 提供案件材料的 CRUD 操作
 */

import type { caseMaterials, Prisma } from '~~/generated/prisma/client'

/**
 * 批量添加案件材料
 * 
 * @param caseId 案件 ID
 * @param materials 材料数据列表
 * @param tx 事务对象（可选）
 */
export const batchAddCaseMaterialsDAO = async (
    caseId: number,
    materials: Array<{
        name: string
        type: number
        content?: string | null
        originalContent?: string | null
        ossFileId?: number | null
        isEncrypted?: boolean
        status?: number
        embeddingStatus?: 'pending' | 'processing' | 'completed' | 'failed'
    }>,
    tx?: Prisma.TransactionClient
): Promise<void> => {
    const client = tx || prisma
    try {
        // 构建批量创建数据
        const createData = materials.map(material => ({
            caseId,
            name: material.name,
            type: material.type,
            content: material.content ?? null,
            originalContent: material.originalContent ?? null,
            ossFileId: material.ossFileId ?? null,
            isEncrypted: material.isEncrypted ?? false,
            status: material.status ?? 1, // 默认状态：待处理
            embeddingStatus: material.embeddingStatus ?? 'pending', // 默认向量化状态：待处理
            createdAt: new Date(),
            updatedAt: new Date(),
        }))

        // 批量创建材料记录
        await client.caseMaterials.createMany({
            data: createData,
        })
    } catch (error) {
        logger.error('批量添加案件材料失败：', error)
        throw error
    }
}

/**
 * 查询案件材料
 * 
 * @param caseId 案件 ID
 * @param tx 事务对象（可选）
 * @returns 材料列表
 */
export const findByCaseIdDAO = async (
    caseId: number,
    tx?: Prisma.TransactionClient
): Promise<caseMaterials[]> => {
    const client = tx || prisma
    try {
        const materials = await client.caseMaterials.findMany({
            where: {
                caseId,
                deletedAt: null,
            },
            orderBy: {
                createdAt: 'asc',
            },
        })
        return materials
    } catch (error) {
        logger.error('查询案件材料失败：', error)
        throw error
    }
}

/**
 * 更新材料向量化状态
 * 
 * @param materialId 材料 ID
 * @param status 向量化状态
 * @param tx 事务对象（可选）
 */
export const updateMaterialEmbeddingStatusDAO = async (
    materialId: number,
    status: 'pending' | 'processing' | 'completed' | 'failed',
    tx?: Prisma.TransactionClient
): Promise<void> => {
    const client = tx || prisma
    try {
        await client.caseMaterials.update({
            where: { id: materialId },
            data: { embeddingStatus: status },
        })
    } catch (error) {
        logger.error('更新材料向量化状态失败：', error)
        throw error
    }
}

/**
 * 根据 ID 查询材料
 * 
 * @param materialId 材料 ID
 * @param tx 事务对象（可选）
 * @returns 材料记录或 null
 */
export const findMaterialByIdDAO = async (
    materialId: number,
    tx?: Prisma.TransactionClient
): Promise<caseMaterials | null> => {
    const client = tx || prisma
    try {
        const material = await client.caseMaterials.findUnique({
            where: {
                id: materialId,
                deletedAt: null,
            },
        })
        return material
    } catch (error) {
        logger.error('查询材料失败：', error)
        throw error
    }
}

/**
 * 根据 OSS 文件 ID 查询材料
 * 
 * @param ossFileId OSS 文件 ID
 * @param tx 事务对象（可选）
 * @returns 材料记录列表
 */
export const findMaterialsByOssFileIdDAO = async (
    ossFileId: number,
    tx?: Prisma.TransactionClient
): Promise<caseMaterials[]> => {
    const client = tx || prisma
    try {
        const materials = await client.caseMaterials.findMany({
            where: {
                ossFileId,
                deletedAt: null,
            },
        })
        return materials
    } catch (error) {
        logger.error('根据 OSS 文件 ID 查询材料失败：', error)
        throw error
    }
}
