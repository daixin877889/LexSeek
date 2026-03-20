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
        ossFileId?: number | null
        isEncrypted?: boolean
        status?: number
    }>,
    tx?: Prisma.TransactionClient
): Promise<void> => {
    const client = tx || prisma
    try {
        const createData = materials.map(material => ({
            caseId,
            name: material.name,
            type: material.type,
            ossFileId: material.ossFileId ?? null,
            isEncrypted: material.isEncrypted ?? false,
            status: material.status ?? 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        }))
        await client.caseMaterials.createMany({ data: createData })
    } catch (error) {
        logger.error('批量添加案件材料失败：', error)
        throw error
    }
}

/**
 * 单条创建案件材料（返回创建后的记录，含 ID）
 *
 * @param caseId 案件 ID
 * @param material 材料数据
 * @param tx 事务对象（可选）
 * @returns 创建后的材料记录
 */
export const createSingleCaseMaterialDAO = async (
    caseId: number,
    material: {
        name: string
        type: number
        ossFileId?: number | null
        isEncrypted?: boolean
        status?: number
    },
    tx?: Prisma.TransactionClient
): Promise<caseMaterials> => {
    const client = tx || prisma
    try {
        return await client.caseMaterials.create({
            data: {
                caseId,
                name: material.name,
                type: material.type,
                ossFileId: material.ossFileId ?? null,
                isEncrypted: material.isEncrypted ?? false,
                status: material.status ?? 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
    } catch (error) {
        logger.error('创建单条案件材料失败：', error)
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
