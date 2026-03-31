/**
 * 材料服务层
 *
 * 提供案件材料的基础管理功能，包括材料保存、内容获取等
 * Requirements: 3.1, 3.2
 */

import type { caseMaterials, Prisma } from '~~/generated/prisma/client'
import {
    createMaterialDao,
    findMaterialByIdDao,
    findManyMaterialsDao,
    findMaterialsByCaseIdDao,
    findMaterialsByIdsDao,
    updateMaterialDao,
    deleteMaterialDao,
} from './material.dao'
import {
    findTextContentRecordByMaterialIdDAO,
} from './textContentRecords.dao'
import { findRecognitionRecordsByOssFileIdsDao } from './material.dao'
import type { CreateMaterialInput, UpdateMaterialInput, MaterialQueryOptions } from '#shared/types/material'
import { MaterialStatus } from '#shared/types/material'
import { CaseMaterialType } from '#shared/types/case'

/** 材料（包含文件信息） */
export interface MaterialWithFile extends caseMaterials {
    /** 文件名 */
    fileName?: string
    /** 文件大小 */
    fileSize?: number
    /** 文件类型 */
    fileType?: string
    /** 文件路径 */
    filePath?: string
}

// ==================== 服务层 ====================

/**
 * 创建材料
 * Requirements: 3.1, 3.2
 */
export const createMaterialService = async (
    data: CreateMaterialInput,
    tx?: Prisma.TransactionClient
): Promise<caseMaterials> => {
    // 验证案件是否存在
    const caseExists = await (tx || prisma).cases.findFirst({
        where: { id: data.caseId, deletedAt: null },
    })
    if (!caseExists) {
        throw new Error('案件不存在')
    }

    return await createMaterialDao(data, tx)
}

/**
 * 获取材料详情
 */
export const getMaterialByIdService = async (
    id: number
): Promise<MaterialWithFile | null> => {
    const material = await findMaterialByIdDao(id)
    if (!material) {
        return null
    }

    // 如果有关联的 OSS 文件，获取文件信息
    if (material.ossFileId) {
        const ossFile = await prisma.ossFiles.findFirst({
            where: { id: material.ossFileId, deletedAt: null },
            select: { fileName: true, fileSize: true, fileType: true, filePath: true },
        })

        return {
            ...material,
            fileName: ossFile?.fileName,
            fileSize: ossFile?.fileSize ? Number(ossFile.fileSize) : undefined,
            fileType: ossFile?.fileType,
            filePath: ossFile?.filePath ?? undefined,
        }
    }

    return material
}

/**
 * 获取材料列表（分页）
 */
export const getMaterialsService = async (
    options: MaterialQueryOptions = {}
): Promise<{ list: MaterialWithFile[]; total: number }> => {
    const { list, total } = await findManyMaterialsDao(options)

    // 获取所有关联的文件信息
    const ossFileIds = list
        .filter((m) => m.ossFileId !== null)
        .map((m) => m.ossFileId as number)

    let fileMap = new Map<number, { fileName: string; fileSize: number; fileType: string; filePath?: string }>()

    if (ossFileIds.length > 0) {
        const ossFiles = await prisma.ossFiles.findMany({
            where: { id: { in: ossFileIds }, deletedAt: null },
            select: { id: true, fileName: true, fileSize: true, fileType: true, filePath: true },
        })

        fileMap = new Map(
            ossFiles.map((file) => [
                file.id,
                {
                    fileName: file.fileName,
                    fileSize: Number(file.fileSize),
                    fileType: file.fileType,
                    filePath: file.filePath ?? undefined,
                },
            ])
        )
    }

    // 合并材料和文件信息
    const materialsWithFile: MaterialWithFile[] = list.map((material) => {
        const fileInfo = material.ossFileId ? fileMap.get(material.ossFileId) : undefined
        return {
            ...material,
            fileName: fileInfo?.fileName,
            fileSize: fileInfo?.fileSize,
            fileType: fileInfo?.fileType,
            filePath: fileInfo?.filePath,
        }
    })

    return { list: materialsWithFile, total }
}

/**
 * 获取案件的所有材料
 */
