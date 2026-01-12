/**
 * 积分消耗项目服务层
 *
 * 提供积分消耗项目的业务逻辑封装
 * Requirements: 17.1-17.9
 */

import type { pointConsumptionItems } from '~~/generated/prisma/client'
import { PointConsumptionItemStatus } from '#shared/types/point.types'
import {
    findPointConsumptionItemByIdDao,
    findEnabledPointConsumptionItemsDao,
} from './pointConsumptionItems.dao'

/** 创建积分消耗项目输入 */
export interface CreatePointConsumptionItemInput {
    key: string
    group: string
    name: string
    description?: string | null
    unit: string
    pointAmount: number
    discount?: number
    status?: number
}

/** 更新积分消耗项目输入 */
export interface UpdatePointConsumptionItemInput {
    group?: string
    name?: string
    description?: string | null
    unit?: string
    pointAmount?: number
    discount?: number
    status?: number
}

/** 积分消耗项目列表查询参数 */
export interface PointConsumptionItemListParams {
    page?: number
    pageSize?: number
    group?: string
    status?: number
    keyword?: string
    orderBy?: 'id' | 'name' | 'pointAmount' | 'createdAt'
    orderDir?: 'asc' | 'desc'
}

// ==================== DAO 扩展 ====================

/**
 * 创建积分消耗项目
 */
const createPointConsumptionItemDao = async (
    data: CreatePointConsumptionItemInput
): Promise<pointConsumptionItems> => {
    try {
        const item = await prisma.pointConsumptionItems.create({
            data: {
                key: data.key,
                group: data.group,
                name: data.name,
                description: data.description,
                unit: data.unit,
                pointAmount: data.pointAmount,
                discount: data.discount ?? 1,
                status: data.status ?? PointConsumptionItemStatus.ENABLED,
            },
        })
        return item
    } catch (error) {
        logger.error('创建积分消耗项目失败：', error)
        throw error
    }
}

/**
 * 通过名称查询积分消耗项目
 */
const findPointConsumptionItemByNameDao = async (
    name: string
): Promise<pointConsumptionItems | null> => {
    try {
        const item = await prisma.pointConsumptionItems.findFirst({
            where: { name, deletedAt: null },
        })
        return item
    } catch (error) {
        logger.error('通过名称查询积分消耗项目失败：', error)
        throw error
    }
}

/**
 * 通过 Key 查询积分消耗项目
 */
const findPointConsumptionItemByKeyDao = async (
    key: string
): Promise<pointConsumptionItems | null> => {
    try {
        const item = await prisma.pointConsumptionItems.findFirst({
            where: { key, deletedAt: null },
        })
        return item
    } catch (error) {
        logger.error('通过 Key 查询积分消耗项目失败：', error)
        throw error
    }
}

/**
 * 查询积分消耗项目列表（分页）
 */
const findManyPointConsumptionItemsDao = async (
    options: PointConsumptionItemListParams = {}
): Promise<{ list: pointConsumptionItems[]; total: number }> => {
    const {
        page = 1,
        pageSize = 20,
        group,
        status,
        keyword,
        orderBy = 'id',
        orderDir = 'asc',
    } = options

    try {
        const where: any = { deletedAt: null }

        if (group) {
            where.group = group
        }

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
            prisma.pointConsumptionItems.findMany({
                where,
                skip: (page - 1) * pageSize,
                take: pageSize,
                orderBy: { [orderBy]: orderDir },
            }),
            prisma.pointConsumptionItems.count({ where }),
        ])

        return { list, total }
    } catch (error) {
        logger.error('查询积分消耗项目列表失败：', error)
        throw error
    }
}

/**
 * 更新积分消耗项目
 */
const updatePointConsumptionItemDao = async (
    id: number,
    data: UpdatePointConsumptionItemInput
): Promise<pointConsumptionItems> => {
    try {
        const item = await prisma.pointConsumptionItems.update({
            where: { id },
            data: {
                ...data,
                updatedAt: new Date(),
            },
        })
        return item
    } catch (error) {
        logger.error('更新积分消耗项目失败：', error)
        throw error
    }
}

/**
 * 软删除积分消耗项目
 */
