/**
 * 案件类型数据访问层
 *
 * 提供案件类型的 CRUD 操作
 */

import type { caseTypes, Prisma } from '~~/generated/prisma/client'

/** 案件类型状态枚举 */
export enum CaseTypeStatus {
    /** 禁用 */
    DISABLED = 0,
    /** 启用 */
    ENABLED = 1,
}

/** 创建案件类型输入 */
export interface CreateCaseTypeInput {
    name: string
    description?: string | null
    icon?: string | null
    priority?: number
    status?: number
}

/** 更新案件类型输入 */
export interface UpdateCaseTypeInput {
    name?: string
    description?: string | null
    icon?: string | null
    priority?: number
    status?: number
}

/** 案件类型列表查询参数 */
export interface CaseTypeListParams {
    page?: number
    pageSize?: number
    status?: number
    keyword?: string
    orderBy?: 'id' | 'name' | 'priority' | 'createdAt'
    orderDir?: 'asc' | 'desc'
}

/**
 * 创建案件类型
 * @param data 创建数据
 * @returns 创建的案件类型
 */
export const createCaseTypeDao = async (data: CreateCaseTypeInput): Promise<caseTypes> => {
    try {
        const caseType = await prisma.caseTypes.create({
            data: {
                name: data.name,
                description: data.description,
                icon: data.icon,
                priority: data.priority ?? 100,
                status: data.status ?? CaseTypeStatus.ENABLED,
            },
        })
        return caseType
    } catch (error) {
        logger.error('创建案件类型失败：', error)
        throw error
    }
}


/**
 * 通过 ID 查询案件类型
 * @param id 案件类型 ID
 * @returns 案件类型或 null
 */
export const findCaseTypeByIdDao = async (id: number): Promise<caseTypes | null> => {
    try {
        const caseType = await prisma.caseTypes.findFirst({
            where: { id, deletedAt: null },
        })
        return caseType
    } catch (error) {
        logger.error('通过 ID 查询案件类型失败：', error)
        throw error
    }
}

/**
 * 通过名称查询案件类型
 * @param name 案件类型名称
 * @returns 案件类型或 null
 */
export const findCaseTypeByNameDao = async (name: string): Promise<caseTypes | null> => {
    try {
        const caseType = await prisma.caseTypes.findFirst({
            where: { name, deletedAt: null },
        })
        return caseType
    } catch (error) {
        logger.error('通过名称查询案件类型失败：', error)
        throw error
    }
}

/**
 * 查询案件类型列表（分页）
 * @param options 查询参数
 * @returns 案件类型列表和总数
 */
export const findManyCaseTypesDao = async (
    options: CaseTypeListParams = {}
): Promise<{ list: caseTypes[]; total: number }> => {
    const {
        page = 1,
        pageSize = 20,
        status,
        keyword,
        orderBy = 'priority',
        orderDir = 'asc',
    } = options

    try {
        const where: any = { deletedAt: null }

        if (status !== undefined) {
            where.status = status
        }

        if (keyword) {
            where.OR = [
                { name: { contains: keyword, mode: 'insensitive' } },
                { description: { contains: keyword, mode: 'insensitive' } },
            ]
        }

        const [list, total] = await Promise.all([
            prisma.caseTypes.findMany({
                where,
                skip: (page - 1) * pageSize,
                take: pageSize,
                orderBy: { [orderBy]: orderDir },
            }),
            prisma.caseTypes.count({ where }),
        ])

        return { list, total }
    } catch (error) {
        logger.error('查询案件类型列表失败：', error)
        throw error
    }
}

/**
 * 查询启用的案件类型列表（前台展示用）
 * @returns 启用的案件类型列表
 */
export const findEnabledCaseTypesDao = async (): Promise<caseTypes[]> => {
    try {
        const list = await prisma.caseTypes.findMany({
            where: {
                deletedAt: null,
                status: CaseTypeStatus.ENABLED,
            },
            orderBy: { priority: 'asc' },
        })

        return list
    } catch (error) {
        logger.error('查询启用的案件类型列表失败：', error)
        throw error
    }
}

/**
 * 更新案件类型
 * @param id 案件类型 ID
 * @param data 更新数据
 * @returns 更新后的案件类型
 */
export const updateCaseTypeDao = async (
    id: number,
    data: UpdateCaseTypeInput
): Promise<caseTypes> => {
    try {
        const caseType = await prisma.caseTypes.update({
            where: { id },
            data: {
                ...data,
                updatedAt: new Date(),
            },
        })
        return caseType
    } catch (error) {
        logger.error('更新案件类型失败：', error)
        throw error
    }
}

/**
 * 软删除案件类型
 * @param id 案件类型 ID
 */
export const softDeleteCaseTypeDao = async (id: number): Promise<void> => {
    try {
        await prisma.caseTypes.update({
            where: { id },
            data: { deletedAt: new Date() },
        })
    } catch (error) {
        logger.error('删除案件类型失败：', error)
        throw error
    }
}

/**
 * 检查案件类型是否被使用
 * @param id 案件类型 ID
 * @returns 是否被使用
 */
export const checkCaseTypeInUseDao = async (id: number): Promise<boolean> => {
    try {
        // 检查是否有案件使用该类型
        const casesCount = await prisma.cases.count({
            where: { caseTypeId: id, deletedAt: null },
        })

        // 检查是否有示范案例使用该类型
        const demoCasesCount = await prisma.demoCases.count({
            where: { caseTypeId: id, deletedAt: null },
        })

        return casesCount > 0 || demoCasesCount > 0
    } catch (error) {
        logger.error('检查案件类型是否被使用失败：', error)
        throw error
    }
}
