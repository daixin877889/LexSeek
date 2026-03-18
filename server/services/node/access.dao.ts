/**
 * 会员节点权限数据访问层
 *
 * 封装所有与会员节点权限相关的数据库操作
 * Requirements: 14.15, 14.16, 14.17, 14.18, 14.19
 */

import type { levelNodeAccess, Prisma } from '~~/generated/prisma/client'

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

// ==================== 查询操作 ====================

/**
 * 通过 ID 查询权限记录
 * @param id 权限记录 ID
 * @param tx 事务客户端（可选）
 * @returns 权限记录或 null
 */
export const findAccessByIdDao = async (
    id: number,
    tx?: PrismaClient
): Promise<levelNodeAccess | null> => {
    try {
        return await (tx || prisma).levelNodeAccess.findFirst({
            where: {
                id,
                deletedAt: null,
            },
        })
    } catch (error) {
        logger.error('通过 ID 查询权限记录失败：', error)
        throw error
    }
}

/**
 * 通过会员级别ID和节点ID查询权限记录
 * @param levelId 会员级别 ID
 * @param nodeId 节点 ID
 * @param tx 事务客户端（可选）
 * @returns 权限记录或 null
 */
export const findAccessByLevelAndNodeDao = async (
    levelId: number,
    nodeId: number,
    tx?: PrismaClient
): Promise<levelNodeAccess | null> => {
    try {
        return await (tx || prisma).levelNodeAccess.findFirst({
            where: {
                levelId,
                nodeId,
                deletedAt: null,
            },
        })
    } catch (error) {
        logger.error('通过会员级别和节点查询权限记录失败：', error)
        throw error
    }
}

/**
 * 获取会员级别的所有节点权限
 * Requirements: 14.15
 * @param levelId 会员级别 ID
 * @param tx 事务客户端（可选）
 * @returns 权限记录列表
 */
export const findAccessByLevelIdDao = async (
    levelId: number,
    tx?: PrismaClient
): Promise<levelNodeAccess[]> => {
    try {
        return await (tx || prisma).levelNodeAccess.findMany({
            where: {
                levelId,
                deletedAt: null,
            },
            include: {
                node: {
                    select: {
                        id: true,
                        name: true,
                        title: true,
                        type: true,
                        status: true,
                    },
                },
            },
        })
    } catch (error) {
        logger.error('获取会员级别节点权限失败：', error)
        throw error
    }
}

/**
 * 获取节点的所有会员级别权限
 * @param nodeId 节点 ID
 * @param tx 事务客户端（可选）
 * @returns 权限记录列表
 */
export const findAccessByNodeIdDao = async (
    nodeId: number,
    tx?: PrismaClient
): Promise<levelNodeAccess[]> => {
    try {
        return await (tx || prisma).levelNodeAccess.findMany({
            where: {
                nodeId,
                deletedAt: null,
            },
            include: {
                level: {
                    select: {
                        id: true,
                        name: true,
                        sortOrder: true,
                    },
                },
            },
        })
    } catch (error) {
        logger.error('获取节点会员级别权限失败：', error)
        throw error
    }
}

/**
 * 获取权限矩阵（所有会员级别与节点的权限关系）
 * Requirements: 14.15
 * @param tx 事务客户端（可选）
 * @returns 权限记录列表
 */
export const findAllAccessMatrixDao = async (
    tx?: PrismaClient
): Promise<levelNodeAccess[]> => {
    try {
        return await (tx || prisma).levelNodeAccess.findMany({
            where: {
                deletedAt: null,
            },
            include: {
                level: {
                    select: {
                        id: true,
                        name: true,
                        sortOrder: true,
                    },
                },
                node: {
                    select: {
                        id: true,
                        name: true,
                        title: true,
                        type: true,
                        status: true,
                        groupId: true,
                    },
                },
            },
        })
    } catch (error) {
        logger.error('获取权限矩阵失败：', error)
        throw error
    }
}

// ==================== 创建操作 ====================

/**
 * 创建权限记录
 * Requirements: 14.16
 * @param data 权限创建数据
 * @param tx 事务客户端（可选）
 * @returns 创建的权限记录
 */