export const getMaterialsByCaseIdService = async (
    caseId: number
): Promise<MaterialWithFile[]> => {
    const materials = await findMaterialsByCaseIdDao(caseId)

    // 获取所有关联的文件信息
    const ossFileIds = materials
        .filter((m) => m.ossFileId !== null)
        .map((m) => m.ossFileId as number)

    let fileMap = new Map<number, { fileName: string; fileSize: number; fileType: string; filePath?: string }>()

    if (ossFileIds.length > 0) {
        const ossFiles = await prisma.ossFiles.findMany({
            where: { id: { in: ossFileIds }, deletedAt: null },
            select: { id: true, fileName: true, fileSize: true, fileType: true, filePath: true },
        })

        fileMap = new Map(
            ossFiles.map((file) => [
                file.id,
                {
                    fileName: file.fileName,
                    fileSize: Number(file.fileSize),
                    fileType: file.fileType,
                    filePath: file.filePath ?? undefined,
                },
            ])
        )
    }

    // 合并材料和文件信息
    return materials.map((material) => {
        const fileInfo = material.ossFileId ? fileMap.get(material.ossFileId) : undefined
        return {
            ...material,
            fileName: fileInfo?.fileName,
            fileSize: fileInfo?.fileSize,
            fileType: fileInfo?.fileType,
            filePath: fileInfo?.filePath,
        }
    })
}

/** 带真实状态的材料项 */
export interface MaterialWithRealStatus extends MaterialWithFile {
    /** 真实状态：1=待处理, 2=处理中, 3=已完成, 4=失败 */
    realStatus: number
}

/**
 * 获取案件的所有材料（带真实状态）
 * 状态通过关联的识别表判断，不依赖 case_materials.status
 */
export const getMaterialsByCaseIdWithStatusService = async (
    caseId: number
): Promise<MaterialWithRealStatus[]> => {
    const materials = await getMaterialsByCaseIdService(caseId)

    if (materials.length === 0) {
        return []
    }

    // 收集需要查询的 ossFileId 和 materialId
    const ossFileIds = materials
        .filter(m => m.ossFileId !== null)
        .map(m => m.ossFileId as number)

    const materialIds = materials
        .filter(m => m.type === CaseMaterialType.CASE_CONTENT)
        .map(m => m.id)

    // 并行查询各识别表
    const { docRecords, imageRecords, asrRecords, textRecords } = await findRecognitionRecordsByOssFileIdsDao(ossFileIds, materialIds)

    const docMap = new Map(docRecords.map(r => [r.ossFileId, r.status]))
    const imageMap = new Map(imageRecords.map(r => [r.ossFileId, r.status]))
    const asrMap = new Map(asrRecords.map(r => [r.ossFileId, r.status]))
    const textMap = new Map(textRecords.filter(r => r.materialId !== null).map(r => [r.materialId as number, !!r.content]))

    // 根据识别表判断真实状态
    function getRealStatus(material: MaterialWithFile): number {
        switch (material.type) {
            case CaseMaterialType.CASE_CONTENT: {
                const hasContent = textMap.get(material.id)
                return hasContent ? 3 : 1
            }
            case CaseMaterialType.DOCUMENT: {
                if (!material.ossFileId) return 1
                const status = docMap.get(material.ossFileId)
                if (status === undefined) return 1
                if (status === 2) return 3  // SUCCESS
                if (status === 1) return 2  // PROCESSING
                if (status === 3) return 4  // FAILED
                return 1
            }
            case CaseMaterialType.IMAGE: {
                if (!material.ossFileId) return 1
                const status = imageMap.get(material.ossFileId)
                if (status === undefined) return 1
                if (status === 2) return 3  // COMPLETED
                if (status === 1) return 2  // PROCESSING
                if (status === 3) return 4  // FAILED
                return 1
            }
            case CaseMaterialType.AUDIO: {
                if (!material.ossFileId) return 1
                const status = asrMap.get(material.ossFileId)
                if (status === undefined) return 1
                if (status === 2) return 3  // SUCCESS
                if (status === 1) return 2  // PROCESSING
                if (status === 3) return 4  // FAILED
                return 1
            }
            default:
                return 1
        }
    }

    return materials.map(material => ({
        ...material,
        realStatus: getRealStatus(material),
    }))
}

/**
 * 获取材料内容
 * Requirements: 3.1, 3.2
 */
export const getMaterialContentService = async (
    id: number
): Promise<string | null> => {
    const material = await findMaterialByIdDao(id)
    if (!material) {
        return null
    }

    // 从 textContentRecords 获取内容（content 已迁移到该表）
    const record = await findTextContentRecordByMaterialIdDAO(id)
    return record?.content ?? null
}

/**
 * 更新材料
 */
export const updateMaterialService = async (
    id: number,
    data: UpdateMaterialInput,
    tx?: Prisma.TransactionClient
): Promise<caseMaterials> => {
    // 检查材料是否存在
    const existing = await findMaterialByIdDao(id, tx)
    if (!existing) {
        throw new Error('材料不存在')
    }

    return await updateMaterialDao(id, data, tx)
}

/**
 * 更新材料状态
 */
export const updateMaterialStatusService = async (
    id: number,
    status: MaterialStatus,
    tx?: Prisma.TransactionClient
): Promise<caseMaterials> => {
    return await updateMaterialDao(id, { status }, tx)
}

/**
 * 更新材料状态为已完成
 * content 已迁移到 textContentRecords/docRecognitionRecords 等识别记录表
 */
