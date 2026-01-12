/**
 * MinerU Token DAO 层
 *
 * 提供 MinerU API Token 的数据访问功能
 * Requirements: 3.1.1.1-3.1.1.7
 */

import type { mineruTokens } from '~~/generated/prisma/client'
import { MineruTokenStatus, type CreateMineruTokenInput, type UpdateMineruTokenInput, type MineruTokenListParams } from './mineruToken.service'

/**
 * 创建 MinerU Token
 */
export const createMineruTokenDao = async (data: CreateMineruTokenInput): Promise<mineruTokens> => {
    try {
        const token = await prisma.mineruTokens.create({
            data: {
                name: data.name,
                token: data.token,
                remark: data.remark,
                status: data.status ?? MineruTokenStatus.ENABLED,
            },
        })
        return token
    } catch (error) {
        logger.error('创建 MinerU Token 失败：', error)
        throw error
    }
}

/**
 * 通过 ID 查询 MinerU Token
 */
export const findMineruTokenByIdDao = async (id: number): Promise<mineruTokens | null> => {
    try {
        const token = await prisma.mineruTokens.findFirst({
            where: { id, deletedAt: null },
        })
        return token
    } catch (error) {
        logger.error('通过 ID 查询 MinerU Token 失败：', error)
        throw error
    }
}

/**
 * 通过名称查询 MinerU Token
 */
export const findMineruTokenByNameDao = async (name: string): Promise<mineruTokens | null> => {
    try {
        const token = await prisma.mineruTokens.findFirst({
            where: { name, deletedAt: null },
        })
        return token
    } catch (error) {
        logger.error('通过名称查询 MinerU Token 失败：', error)
        throw error
    }
}

/**
 * 查询 MinerU Token 列表（分页）
 */
export const findManyMineruTokensDao = async (
    options: MineruTokenListParams = {}
): Promise<{ list: mineruTokens[]; total: number }> => {
    const {
        page = 1,
        pageSize = 20,
        status,
        keyword,
        orderBy = 'createdAt',
        orderDir = 'desc',
    } = options

    try {
        const where: any = { deletedAt: null }

        if (status !== undefined) {
            where.status = status
        }

        if (keyword) {
            where.OR = [
                { name: { contains: keyword, mode: 'insensitive' } },
                { remark: { contains: keyword, mode: 'insensitive' } },
            ]
        }

        const [list, total] = await Promise.all([
            prisma.mineruTokens.findMany({
                where,
                skip: (page - 1) * pageSize,
                take: pageSize,
                orderBy: { [orderBy]: orderDir },
            }),
            prisma.mineruTokens.count({ where }),
        ])

        return { list, total }
    } catch (error) {
        logger.error('查询 MinerU Token 列表失败：', error)
        throw error
    }
}

/**
 * 获取当前启用的 Token
 * 如果有多个启用的 Token，返回最新创建的一个
 */
export const findActiveTokenDao = async (): Promise<mineruTokens | null> => {
    try {
        const token = await prisma.mineruTokens.findFirst({
            where: {
                deletedAt: null,
                status: MineruTokenStatus.ENABLED,
            },
            orderBy: { createdAt: 'desc' },
        })
        return token
    } catch (error) {
        logger.error('获取启用的 MinerU Token 失败：', error)
        throw error
    }
}

/**
 * 更新 MinerU Token
 */
export const updateMineruTokenDao = async (
    id: number,
    data: UpdateMineruTokenInput
): Promise<mineruTokens> => {
    try {
        const token = await prisma.mineruTokens.update({
            where: { id },
            data: {
                ...data,
                updatedAt: new Date(),
            },
        })
        return token
    } catch (error) {
        logger.error('更新 MinerU Token 失败：', error)
        throw error
    }
}

/**
 * 软删除 MinerU Token
 */
export const softDeleteMineruTokenDao = async (id: number): Promise<void> => {
    try {
        await prisma.mineruTokens.update({
            where: { id },
            data: { deletedAt: new Date() },
        })
    } catch (error) {
        logger.error('删除 MinerU Token 失败：', error)
        throw error
    }
}
