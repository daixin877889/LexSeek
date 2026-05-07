/**
 * 节点数据访问层
 *
 * 提供节点和节点分组的 CRUD 操作
 */

import type {
    CreateNodeInput,
    UpdateNodeInput,
    CreateNodeGroupInput,
    UpdateNodeGroupInput,
    NodeListParams,
    NodeGroupListParams,
} from '#shared/types/node'
import { Prisma } from '~~/generated/prisma/client'
import type { nodes } from '~~/generated/prisma/client'

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

// ==================== 节点分组 DAO ====================

/**
 * 创建节点分组
 * @param data 分组创建数据
 * @param tx 事务客户端（可选）
 * @returns 创建的分组
 */
export const createNodeGroupDao = async (
    data: CreateNodeGroupInput,
    tx?: PrismaClient
) => {
    try {
        const group = await (tx || prisma).nodeGroups.create({
            data: {
                name: data.name,
                description: data.description,
                priority: data.priority ?? 100,
            },
        })
        return group
    } catch (error) {
        logger.error('创建节点分组失败：', error)
        throw error
    }
}

/**
 * 通过 ID 查询节点分组
 * @param id 分组 ID
 * @param tx 事务客户端（可选）
 * @returns 分组或 null
 */
export const findNodeGroupByIdDao = async (
    id: number,
    tx?: PrismaClient
) => {
    try {
        const group = await (tx || prisma).nodeGroups.findUnique({
            where: { id, deletedAt: null },
            include: {
                _count: {
                    select: { nodes: { where: { deletedAt: null } } },
                },
            },
        })
        return group
    } catch (error) {
        logger.error('通过 ID 查询节点分组失败：', error)
        throw error
    }
}

/**
 * 查询节点分组列表
 * @param options 查询选项
 * @param tx 事务客户端（可选）
 * @returns 分组列表和总数
 */
export const findManyNodeGroupsDao = async (
    options: NodeGroupListParams = {},
    tx?: PrismaClient
) => {
    try {
        const {
            page = 1,
            pageSize = 10,
            keyword,
            orderBy = 'priority',
            orderDir = 'asc',
        } = options
        const skip = (page - 1) * pageSize

        // 构建查询条件
        const where: Prisma.nodeGroupsWhereInput = {
            deletedAt: null,
            ...(keyword && {
                OR: [
                    { name: { contains: keyword, mode: 'insensitive' } },
                    { description: { contains: keyword, mode: 'insensitive' } },
                ],
            }),
        }

        // 并行查询列表和总数
        const [list, total] = await Promise.all([
            (tx || prisma).nodeGroups.findMany({
                where,
                skip,
                take: pageSize,
                include: {
                    _count: {
                        select: { nodes: { where: { deletedAt: null } } },
                    },
                },
                orderBy: { [orderBy]: orderDir },
            }),
            (tx || prisma).nodeGroups.count({ where }),
        ])

        return { list, total }
    } catch (error) {
        logger.error('查询节点分组列表失败：', error)
        throw error
    }
}

/**
 * 查询所有节点分组（不分页）
 * @param tx 事务客户端（可选）
 * @returns 分组列表
 */
export const findAllNodeGroupsDao = async (tx?: PrismaClient) => {
    try {
        const groups = await (tx || prisma).nodeGroups.findMany({
            where: { deletedAt: null },
            include: {
                _count: {
                    select: { nodes: { where: { deletedAt: null } } },
                },
            },
            orderBy: { priority: 'asc' },
        })
        return groups
    } catch (error) {
        logger.error('查询所有节点分组失败：', error)
        throw error
    }
}

/**
 * 更新节点分组
 * @param id 分组 ID
 * @param data 更新数据
 * @param tx 事务客户端（可选）
 * @returns 更新后的分组
 */
export const updateNodeGroupDao = async (
    id: number,
    data: UpdateNodeGroupInput,
    tx?: PrismaClient
) => {
    try {
        const group = await (tx || prisma).nodeGroups.update({
            where: { id },
            data: {
                ...(data.name !== undefined && { name: data.name }),
                ...(data.description !== undefined && { description: data.description }),
                ...(data.priority !== undefined && { priority: data.priority }),
                updatedAt: new Date(),
            },
        })
        return group
    } catch (error) {
        logger.error('更新节点分组失败：', error)
        throw error
    }
}

