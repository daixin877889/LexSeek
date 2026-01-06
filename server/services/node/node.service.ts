/**
 * 节点服务层
 *
 * 提供节点和节点分组的业务逻辑封装
 * Requirements: 14.1, 14.2, 14.3, 14.4, 14.6, 14.7, 14.8
 */

import type {
    CreateNodeInput,
    UpdateNodeInput,
    CreateNodeGroupInput,
    UpdateNodeGroupInput,
    NodeListParams,
    NodeGroupListParams,
} from '#shared/types/node'
import {
    // 节点分组 DAO
    createNodeGroupDao,
    findNodeGroupByIdDao,
    findManyNodeGroupsDao,
    findAllNodeGroupsDao,
    updateNodeGroupDao,
    softDeleteNodeGroupDao,
    // 节点 DAO
    createNodeDao,
    findNodeByIdDao,
    findNodeByNameDao,
    findManyNodesDao,
    findAllNodesDao,
    findNodesByGroupIdDao,
    updateNodeDao,
    updateNodeStatusDao,
    softDeleteNodeDao,
    batchUpdateNodeGroupDao,
} from './node.dao'
import { findModelByIdDao } from '../model/models.dao'

// ==================== 节点分组服务 ====================

/**
 * 创建节点分组
 * Requirements: 14.6
 * @param data 分组创建数据
 * @returns 创建的分组
 */
export const createNodeGroupService = async (data: CreateNodeGroupInput) => {
    return await createNodeGroupDao(data)
}

/**
 * 获取节点分组详情
 * @param id 分组 ID
 * @returns 分组或 null
 */
export const getNodeGroupByIdService = async (id: number) => {
    return await findNodeGroupByIdDao(id)
}

/**
 * 获取节点分组列表（分页）
 * Requirements: 14.6
 * @param options 查询选项
 * @returns 分组列表和总数
 */
export const getNodeGroupsService = async (options: NodeGroupListParams = {}) => {
    return await findManyNodeGroupsDao(options)
}

/**
 * 获取所有节点分组（不分页）
 * Requirements: 14.6
 * @returns 分组列表
 */
export const getAllNodeGroupsService = async () => {
    return await findAllNodeGroupsDao()
}

/**
 * 更新节点分组
 * Requirements: 14.7
 * @param id 分组 ID
 * @param data 更新数据
 * @returns 更新后的分组
 */
export const updateNodeGroupService = async (
    id: number,
    data: UpdateNodeGroupInput
) => {
    // 检查分组是否存在
    const existing = await findNodeGroupByIdDao(id)
    if (!existing) {
        throw new Error('节点分组不存在')
    }

    return await updateNodeGroupDao(id, data)
}

/**
 * 删除节点分组（软删除）
 * @param id 分组 ID
 */
export const deleteNodeGroupService = async (id: number) => {
    // 检查分组是否存在
    const existing = await findNodeGroupByIdDao(id)
    if (!existing) {
        throw new Error('节点分组不存在')
    }

    // 检查分组下是否有节点
    if (existing._count && existing._count.nodes > 0) {
        throw new Error('该分组下存在节点，无法删除')
    }

    await softDeleteNodeGroupDao(id)
}

// ==================== 节点服务 ====================

/**
 * 创建节点
 * Requirements: 14.2
 * @param data 节点创建数据
 * @returns 创建的节点
 */
export const createNodeService = async (data: CreateNodeInput) => {
    // 检查节点名称是否已存在
    const existingNode = await findNodeByNameDao(data.name)
    if (existingNode) {
        throw new Error('节点名称已存在')
    }

    // 检查模型是否存在
    const model = await findModelByIdDao(data.modelId)
    if (!model) {
        throw new Error('关联的模型不存在')
    }

    // 如果指定了分组，检查分组是否存在
    if (data.groupId) {
        const group = await findNodeGroupByIdDao(data.groupId)
        if (!group) {
            throw new Error('关联的分组不存在')
        }
    }

    return await createNodeDao(data)
}

/**
 * 获取节点详情
 * Requirements: 14.1
 * @param id 节点 ID
 * @returns 节点或 null
 */
export const getNodeByIdService = async (id: number) => {
    return await findNodeByIdDao(id)
}

/**
 * 通过名称获取节点
 * @param name 节点名称
 * @returns 节点或 null
 */
export const getNodeByNameService = async (name: string) => {
    return await findNodeByNameDao(name)
}

/**
 * 获取节点列表（分页）
 * Requirements: 14.1
 * @param options 查询选项
 * @returns 节点列表和总数
 */
export const getNodesService = async (options: NodeListParams = {}) => {
    return await findManyNodesDao(options)
}

/**
 * 获取所有节点（不分页）
 * @param options 筛选选项
 * @returns 节点列表
 */
export const getAllNodesService = async (
    options: {
        type?: string
        groupId?: number
        status?: number
    } = {}
) => {
    return await findAllNodesDao(options)
}

/**
 * 获取分组下的节点列表
 * Requirements: 14.8
 * @param groupId 分组 ID
 * @returns 节点列表
 */
export const getNodesByGroupIdService = async (groupId: number) => {
    return await findNodesByGroupIdDao(groupId)
}

/**
 * 更新节点
 * Requirements: 14.3
 * @param id 节点 ID
 * @param data 更新数据
 * @returns 更新后的节点
 */
export const updateNodeService = async (
    id: number,
    data: UpdateNodeInput
) => {
    // 检查节点是否存在
    const existing = await findNodeByIdDao(id)
    if (!existing) {
        throw new Error('节点不存在')
    }

    // 如果更新模型，检查模型是否存在
    if (data.modelId) {
        const model = await findModelByIdDao(data.modelId)
        if (!model) {
            throw new Error('关联的模型不存在')
        }
    }

    // 如果更新分组，检查分组是否存在
    if (data.groupId) {
        const group = await findNodeGroupByIdDao(data.groupId)
        if (!group) {
            throw new Error('关联的分组不存在')
        }
    }

    return await updateNodeDao(id, data)
}

/**
 * 更新节点状态
 * @param id 节点 ID
 * @param status 状态
 * @returns 更新后的节点
 */
export const updateNodeStatusService = async (
    id: number,
    status: number
) => {
    // 检查节点是否存在
    const existing = await findNodeByIdDao(id)
    if (!existing) {
        throw new Error('节点不存在')
    }

    return await updateNodeStatusDao(id, status)
}

/**
 * 删除节点（软删除）
 * Requirements: 14.4
 * @param id 节点 ID
 */
export const deleteNodeService = async (id: number) => {
    // 检查节点是否存在
    const existing = await findNodeByIdDao(id)
    if (!existing) {
        throw new Error('节点不存在')
    }

    await softDeleteNodeDao(id)
}

/**
 * 批量更新节点分组
 * Requirements: 14.8
 * @param nodeIds 节点 ID 列表
 * @param groupId 分组 ID（null 表示移除分组）
 */
export const batchUpdateNodeGroupService = async (
    nodeIds: number[],
    groupId: number | null
) => {
    // 如果指定了分组，检查分组是否存在
    if (groupId !== null) {
        const group = await findNodeGroupByIdDao(groupId)
        if (!group) {
            throw new Error('关联的分组不存在')
        }
    }

    await batchUpdateNodeGroupDao(nodeIds, groupId)
}
