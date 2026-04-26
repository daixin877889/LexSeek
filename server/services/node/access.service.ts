/**
 * 会员节点权限服务层
 *
 * 提供会员节点权限的业务逻辑封装
 * Requirements: 14.15, 14.16, 14.17, 14.18, 14.19
 */

import type { levelNodeAccess } from '~~/generated/prisma/client'
import {
    findAccessByIdDao,
    findAccessByLevelAndNodeDao,
    findAccessByLevelIdDao,
    findAccessByNodeIdDao,
    findAllAccessMatrixDao,
    createAccessDao,
    createManyAccessDao,
    softDeleteAccessDao,
    softDeleteAccessByLevelAndNodeDao,
    softDeleteAccessByLevelAndNodesDao,
    softDeleteAccessByLevelIdDao,
    findDeletedAccessDao,
    restoreAccessDao,
} from './access.dao'
import { findNodeByIdDao, findNodesByIdsDao, findAllNodesDao } from './node.dao'
import { findMembershipLevelByIdDao, findAllActiveMembershipLevelsDao } from '../membership/membershipLevel.dao'
import { findCurrentUserMembershipDao } from '../membership/userMembership.dao'
import type { nodes } from '~~/generated/prisma/client'

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

// ==================== 权限查询服务 ====================

/**
 * 获取会员级别的节点权限列表
 * Requirements: 14.15
 * @param levelId 会员级别 ID
 * @returns 权限记录列表（包含节点信息）
 */
export const getLevelNodeAccessService = async (levelId: number) => {
    // 验证会员级别是否存在
    const level = await findMembershipLevelByIdDao(levelId)
    if (!level) {
        throw new Error('会员级别不存在')
    }

    return await findAccessByLevelIdDao(levelId)
}

/**
 * 获取节点的会员级别权限列表
 * @param nodeId 节点 ID
 * @returns 权限记录列表（包含会员级别信息）
 */
export const getNodeLevelAccessService = async (nodeId: number) => {
    // 验证节点是否存在
    const node = await findNodeByIdDao(nodeId)
    if (!node) {
        throw new Error('节点不存在')
    }

    return await findAccessByNodeIdDao(nodeId)
}

/**
 * 获取权限矩阵
 * Requirements: 14.15
 * @returns 权限矩阵数据
 */
export const getAccessMatrixService = async () => {
    // 获取所有启用的会员级别
    const levels = await findAllActiveMembershipLevelsDao()

    // 获取所有启用的节点
    const nodes = await findAllNodesDao({ status: 1 })

    // 获取所有权限记录
    const accessRecords = await findAllAccessMatrixDao()

    // 构建权限矩阵映射
    const accessMap = new Map<string, boolean>()
    for (const record of accessRecords) {
        const key = `${record.levelId}-${record.nodeId}`
        accessMap.set(key, true)
    }

    // 构建矩阵数据
    const matrix = levels.map((level) => ({
        levelId: level.id,
        levelName: level.name,
        sortOrder: level.sortOrder,
        nodes: nodes.map((node) => ({
            nodeId: node.id,
            nodeName: node.name,
            nodeTitle: node.title,
            nodeType: node.type,
            hasAccess: accessMap.has(`${level.id}-${node.id}`),
        })),
    }))

    return {
        levels: levels.map((l) => ({
            id: l.id,
            name: l.name,
            sortOrder: l.sortOrder,
        })),
        nodes: nodes.map((n) => ({
            id: n.id,
            name: n.name,
            title: n.title,
            type: n.type,
            groupId: n.groupId,
        })),
        matrix,
    }
}

// ==================== 权限授予服务 ====================

/**
 * 授权会员级别访问节点
 * Requirements: 14.16
 * @param levelId 会员级别 ID
 * @param nodeId 节点 ID
 * @returns 创建的权限记录
 */
export const grantAccessService = async (
    levelId: number,
    nodeId: number
): Promise<levelNodeAccess> => {
    // 验证会员级别是否存在
    const level = await findMembershipLevelByIdDao(levelId)
    if (!level) {
        throw new Error('会员级别不存在')
    }

    // 验证节点是否存在
    const node = await findNodeByIdDao(nodeId)
    if (!node) {
        throw new Error('节点不存在')
    }

    // 检查是否已存在有效权限
    const existingAccess = await findAccessByLevelAndNodeDao(levelId, nodeId)
    if (existingAccess) {
        throw new Error('该权限已存在')
    }

    // 检查是否存在已删除的权限记录（可恢复）
    const deletedAccess = await findDeletedAccessDao(levelId, nodeId)
    if (deletedAccess) {
        // 恢复已删除的权限记录
        return await restoreAccessDao(deletedAccess.id)
    }

    // 创建新的权限记录
    return await createAccessDao({ levelId, nodeId })
}

/**
 * 批量授权会员级别访问节点
 * @param levelId 会员级别 ID
 * @param nodeIds 节点 ID 列表
 * @returns 创建的记录数量
 */
export const batchGrantAccessService = async (
    levelId: number,
    nodeIds: number[]
): Promise<number> => {
    // 验证会员级别是否存在
    const level = await findMembershipLevelByIdDao(levelId)
    if (!level) {
        throw new Error('会员级别不存在')
    }

    // 批量验证所有节点是否存在
    const nodes = await findNodesByIdsDao(nodeIds)
    if (nodes.length !== nodeIds.length) {
        const foundNodeIds = new Set(nodes.map((n) => n.id))
        const missingNodeId = nodeIds.find((id) => !foundNodeIds.has(id))
        throw new Error(`节点 ${missingNodeId} 不存在`)
    }

    // 获取当前已有的权限
    const existingAccess = await findAccessByLevelIdDao(levelId)
    const existingNodeIds = new Set(existingAccess.map((a) => a.nodeId))

    // 过滤出需要新增的节点
    const newNodeIds = nodeIds.filter((id) => !existingNodeIds.has(id))

    if (newNodeIds.length === 0) {
        return 0
    }

    // 批量创建权限记录
    const records = newNodeIds.map((nodeId) => ({ levelId, nodeId }))
    return await createManyAccessDao(records)
}