export const createAccessDao = async (
    data: { levelId: number; nodeId: number },
    tx?: PrismaClient
): Promise<levelNodeAccess> => {
    try {
        return await (tx || prisma).levelNodeAccess.create({
            data: {
                levelId: data.levelId,
                nodeId: data.nodeId,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
    } catch (error) {
        logger.error('创建权限记录失败：', error)
        throw error
    }
}

/**
 * 批量创建权限记录
 * @param records 权限记录列表
 * @param tx 事务客户端（可选）
 * @returns 创建的记录数量
 */
export const createManyAccessDao = async (
    records: { levelId: number; nodeId: number }[],
    tx?: PrismaClient
): Promise<number> => {
    try {
        const result = await (tx || prisma).levelNodeAccess.createMany({
            data: records.map((r) => ({
                levelId: r.levelId,
                nodeId: r.nodeId,
                createdAt: new Date(),
                updatedAt: new Date(),
            })),
            skipDuplicates: true,
        })
        return result.count
    } catch (error) {
        logger.error('批量创建权限记录失败：', error)
        throw error
    }
}

// ==================== 更新操作 ====================

/**
 * 恢复已软删除的权限记录
 * @param id 权限记录 ID
 * @param tx 事务客户端（可选）
 * @returns 更新后的权限记录
 */
export const restoreAccessDao = async (
    id: number,
    tx?: PrismaClient
): Promise<levelNodeAccess> => {
    try {
        return await (tx || prisma).levelNodeAccess.update({
            where: { id },
            data: {
                deletedAt: null,
                updatedAt: new Date(),
            },
        })
    } catch (error) {
        logger.error('恢复权限记录失败：', error)
        throw error
    }
}

// ==================== 删除操作 ====================

/**
 * 软删除权限记录
 * Requirements: 14.17
 * @param id 权限记录 ID
 * @param tx 事务客户端（可选）
 */
export const softDeleteAccessDao = async (
    id: number,
    tx?: PrismaClient
): Promise<void> => {
    try {
        await (tx || prisma).levelNodeAccess.update({
            where: { id },
            data: {
                deletedAt: new Date(),
                updatedAt: new Date(),
            },
        })
    } catch (error) {
        logger.error('软删除权限记录失败：', error)
        throw error
    }
}

/**
 * 通过会员级别ID和节点ID软删除权限记录
 * @param levelId 会员级别 ID
 * @param nodeId 节点 ID
 * @param tx 事务客户端（可选）
 */
export const softDeleteAccessByLevelAndNodeDao = async (
    levelId: number,
    nodeId: number,
    tx?: PrismaClient
): Promise<void> => {
    try {
        await (tx || prisma).levelNodeAccess.updateMany({
            where: {
                levelId,
                nodeId,
                deletedAt: null,
            },
            data: {
                deletedAt: new Date(),
                updatedAt: new Date(),
            },
        })
    } catch (error) {
        logger.error('通过会员级别和节点软删除权限记录失败：', error)
        throw error
    }
}

/**
 * 批量软删除会员级别的多个节点权限
 * @param levelId 会员级别 ID
 * @param nodeIds 节点 ID 列表
 * @param tx 事务客户端（可选）
 */
export const softDeleteAccessByLevelAndNodesDao = async (
    levelId: number,
    nodeIds: number[],
    tx?: PrismaClient
): Promise<void> => {
    try {
        await (tx || prisma).levelNodeAccess.updateMany({
            where: {
                levelId,
                nodeId: { in: nodeIds },
                deletedAt: null,
            },
            data: {
                deletedAt: new Date(),
                updatedAt: new Date(),
            },
        })
    } catch (error) {
        logger.error('批量软删除权限记录失败：', error)
        throw error
    }
}

/**
 * 批量软删除会员级别的所有权限
 * @param levelId 会员级别 ID
 * @param tx 事务客户端（可选）
 */
export const softDeleteAccessByLevelIdDao = async (
    levelId: number,
    tx?: PrismaClient
): Promise<void> => {
    try {
        await (tx || prisma).levelNodeAccess.updateMany({
            where: {
                levelId,
                deletedAt: null,
            },
            data: {
                deletedAt: new Date(),
                updatedAt: new Date(),
            },
        })
    } catch (error) {
        logger.error('批量软删除会员级别权限失败：', error)
        throw error
    }
}

/**
 * 查找已软删除的权限记录（用于恢复）
 * @param levelId 会员级别 ID
 * @param nodeId 节点 ID
 * @param tx 事务客户端（可选）
 * @returns 已删除的权限记录或 null
 */
export const findDeletedAccessDao = async (
    levelId: number,
    nodeId: number,
    tx?: PrismaClient
): Promise<levelNodeAccess | null> => {
    try {
        return await (tx || prisma).levelNodeAccess.findFirst({
            where: {
                levelId,
                nodeId,
                deletedAt: { not: null },
            },
        })
    } catch (error) {
        logger.error('查找已删除权限记录失败：', error)
        throw error
    }
}
