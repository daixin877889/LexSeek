/**
 * 材料 DAO 层
 *
 * 提供案件材料的数据访问功能
 * Requirements: 3.1, 3.2
 */

import type { caseMaterials, Prisma } from '~~/generated/prisma/client'
import type { CreateMaterialInput, UpdateMaterialInput, MaterialQueryOptions } from '#shared/types/material'
import { MaterialStatus } from '#shared/types/material'

/**
 * 创建材料
 */
export const createMaterialDao = async (
    data: CreateMaterialInput,
    tx?: Prisma.TransactionClient
): Promise<caseMaterials> => {
    try {
        const material = await (tx || prisma).caseMaterials.create({
            data: {
                caseId: data.caseId,
                name: data.name,
                type: data.type,
                ossFileId: data.ossFileId ?? null,
                isEncrypted: data.isEncrypted ?? false,
                status: data.status ?? MaterialStatus.PENDING,
            },
        })
        return material
    } catch (error) {
        logger.error('创建材料失败：', error)
        throw error
    }
}

/**
 * 通过 ID 查询材料
 */
export const findMaterialByIdDao = async (
    id: number,
    tx?: Prisma.TransactionClient
): Promise<caseMaterials | null> => {
    try {
        const material = await (tx || prisma).caseMaterials.findFirst({
            where: { id, deletedAt: null },
        })
        return material
    } catch (error) {
        logger.error('通过 ID 查询材料失败：', error)
        throw error
    }
}

/**
 * 查询材料列表（分页）
 */
export const findManyMaterialsDao = async (
    options: MaterialQueryOptions = {},
    tx?: Prisma.TransactionClient
): Promise<{ list: caseMaterials[]; total: number }> => {
    const {
        page = 1,
        pageSize = 20,
        caseId,
        type,
        status,
        orderBy = 'createdAt',
        orderDir = 'desc',
    } = options

    try {
        const where: Prisma.caseMaterialsWhereInput = { deletedAt: null }

        // 案件ID筛选
        if (caseId !== undefined) {
            where.caseId = caseId
        }

        // 类型筛选
        if (type !== undefined) {
            where.type = type
        }

        // 状态筛选
        if (status !== undefined) {
            where.status = status
        }

        const [list, total] = await Promise.all([
            (tx || prisma).caseMaterials.findMany({
                where,
                skip: (page - 1) * pageSize,
                take: pageSize,
                orderBy: { [orderBy]: orderDir },
            }),
            (tx || prisma).caseMaterials.count({ where }),
        ])

        return { list, total }
    } catch (error) {
        logger.error('查询材料列表失败：', error)
        throw error
    }
}

/**
 * 通过案件ID查询所有材料
 */
export const findMaterialsByCaseIdDao = async (
    caseId: number,
    tx?: Prisma.TransactionClient
): Promise<caseMaterials[]> => {
    try {
        const materials = await (tx || prisma).caseMaterials.findMany({
            where: { caseId, deletedAt: null },
            orderBy: { createdAt: 'asc' },
        })
        return materials
    } catch (error) {
        logger.error('通过案件ID查询材料失败：', error)
        throw error
    }
}

/**
 * 通过 ID 列表查询材料
 */
export const findMaterialsByIdsDao = async (
    ids: number[],
    tx?: Prisma.TransactionClient
): Promise<caseMaterials[]> => {
    try {
        const materials = await (tx || prisma).caseMaterials.findMany({
            where: {
                id: { in: ids },
                deletedAt: null,
            },
        })
        return materials
    } catch (error) {
        logger.error('通过 ID 列表查询材料失败：', error)
        throw error
    }
}

/**
 * 更新材料
 */
export const updateMaterialDao = async (
    id: number,
    data: UpdateMaterialInput,
    tx?: Prisma.TransactionClient
): Promise<caseMaterials> => {
    try {
        // 只更新 caseMaterials 表支持的字段（content/originalContent 已迁移到 textContentRecords）
        const updateData: Prisma.caseMaterialsUpdateInput = {
            updatedAt: new Date(),
        }
        if (data.name !== undefined) updateData.name = data.name
        if (data.status !== undefined) updateData.status = data.status

        const material = await (tx || prisma).caseMaterials.update({
            where: { id },
            data: updateData,
        })
        return material
    } catch (error) {
        logger.error('更新材料失败：', error)
        throw error
    }
}

/**
 * 软删除材料
 */
export const deleteMaterialDao = async (
    id: number,
    tx?: Prisma.TransactionClient
): Promise<caseMaterials> => {
    try {
        const material = await (tx || prisma).caseMaterials.update({
            where: { id },
            data: {
                deletedAt: new Date(),
                updatedAt: new Date(),
            },
        })
        return material
    } catch (error) {
        logger.error('删除材料失败：', error)
        throw error
    }
}

/**
 * 批量更新材料的 embedding 状态
 *
 * 统一处理动态导入和错误，避免在多个服务中重复代码
 * @param ossFileId OSS 文件 ID
 * @param status embedding 状态：'completed' | 'failed' | 'pending'
 * @param tx 事务对象（可选）
 */
export const batchUpdateMaterialEmbeddingStatus = async (
    ossFileId: number,
    status: 'completed' | 'failed' | 'pending',
    tx?: Prisma.TransactionClient
): Promise<void> => {
    try {
        const { batchUpdateMaterialEmbeddingStatusByOssFileIdDAO } = await import('../case/caseMaterial.dao')
        await batchUpdateMaterialEmbeddingStatusByOssFileIdDAO(ossFileId, status, tx)
        logger.info(`批量更新材料 embedding_status 为 ${status}: ossFileId=${ossFileId}`)
    } catch (error: any) {
        logger.warn('批量更新 case_materials embedding_status 失败', {
            ossFileId,
            error: error.message,
        })
    }
}