/**
 * 软删除节点分组
 * @param id 分组 ID
 * @param tx 事务客户端（可选）
 */
export const softDeleteNodeGroupDao = async (
    id: number,
    tx?: PrismaClient
) => {
    try {
        await (tx || prisma).nodeGroups.update({
            where: { id },
            data: { deletedAt: new Date() },
        })
    } catch (error) {
        logger.error('删除节点分组失败：', error)
        throw error
    }
}

// ==================== 节点 DAO ====================

/**
 * 创建节点
 * @param data 节点创建数据
 * @param tx 事务客户端（可选）
 * @returns 创建的节点
 */
export const createNodeDao = async (
    data: CreateNodeInput,
    tx?: PrismaClient
) => {
    try {
        const node = await (tx || prisma).nodes.create({
            data: {
                name: data.name,
                title: data.title,
                description: data.description,
                type: data.type,
                priority: data.priority ?? 100,
                modelId: data.modelId,
                tools: data.tools ?? [],
                groupId: data.groupId,
                status: data.status ?? 1,
                outputSchema: data.outputSchema
                    ? (data.outputSchema as Prisma.InputJsonValue)
                    : Prisma.DbNull,
                ...(data.thinkingEnabled !== undefined && { thinkingEnabled: data.thinkingEnabled }),
            },
            include: {
                group: true,
                model: {
                    select: {
                        id: true,
                        name: true,
                        displayName: true,
                    },
                },
            },
        })
        return node
    } catch (error) {
        logger.error('创建节点失败：', error)
        throw error
    }
}

/**
 * 通过 ID 查询节点
 * @param id 节点 ID
 * @param tx 事务客户端（可选）
 * @returns 节点或 null
 */
export const findNodeByIdDao = async (
    id: number,
    tx?: PrismaClient
) => {
    try {
        const node = await (tx || prisma).nodes.findUnique({
            where: { id, deletedAt: null },
            include: {
                group: true,
                model: {
                    select: {
                        id: true,
                        name: true,
                        displayName: true,
                    },
                },
                // ★ Phase 6 改造：prompts 反向单值字段已删，这里不再 include；
                // 节点详情接口（GET /api/v1/admin/nodes/:id）单独查询 node_prompts 关联表后映射 NodePromptRef[]。
            },
        })
        return node
    } catch (error) {
        logger.error('通过 ID 查询节点失败：', error)
        throw error
    }
}

/**
 * 批量通过 ID 查询节点
 * @param ids 节点 ID 列表
 * @param tx 事务客户端（可选）
 * @returns 节点列表
 */
export const findNodesByIdsDao = async (
    ids: number[],
    tx?: PrismaClient
) => {
    try {
        const nodes = await (tx || prisma).nodes.findMany({
            where: {
                id: { in: ids },
                deletedAt: null,
            },
        })
        return nodes
    } catch (error) {
        logger.error('批量查询节点失败：', error)
        throw error
    }
}

/**
 * 通过名称查询节点
 * @param name 节点名称
 * @param tx 事务客户端（可选）
 * @returns 节点或 null
 */
export const findNodeByNameDao = async (
    name: string,
    tx?: PrismaClient
) => {
    try {
        const node = await (tx || prisma).nodes.findFirst({
            where: { name, deletedAt: null },
            include: {
                group: true,
                model: {
                    select: {
                        id: true,
                        name: true,
                        displayName: true,
                    },
                },
            },
        })
        return node
    } catch (error) {
        logger.error('通过名称查询节点失败：', error)
        throw error
    }
}

/**
 * 查询节点列表
 * @param options 查询选项
 * @param tx 事务客户端（可选）
 * @returns 节点列表和总数
 */
