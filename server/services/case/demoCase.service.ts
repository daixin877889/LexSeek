/**
 * 示范案例服务层
 *
 * 提供示范案例的业务逻辑封装
 * Requirements: 18.7, 18.8, 18.9, 18.10
 */

import type { demoCases } from '~~/generated/prisma/client'

/** 示范案例状态枚举 */
export enum DemoCaseStatus {
    /** 禁用 */
    DISABLED = 0,
    /** 启用 */
    ENABLED = 1,
}

/** 预设材料项 */
export interface DemoCaseMaterial {
    /** 材料名称 */
    name: string
    /** 材料类型：1-文本，2-文档，3-图片，4-音频 */
    type: number
    /** 材料内容（文本类型时使用） */
    content?: string
    /** OSS 文件 URL（文件类型时使用） */
    fileUrl?: string
}

/** 创建示范案例输入 */
export interface CreateDemoCaseInput {
    title: string
    description?: string | null
    caseTypeId: number
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

// ==================== DAO 层 ====================

/**
 * 创建示范案例
 */
const createDemoCaseDao = async (data: CreateDemoCaseInput): Promise<demoCases> => {
    try {
        const demoCase = await prisma.demoCases.create({
            data: {
                title: data.title,
                description: data.description,
                caseTypeId: data.caseTypeId,
                materials: data.materials ?? [],
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
 */
const findDemoCaseByIdDao = async (id: number): Promise<demoCases | null> => {
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
 */
const findDemoCaseByTitleDao = async (title: string): Promise<demoCases | null> => {
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
 */
const findManyDemoCasesDao = async (
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
 */
const findEnabledDemoCasesDao = async (
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
 */
const updateDemoCaseDao = async (
    id: number,
    data: UpdateDemoCaseInput
): Promise<demoCases> => {
    try {
        const demoCase = await prisma.demoCases.update({
            where: { id },
            data: {
                ...data,
                updatedAt: new Date(),
            },
        })
        return demoCase
    } catch (error) {
        logger.error('更新示范案例失败：', error)
        throw error
    }
}

/**
 * 软删除示范案例
 */
const softDeleteDemoCaseDao = async (id: number): Promise<void> => {
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


// ==================== 服务层 ====================

/**
 * 创建示范案例
 * Requirements: 18.8
 */
export const createDemoCaseService = async (
    data: CreateDemoCaseInput
): Promise<demoCases> => {
    // 检查标题是否已存在
    const existing = await findDemoCaseByTitleDao(data.title)
    if (existing) {
        throw new Error('示范案例标题已存在')
    }

    return await createDemoCaseDao(data)
}

/**
 * 获取示范案例详情
 */
export const getDemoCaseByIdService = async (
    id: number
): Promise<demoCases | null> => {
    return await findDemoCaseByIdDao(id)
}

/**
 * 获取示范案例列表（分页，后台管理用）
 * Requirements: 18.7
 */
export const getDemoCasesService = async (
    options: DemoCaseListParams = {}
): Promise<{ list: demoCases[]; total: number }> => {
    return await findManyDemoCasesDao(options)
}

/**
 * 获取启用的示范案例列表（前台展示用）
 * Requirements: 18.1, 18.2
 */
export const getEnabledDemoCasesService = async (
    caseTypeId?: number
): Promise<demoCases[]> => {
    return await findEnabledDemoCasesDao(caseTypeId)
}

/**
 * 更新示范案例
 * Requirements: 18.9
 */
export const updateDemoCaseService = async (
    id: number,
    data: UpdateDemoCaseInput
): Promise<demoCases> => {
    // 检查案例是否存在
    const existing = await findDemoCaseByIdDao(id)
    if (!existing) {
        throw new Error('示范案例不存在')
    }

    // 如果更新标题，检查标题是否已存在
    if (data.title && data.title !== existing.title) {
        const titleExists = await findDemoCaseByTitleDao(data.title)
        if (titleExists) {
            throw new Error('示范案例标题已存在')
        }
    }

    return await updateDemoCaseDao(id, data)
}

/**
 * 更新示范案例状态
 * Requirements: 18.10
 */
export const updateDemoCaseStatusService = async (
    id: number,
    status: number
): Promise<demoCases> => {
    // 检查案例是否存在
    const existing = await findDemoCaseByIdDao(id)
    if (!existing) {
        throw new Error('示范案例不存在')
    }

    return await updateDemoCaseDao(id, { status })
}

/**
 * 删除示范案例（软删除）
 */
export const deleteDemoCaseService = async (id: number): Promise<void> => {
    // 检查案例是否存在
    const existing = await findDemoCaseByIdDao(id)
    if (!existing) {
        throw new Error('示范案例不存在')
    }

    await softDeleteDemoCaseDao(id)
}
