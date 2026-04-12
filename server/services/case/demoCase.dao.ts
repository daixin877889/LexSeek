/**
 * 示范案例数据访问层
 *
 * 提供示范案例的 CRUD 操作
 */

import type { demoCases } from '~~/generated/prisma/client'

/** 示范案例状态枚举 */
export enum DemoCaseStatus {
    /** 禁用 */
    DISABLED = 0,
    /** 启用 */
    ENABLED = 1,
}

/** 预设文件材料项（文本内容已提升到 demoCases.content 顶级字段） */
export interface DemoCaseMaterial {
    /** 材料名称（展示用） */
    name: string
    /** 材料类型：2-文档，3-图片，4-音频（文本 type=1 已废弃） */
    type: 2 | 3 | 4
    /** admin 上传得到的 ossFile.id */
    sourceOssFileId: number
}

/** 创建示范案例输入 */
export interface CreateDemoCaseInput {
    title: string
    description?: string | null
    caseTypeId: number
    content?: string | null
    materials?: DemoCaseMaterial[]
    coverImage?: string | null
    priority?: number
    status?: number
}

/** 更新示范案例输入 */
export interface UpdateDemoCaseInput {
    title?: string
    description?: string | null
    caseTypeId?: number
    content?: string | null
    materials?: DemoCaseMaterial[]
    coverImage?: string | null
    priority?: number
    status?: number
}

/** 示范案例列表查询参数 */
export interface DemoCaseListParams {
    page?: number
    pageSize?: number
    caseTypeId?: number
    status?: number
    keyword?: string
    orderBy?: 'id' | 'title' | 'priority' | 'createdAt'
    orderDir?: 'asc' | 'desc'
}

/**
 * 创建示范案例
 * @param data 创建数据
 * @returns 创建的示范案例
 */
export const createDemoCaseDao = async (data: CreateDemoCaseInput): Promise<demoCases> => {
    try {
        const demoCase = await prisma.demoCases.create({
            data: {
                title: data.title,
                description: data.description,
                caseTypeId: data.caseTypeId,
                content: data.content ?? null,
                materials: (data.materials ?? []) as any,
                coverImage: data.coverImage,
                priority: data.priority ?? 100,
                status: data.status ?? DemoCaseStatus.ENABLED,
            },
        })
        return demoCase
    } catch (error) {
        logger.error('创建示范案例失败：', error)
        throw error
    }
}


/**
 * 通过 ID 查询示范案例
 * @param id 示范案例 ID
 * @returns 示范案例或 null
 */
export const findDemoCaseByIdDao = async (id: number): Promise<demoCases | null> => {
    try {
        const demoCase = await prisma.demoCases.findFirst({
            where: { id, deletedAt: null },
        })
        return demoCase
    } catch (error) {
        logger.error('通过 ID 查询示范案例失败：', error)
        throw error
    }
}

/**
 * 通过标题查询示范案例
 * @param title 示范案例标题
 * @returns 示范案例或 null
 */
export const findDemoCaseByTitleDao = async (title: string): Promise<demoCases | null> => {
    try {
        const demoCase = await prisma.demoCases.findFirst({
            where: { title, deletedAt: null },
        })
        return demoCase
    } catch (error) {
        logger.error('通过标题查询示范案例失败：', error)
        throw error
    }
}

/**
 * 查询示范案例列表（分页）
 * @param options 查询参数
 * @returns 示范案例列表和总数
 */
export const findManyDemoCasesDao = async (
    options: DemoCaseListParams = {}
): Promise<{ list: demoCases[]; total: number }> => {
    const {
        page = 1,
        pageSize = 20,
        caseTypeId,
        status,
        keyword,
        orderBy = 'priority',
        orderDir = 'asc',
    } = options

    try {
        const where: any = { deletedAt: null }

        if (caseTypeId !== undefined) {
            where.caseTypeId = caseTypeId
        }

        if (status !== undefined) {
            where.status = status
        }

        if (keyword) {
            where.OR = [
                { title: { contains: keyword, mode: 'insensitive' } },
                { description: { contains: keyword, mode: 'insensitive' } },
            ]
        }

        const [list, total] = await Promise.all([
            prisma.demoCases.findMany({
                where,
                skip: (page - 1) * pageSize,
                take: pageSize,
                orderBy: { [orderBy]: orderDir },
            }),
            prisma.demoCases.count({ where }),
        ])

        return { list, total }
    } catch (error) {
        logger.error('查询示范案例列表失败：', error)
        throw error
    }
}

/**
 * 查询启用的示范案例列表（前台展示用）
 * @param caseTypeId 案件类型 ID（可选）
 * @returns 启用的示范案例列表
 */
export const findEnabledDemoCasesDao = async (
    caseTypeId?: number
): Promise<demoCases[]> => {
    try {
        const where: any = {
            deletedAt: null,
            status: DemoCaseStatus.ENABLED,
        }

        if (caseTypeId !== undefined) {
            where.caseTypeId = caseTypeId
        }

        const list = await prisma.demoCases.findMany({
            where,
            orderBy: { priority: 'asc' },
        })

        return list
    } catch (error) {
        logger.error('查询启用的示范案例列表失败：', error)
        throw error
    }
}

/**
 * 更新示范案例
 * @param id 示范案例 ID
 * @param data 更新数据
 * @returns 更新后的示范案例
 */
export const updateDemoCaseDao = async (
    id: number,
    data: UpdateDemoCaseInput
): Promise<demoCases> => {
    try {
        // 构建更新数据，处理类型兼容性
        const updateData: any = {
            updatedAt: new Date(),
        }
        if (data.title !== undefined) updateData.title = data.title
        if (data.description !== undefined) updateData.description = data.description
        if (data.caseTypeId !== undefined) updateData.caseTypeId = data.caseTypeId
        if (data.content !== undefined) updateData.content = data.content
        if (data.materials !== undefined) updateData.materials = data.materials
        if (data.coverImage !== undefined) updateData.coverImage = data.coverImage
        if (data.priority !== undefined) updateData.priority = data.priority
        if (data.status !== undefined) updateData.status = data.status

        const demoCase = await prisma.demoCases.update({
            where: { id },
            data: updateData,
        })
        return demoCase
    } catch (error) {
        logger.error('更新示范案例失败：', error)
        throw error
    }
}

/**
 * 软删除示范案例
 * @param id 示范案例 ID
 */
export const softDeleteDemoCaseDao = async (id: number): Promise<void> => {
    try {
        await prisma.demoCases.update({
            where: { id },
            data: { deletedAt: new Date() },
        })
    } catch (error) {
        logger.error('删除示范案例失败：', error)
        throw error
    }
}