export const findManyNodesDao = async (
    options: NodeListParams = {},
    tx?: PrismaClient
) => {
    try {
        const {
            page = 1,
            pageSize = 10,
            type,
            groupId,
            status,
            keyword,
            orderBy = 'priority',
            orderDir = 'asc',
        } = options
        const skip = (page - 1) * pageSize

        // 构建查询条件
        const where: Prisma.nodesWhereInput = {
            deletedAt: null,
            ...(type !== undefined && { type }),
            ...(groupId !== undefined && { groupId }),
            ...(status !== undefined && { status }),
            ...(keyword && {
                OR: [
                    { name: { contains: keyword, mode: 'insensitive' } },
                    { title: { contains: keyword, mode: 'insensitive' } },
                    { description: { contains: keyword, mode: 'insensitive' } },
                ],
            }),
        }

        // 并行查询列表和总数
        const [list, total] = await Promise.all([
            (tx || prisma).nodes.findMany({
                where,
                skip,
                take: pageSize,
                include: {
                    group: true,
                    model: {
                        select: {
                            id: true,
                            name: true,
                            displayName: true,
                            modelType: true,
                            supportsThinking: true,
                        },
                    },
                },
                orderBy: { [orderBy]: orderDir },
            }),
            (tx || prisma).nodes.count({ where }),
        ])

        return { list, total }
    } catch (error) {
        logger.error('查询节点列表失败：', error)
        throw error
    }
}

/**
 * 查询所有节点（不分页）
 * @param options 筛选选项
 * @param tx 事务客户端（可选）
 * @returns 节点列表
 */
export const findAllNodesDao = async (
    options: {
        type?: string
        groupId?: number
        status?: number
    } = {},
    tx?: PrismaClient
) => {
    try {
        const { type, groupId, status } = options

        const nodes = await (tx || prisma).nodes.findMany({
            where: {
                deletedAt: null,
                ...(type !== undefined && { type }),
                ...(groupId !== undefined && { groupId }),
                ...(status !== undefined && { status }),
            },
            include: {
                group: true,
                model: {
                    select: {
                        id: true,
                        name: true,
                        displayName: true,
                    },
                },
            },
            orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        })
        return nodes
    } catch (error) {
        logger.error('查询所有节点失败：', error)
        throw error
    }
}

/**
 * 通过分组 ID 查询节点列表
 * @param groupId 分组 ID
 * @param tx 事务客户端（可选）
 * @returns 节点列表
 */
export const findNodesByGroupIdDao = async (
    groupId: number,
    tx?: PrismaClient
) => {
    try {
        const nodes = await (tx || prisma).nodes.findMany({
            where: { groupId, deletedAt: null },
            include: {
                group: true,
                model: {
                    select: {
                        id: true,
                        name: true,
                        displayName: true,
                    },
                },
            },
            orderBy: { priority: 'asc' },
        })
        return nodes
    } catch (error) {
        logger.error('通过分组 ID 查询节点列表失败：', error)
        throw error
    }
}

/**
 * 更新节点
 * @param id 节点 ID
 * @param data 更新数据
 * @param tx 事务客户端（可选）
 * @returns 更新后的节点
 */
export const updateNodeDao = async (
    id: number,
    data: UpdateNodeInput,
    tx?: PrismaClient
) => {
    try {
        const node = await (tx || prisma).nodes.update({
            where: { id },
            data: {
                ...(data.title !== undefined && { title: data.title }),
                ...(data.description !== undefined && { description: data.description }),
                ...(data.type !== undefined && { type: data.type }),
                ...(data.priority !== undefined && { priority: data.priority }),
                ...(data.modelId !== undefined && { modelId: data.modelId }),
                ...(data.tools !== undefined && { tools: data.tools }),
                ...(data.groupId !== undefined && { groupId: data.groupId }),
                ...(data.status !== undefined && { status: data.status }),
                ...(data.outputSchema !== undefined && {
                    outputSchema: data.outputSchema === null
                        ? Prisma.DbNull
                        : (data.outputSchema as Prisma.InputJsonValue),
                }),
                ...(data.thinkingEnabled !== undefined && { thinkingEnabled: data.thinkingEnabled }),
                updatedAt: new Date(),
            },
            include: {
                group: true,
                model: {
                    select: {
                        id: true,
                        name: true,
                        displayName: true,
                    },
                },
            },
        })
        return node
    } catch (error) {
        logger.error('更新节点失败：', error)
        throw error
    }
}