// ==================== 权限撤销服务 ====================

/**
 * 撤销会员级别节点权限
 * Requirements: 14.17
 * @param levelId 会员级别 ID
 * @param nodeId 节点 ID
 */
export const revokeAccessService = async (
    levelId: number,
    nodeId: number
): Promise<void> => {
    // 检查权限是否存在
    const access = await findAccessByLevelAndNodeDao(levelId, nodeId)
    if (!access) {
        throw new Error('权限记录不存在')
    }

    // 软删除权限记录
    await softDeleteAccessDao(access.id)
}

/**
 * 批量撤销会员级别的节点权限
 * @param levelId 会员级别 ID
 * @param nodeIds 节点 ID 列表
 */
export const batchRevokeAccessService = async (
    levelId: number,
    nodeIds: number[]
): Promise<void> => {
    await softDeleteAccessByLevelAndNodesDao(levelId, nodeIds)
}

// ==================== 批量更新服务 ====================

/**
 * 批量更新会员级别的节点权限
 * Requirements: 14.16, 14.17
 * @param levelId 会员级别 ID
 * @param nodeIds 新的节点 ID 列表（完全替换）
 */
export const batchUpdateAccessService = async (
    levelId: number,
    nodeIds: number[]
): Promise<void> => {
    // 验证会员级别是否存在
    const level = await findMembershipLevelByIdDao(levelId)
    if (!level) {
        throw new Error('会员级别不存在')
    }

    // 批量验证所有节点是否存在
    const nodes = await findNodesByIdsDao(nodeIds)
    if (nodes.length !== nodeIds.length) {
        const foundNodeIds = new Set(nodes.map((n) => n.id))
        const missingNodeId = nodeIds.find((id) => !foundNodeIds.has(id))
        throw new Error(`节点 ${missingNodeId} 不存在`)
    }

    // 使用事务处理
    await prisma.$transaction(async (tx) => {
        // 获取当前权限
        const currentAccess = await findAccessByLevelIdDao(levelId, tx as any)
        const currentNodeIds = new Set(currentAccess.map((a) => a.nodeId))
        const newNodeIds = new Set(nodeIds)

        // 计算需要删除的权限（当前有但新列表没有）
        const toDelete = currentAccess.filter((a) => !newNodeIds.has(a.nodeId))

        // 计算需要新增的权限（新列表有但当前没有）
        const toAdd = nodeIds.filter((id) => !currentNodeIds.has(id))

        // 删除不再需要的权限
        for (const access of toDelete) {
            await softDeleteAccessDao(access.id, tx as any)
        }

        // 添加新的权限
        if (toAdd.length > 0) {
            const records = toAdd.map((nodeId) => ({ levelId, nodeId }))
            await createManyAccessDao(records, tx as any)
        }
    })
}

// ==================== 权限检查服务 ====================

/**
 * 检查用户是否有节点访问权限
 * Requirements: 14.18
 * @param userId 用户 ID
 * @param nodeId 节点 ID
 * @returns 是否有权限
 */
export const checkUserNodeAccessService = async (
    userId: number,
    nodeId: number
): Promise<boolean> => {
    // 获取用户当前会员信息
    const membership = await findCurrentUserMembershipDao(userId)
    if (!membership) {
        // 无会员身份，无权限
        return false
    }

    // 检查会员级别是否有该节点的权限
    const access = await findAccessByLevelAndNodeDao(membership.levelId, nodeId)
    return access !== null
}

/**
 * 获取用户可用的节点列表
 * Requirements: 14.18
 * @param userId 用户 ID
 * @returns 用户可用的节点列表
 */
export const getUserAvailableNodesService = async (userId: number) => {
    // 获取用户当前会员信息
    const membership = await findCurrentUserMembershipDao(userId)
    if (!membership) {
        // 无会员身份，返回空列表
        return []
    }

    // 获取会员级别的节点权限
    const accessRecords = await findAccessByLevelIdDao(membership.levelId)

    // 获取所有启用的节点
    const allNodes = await findAllNodesDao({ status: 1 })

    // 构建权限节点ID集合
    const accessNodeIds = new Set(accessRecords.map((a) => a.nodeId))

    // 返回带权限标记的节点列表
    return allNodes.map((node) => ({
        id: node.id,
        name: node.name,
        title: node.title,
        type: node.type,
        description: node.description,
        groupId: node.groupId,
        available: accessNodeIds.has(node.id),
    }))
}

/**
 * 过滤用户有权限的节点
 * Requirements: 14.18
 * @param userId 用户 ID
 * @param nodeIds 待检查的节点 ID 列表
 * @returns 用户有权限的节点 ID 列表
 */
export const filterUserAccessibleNodesService = async (
    userId: number,
    nodeIds: number[]
): Promise<number[]> => {
    // 获取用户当前会员信息
    const membership = await findCurrentUserMembershipDao(userId)
    if (!membership) {
        return []
    }

    // 获取会员级别的节点权限
    const accessRecords = await findAccessByLevelIdDao(membership.levelId)
    const accessNodeIds = new Set(accessRecords.map((a) => a.nodeId))

    // 过滤出有权限的节点
    return nodeIds.filter((id) => accessNodeIds.has(id))
}