export const updateMaterialContentService = async (
    id: number,
    tx?: Prisma.TransactionClient
): Promise<caseMaterials> => {
    return await updateMaterialDao(
        id,
        { status: MaterialStatus.COMPLETED },
        tx
    )
}

/**
 * 删除材料
 */
export const deleteMaterialService = async (
    id: number,
    tx?: Prisma.TransactionClient
): Promise<caseMaterials> => {
    // 检查材料是否存在
    const existing = await findMaterialByIdDao(id, tx)
    if (!existing) {
        throw new Error('材料不存在')
    }

    return await deleteMaterialDao(id, tx)
}

/**
 * 批量获取材料
 */
export const getMaterialsByIdsService = async (
    ids: number[]
): Promise<MaterialWithFile[]> => {
    const materials = await findMaterialsByIdsDao(ids)

    // 获取所有关联的文件信息
    const ossFileIds = materials
        .filter((m) => m.ossFileId !== null)
        .map((m) => m.ossFileId as number)

    let fileMap = new Map<number, { fileName: string; fileSize: number; fileType: string; filePath?: string }>()

    if (ossFileIds.length > 0) {
        const ossFiles = await prisma.ossFiles.findMany({
            where: { id: { in: ossFileIds }, deletedAt: null },
            select: { id: true, fileName: true, fileSize: true, fileType: true, filePath: true },
        })

        fileMap = new Map(
            ossFiles.map((file) => [
                file.id,
                {
                    fileName: file.fileName,
                    fileSize: Number(file.fileSize),
                    fileType: file.fileType,
                    filePath: file.filePath ?? undefined,
                },
            ])
        )
    }

    // 合并材料和文件信息
    return materials.map((material) => {
        const fileInfo = material.ossFileId ? fileMap.get(material.ossFileId) : undefined
        return {
            ...material,
            fileName: fileInfo?.fileName,
            fileSize: fileInfo?.fileSize,
            fileType: fileInfo?.fileType,
            filePath: fileInfo?.filePath,
        }
    })
}

/**
 * 获取案件已完成处理的材料内容（聚合）
 * 用于工作流中获取所有材料的文本内容
 * content 已迁移到 textContentRecords 表
 */
export const getCompletedMaterialsContentService = async (
    caseId: number
): Promise<{ materialId: number; name: string; type: CaseMaterialType; content: string }[]> => {
    // 获取已完成状态的材料
    const materials = await prisma.caseMaterials.findMany({
        where: {
            caseId,
            status: MaterialStatus.COMPLETED,
            deletedAt: null,
        },
        select: {
            id: true,
            name: true,
            type: true,
        },
        orderBy: { createdAt: 'asc' },
    })

    if (materials.length === 0) {
        return []
    }

    // 从 textContentRecords 获取内容
    const textRecords = await prisma.textContentRecords.findMany({
        where: {
            materialId: { in: materials.map(m => m.id) },
            content: { not: null },
            deletedAt: null,
        },
        select: {
            materialId: true,
            content: true,
        },
    })

    const contentMap = new Map(
        textRecords
            .filter(r => r.materialId !== null && r.content !== null)
            .map(r => [r.materialId as number, r.content as string])
    )

    return materials
        .filter(m => contentMap.has(m.id))
        .map(m => ({
            materialId: m.id,
            name: m.name,
            type: m.type as CaseMaterialType,
            content: contentMap.get(m.id) as string,
        }))
}

/**
 * 检查案件是否有待处理的材料
 */
export const hasPendingMaterialsService = async (
    caseId: number
): Promise<boolean> => {
    const count = await prisma.caseMaterials.count({
        where: {
            caseId,
            status: { in: [MaterialStatus.PENDING, MaterialStatus.PROCESSING] },
            deletedAt: null,
        },
    })
    return count > 0
}

/**
 * 获取案件材料统计
 */
export const getMaterialsStatsService = async (
    caseId: number
): Promise<{
    total: number
    pending: number
    processing: number
    completed: number
    failed: number
}> => {
    const [total, pending, processing, completed, failed] = await Promise.all([
        prisma.caseMaterials.count({
            where: { caseId, deletedAt: null },
        }),
        prisma.caseMaterials.count({
            where: { caseId, status: MaterialStatus.PENDING, deletedAt: null },
        }),
        prisma.caseMaterials.count({
            where: { caseId, status: MaterialStatus.PROCESSING, deletedAt: null },
        }),
        prisma.caseMaterials.count({
            where: { caseId, status: MaterialStatus.COMPLETED, deletedAt: null },
        }),
        prisma.caseMaterials.count({
            where: { caseId, status: MaterialStatus.FAILED, deletedAt: null },
        }),
    ])

    return { total, pending, processing, completed, failed }
}