/**
 * 更新节点状态
 * @param id 节点 ID
 * @param status 状态
 * @param tx 事务客户端（可选）
 * @returns 更新后的节点
 */
export const updateNodeStatusDao = async (
    id: number,
    status: number,
    tx?: PrismaClient
) => {
    try {
        const node = await (tx || prisma).nodes.update({
            where: { id },
            data: {
                status,
                updatedAt: new Date(),
            },
        })
        return node
    } catch (error) {
        logger.error('更新节点状态失败：', error)
        throw error
    }
}

/**
 * 软删除节点
 * @param id 节点 ID
 * @param tx 事务客户端（可选）
 */
export const softDeleteNodeDao = async (
    id: number,
    tx?: PrismaClient
) => {
    try {
        await (tx || prisma).nodes.update({
            where: { id },
            data: { deletedAt: new Date() },
        })
    } catch (error) {
        logger.error('删除节点失败：', error)
        throw error
    }
}

/**
 * 批量更新节点分组
 * @param nodeIds 节点 ID 列表
 * @param groupId 分组 ID
 * @param tx 事务客户端（可选）
 */
export const batchUpdateNodeGroupDao = async (
    nodeIds: number[],
    groupId: number | null,
    tx?: PrismaClient
) => {
    try {
        await (tx || prisma).nodes.updateMany({
            where: {
                id: { in: nodeIds },
                deletedAt: null,
            },
            data: {
                groupId,
                updatedAt: new Date(),
            },
        })
    } catch (error) {
        logger.error('批量更新节点分组失败：', error)
        throw error
    }
}

/**
 * 获取节点完整配置（包括模型、提供商、API 密钥和生效的提示词）
 * @param name 节点名称
 * @param tx 事务客户端（可选）
 * @returns 节点完整配置或 null
 */
export const getNodeConfigDao = async (
    name: string,
    tx?: PrismaClient
) => {
    try {
        const node = await (tx || prisma).nodes.findFirst({
            where: { name, deletedAt: null, status: 1 },
            include: {
                group: true,
                model: {
                    include: {
                        modelProvider: {
                            include: {
                                modelApiKeys: {
                                    where: {
                                        deletedAt: null,
                                        status: 1,
                                        isDefault: true,
                                    },
                                    take: 1,
                                },
                            },
                        },
                    },
                },
                nodePrompts: {
                    where: {
                        prompt: { status: 1, deletedAt: null },
                    },
                    orderBy: { displayOrder: 'asc' },
                    include: { prompt: true },
                },
            },
        })
        return node
    } catch (error) {
        logger.error('获取节点完整配置失败：', error)
        throw error
    }
}

/**
 * 通过 ID 获取节点完整配置（包括模型、提供商、API 密钥和生效的提示词）
 * @param id 节点 ID
 * @param tx 事务客户端（可选）
 * @returns 节点完整配置或 null
 */
export const getNodeConfigByIdDao = async (
    id: number,
    tx?: PrismaClient
) => {
    try {
        const node = await (tx || prisma).nodes.findFirst({
            where: { id, deletedAt: null, status: 1 },
            include: {
                group: true,
                model: {
                    include: {
                        modelProvider: {
                            include: {
                                modelApiKeys: {
                                    where: {
                                        deletedAt: null,
                                        status: 1,
                                        isDefault: true,
                                    },
                                    take: 1,
                                },
                            },
                        },
                    },
                },
                nodePrompts: {
                    where: {
                        prompt: { status: 1, deletedAt: null },
                    },
                    orderBy: { displayOrder: 'asc' },
                    include: { prompt: true },
                },
            },
        })
        return node
    } catch (error) {
        logger.error('通过 ID 获取节点完整配置失败：', error)
        throw error
    }
}