const softDeletePointConsumptionItemDao = async (id: number): Promise<void> => {
    try {
        await prisma.pointConsumptionItems.update({
            where: { id },
            data: { deletedAt: new Date() },
        })
    } catch (error) {
        logger.error('删除积分消耗项目失败：', error)
        throw error
    }
}

/**
 * 获取所有分组
 */
const findAllGroupsDao = async (): Promise<string[]> => {
    try {
        const groups = await prisma.pointConsumptionItems.findMany({
            where: { deletedAt: null },
            select: { group: true },
            distinct: ['group'],
            orderBy: { group: 'asc' },
        })
        return groups.map((g) => g.group)
    } catch (error) {
        logger.error('获取积分消耗项目分组失败：', error)
        throw error
    }
}

// ==================== 服务层 ====================

/**
 * 创建积分消耗项目
 * Requirements: 17.4
 */
export const createPointConsumptionItemService = async (
    data: CreatePointConsumptionItemInput
): Promise<pointConsumptionItems> => {
    // 检查名称是否已存在
    const existing = await findPointConsumptionItemByNameDao(data.name)
    if (existing) {
        throw new Error('积分消耗项目名称已存在')
    }

    // 检查 Key 是否已存在
    const keyExists = await findPointConsumptionItemByKeyDao(data.key)
    if (keyExists) {
        throw new Error('积分消耗项目 Key 已存在')
    }

    // 验证折扣值
    if (data.discount !== undefined && (data.discount < 0 || data.discount > 1)) {
        throw new Error('折扣值必须在 0-1 之间')
    }

    return await createPointConsumptionItemDao(data)
}

/**
 * 获取积分消耗项目详情
 */
export const getPointConsumptionItemByIdService = async (
    id: number
): Promise<pointConsumptionItems | null> => {
    return await findPointConsumptionItemByIdDao(id)
}

/**
 * 获取积分消耗项目列表（分页）
 * Requirements: 17.1, 17.2, 17.3
 */
export const getPointConsumptionItemsService = async (
    options: PointConsumptionItemListParams = {}
): Promise<{ list: pointConsumptionItems[]; total: number }> => {
    return await findManyPointConsumptionItemsDao(options)
}

/**
 * 获取启用的积分消耗项目列表
 */
export const getEnabledPointConsumptionItemsService = async (): Promise<
    pointConsumptionItems[]
> => {
    return await findEnabledPointConsumptionItemsDao()
}

/**
 * 更新积分消耗项目
 * Requirements: 17.5
 */
export const updatePointConsumptionItemService = async (
    id: number,
    data: UpdatePointConsumptionItemInput
): Promise<pointConsumptionItems> => {
    // 检查项目是否存在
    const existing = await findPointConsumptionItemByIdDao(id)
    if (!existing) {
        throw new Error('积分消耗项目不存在')
    }

    // 如果更新名称，检查名称是否已存在
    if (data.name && data.name !== existing.name) {
        const nameExists = await findPointConsumptionItemByNameDao(data.name)
        if (nameExists) {
            throw new Error('积分消耗项目名称已存在')
        }
    }

    // 验证折扣值
    if (data.discount !== undefined && (data.discount < 0 || data.discount > 1)) {
        throw new Error('折扣值必须在 0-1 之间')
    }

    return await updatePointConsumptionItemDao(id, data)
}

/**
 * 更新积分消耗项目状态
 * Requirements: 17.7
 */
export const updatePointConsumptionItemStatusService = async (
    id: number,
    status: number
): Promise<pointConsumptionItems> => {
    // 检查项目是否存在
    const existing = await findPointConsumptionItemByIdDao(id)
    if (!existing) {
        throw new Error('积分消耗项目不存在')
    }

    return await updatePointConsumptionItemDao(id, { status })
}

/**
 * 删除积分消耗项目（软删除）
 */
export const deletePointConsumptionItemService = async (id: number): Promise<void> => {
    // 检查项目是否存在
    const existing = await findPointConsumptionItemByIdDao(id)
    if (!existing) {
        throw new Error('积分消耗项目不存在')
    }

    await softDeletePointConsumptionItemDao(id)
}

/**
 * 获取所有分组
 * Requirements: 17.3
 */
export const getAllGroupsService = async (): Promise<string[]> => {
    return await findAllGroupsDao()
}
