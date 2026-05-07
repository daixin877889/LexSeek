/**
 * 提示词数据访问层
 *
 * 提供提示词的 CRUD 操作
 * Requirements: 14.9, 14.10, 14.11, 14.12, 14.13, 14.14
 */

import type {
    CreatePromptInput,
    UpdatePromptInput,
    PromptListParams,
    PromptType,
} from '#shared/types/node'
import type { Prisma } from '~~/generated/prisma/client'
import type { prompts } from '~~/generated/prisma/client'

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/**
 * 从版本号字符串中提取首个数字 token 作为排序权重
 * 适配 'v1' / 'v10' / '1.0.0' / '2.0.0' 等多种历史格式
 * 无数字时返回 -1，排在最后
 */
const extractVersionNumber = (version: string): number => {
    const match = version.match(/(\d+)/)
    return match ? parseInt(match[1]!, 10) : -1
}

/**
 * 版本号降序比较：先按数字大小，相同时按字符串字典序兜底
 * 修复 VarChar 字段直接 ORDER BY 导致 'v9' > 'v10' 的字典序卡死问题
 */
const compareVersionDesc = (a: string, b: string): number => {
    const na = extractVersionNumber(a)
    const nb = extractVersionNumber(b)
    if (na !== nb) return nb - na
    return b.localeCompare(a)
}

/**
 * 创建提示词
 * @param data 提示词创建数据
 * @param version 版本号
 * @param tx 事务客户端（可选）
 * @returns 创建的提示词
 */
export const createPromptDao = async (
    data: CreatePromptInput,
    version: string,
    tx?: PrismaClient
) => {
    try {
        const prompt = await (tx || prisma).prompts.create({
            data: {
                name: data.name,
                title: data.title,
                content: data.content,
                variables: data.variables ?? [],
                version,
                type: data.type,
                status: 0, // 新创建的提示词默认未生效
                nodeId: data.nodeId,
            },
            include: {
                node: {
                    select: {
                        id: true,
                        name: true,
                        title: true,
                    },
                },
            },
        })
        return prompt
    } catch (error) {
        logger.error('创建提示词失败：', error)
        throw error
    }
}

/**
 * 通过 ID 查询提示词
 * @param id 提示词 ID
 * @param tx 事务客户端（可选）
 * @returns 提示词或 null
 */
export const findPromptByIdDao = async (
    id: number,
    tx?: PrismaClient
) => {
    try {
        const prompt = await (tx || prisma).prompts.findUnique({
            where: { id, deletedAt: null },
            include: {
                node: {
                    select: {
                        id: true,
                        name: true,
                        title: true,
                    },
                },
                nodePrompts: {
                    include: {
                        node: {
                            select: { id: true, name: true, title: true },
                        },
                    },
                    orderBy: { displayOrder: 'asc' },
                },
            },
        })
        return prompt
    } catch (error) {
        logger.error('通过 ID 查询提示词失败：', error)
        throw error
    }
}

/**
 * 查询提示词列表
 * @param options 查询选项
 * @param tx 事务客户端（可选）
 * @returns 提示词列表和总数
 */
export const findManyPromptsDao = async (
    options: PromptListParams = {},
    tx?: PrismaClient
) => {
    try {
        const {
            page = 1,
            pageSize = 10,
            nodeId,
            type,
            status,
            keyword,
            orderBy = 'createdAt',
            orderDir = 'desc',
        } = options
        const skip = (page - 1) * pageSize

        // 构建查询条件
        const where: Prisma.promptsWhereInput = {
            deletedAt: null,
            ...(nodeId !== undefined && { nodeId }),
            ...(type !== undefined && { type }),
            ...(status !== undefined && { status }),
            ...(keyword && {
                OR: [
                    { name: { contains: keyword, mode: 'insensitive' } },
                    { title: { contains: keyword, mode: 'insensitive' } },
                ],
            }),
        }

        // 并行查询列表和总数
        const [list, total] = await Promise.all([
            (tx || prisma).prompts.findMany({
                where,
                skip,
                take: pageSize,
                include: {
                    node: {
                        select: {
                            id: true,
                            name: true,
                            title: true,
                        },
                    },
                    _count: {
                        select: { nodePrompts: true },
                    },
                },
                orderBy: { [orderBy]: orderDir },
            }),
            (tx || prisma).prompts.count({ where }),
        ])

        return { list, total }
    } catch (error) {
        logger.error('查询提示词列表失败：', error)
        throw error
    }
}

/**
 * 查询节点的所有提示词
 * @param nodeId 节点 ID
 * @param tx 事务客户端（可选）
 * @returns 提示词列表
 */
export const findPromptsByNodeIdDao = async (
    nodeId: number,
    tx?: PrismaClient
) => {
    try {
        const prompts = await (tx || prisma).prompts.findMany({
            where: { nodeId, deletedAt: null },
            include: {
                node: {
                    select: {
                        id: true,
                        name: true,
                        title: true,
                    },
                },
            },
            orderBy: { type: 'asc' },
        })
        return prompts.sort((a, b) => {
            if (a.type !== b.type) return a.type < b.type ? -1 : 1
            return compareVersionDesc(a.version, b.version)
        })
    } catch (error) {
        logger.error('查询节点提示词失败：', error)
        throw error
    }
}

/**
 * 查询节点指定类型的生效提示词
 * @param nodeId 节点 ID
 * @param type 提示词类型
 * @param tx 事务客户端（可选）
 * @returns 提示词或 null
 */
export const findActivePromptDao = async (
    nodeId: number,
    type: PromptType,
    tx?: PrismaClient
) => {
    try {
        const prompt = await (tx || prisma).prompts.findFirst({
            where: {
                nodeId,
                type,
                status: 1,
                deletedAt: null,
            },
            include: {
                node: {
                    select: {
                        id: true,
                        name: true,
                        title: true,
                    },
                },
            },
        })
        return prompt
    } catch (error) {
        logger.error('查询生效提示词失败：', error)
        throw error
    }
}

/**
 * 查询提示词版本历史
 * @param nodeId 节点 ID
 * @param name 提示词名称
 * @param type 提示词类型
 * @param tx 事务客户端（可选）
 * @returns 版本列表
 */
export const findPromptVersionsDao = async (
    nodeId: number,
    name: string,
    type: PromptType,
    tx?: PrismaClient
) => {
    try {
        const prompts = await (tx || prisma).prompts.findMany({
            where: {
                nodeId,
                name,
                type,
                deletedAt: null,
            },
        })
        return prompts.sort((a, b) => compareVersionDesc(a.version, b.version))
    } catch (error) {
        logger.error('查询提示词版本历史失败：', error)
        throw error
    }
}

/**
 * 获取提示词最新版本号
 * @param nodeId 节点 ID
 * @param name 提示词名称
 * @param type 提示词类型
 * @param tx 事务客户端（可选）
 * @returns 最新版本号或 null
 */
export const getLatestVersionDao = async (
    nodeId: number,
    name: string,
    type: PromptType,
    tx?: PrismaClient
) => {
    try {
        const versions = await (tx || prisma).prompts.findMany({
            where: {
                nodeId,
                name,
                type,
                deletedAt: null,
            },
            select: { version: true },
        })
        if (versions.length === 0) return null
        const sorted = versions
            .map(v => v.version)
            .sort(compareVersionDesc)
        return sorted[0] ?? null
    } catch (error) {
        logger.error('获取提示词最新版本号失败：', error)
        throw error
    }
}

/**
 * 更新提示词
 * @param id 提示词 ID
 * @param data 更新数据
 * @param tx 事务客户端（可选）
 * @returns 更新后的提示词
 */
export const updatePromptDao = async (
    id: number,
    data: UpdatePromptInput,
    tx?: PrismaClient
) => {
    try {
        const prompt = await (tx || prisma).prompts.update({
            where: { id },
            data: {
                ...(data.title !== undefined && { title: data.title }),
                ...(data.content !== undefined && { content: data.content }),
                ...(data.variables !== undefined && { variables: data.variables }),
                updatedAt: new Date(),
            },
            include: {
                node: {
                    select: {
                        id: true,
                        name: true,
                        title: true,
                    },
                },
            },
        })
        return prompt
    } catch (error) {
        logger.error('更新提示词失败：', error)
        throw error
    }
}

/**
 * 更新提示词状态
 * @param id 提示词 ID
 * @param status 状态
 * @param tx 事务客户端（可选）
 * @returns 更新后的提示词
 */
export const updatePromptStatusDao = async (
    id: number,
    status: number,
    tx?: PrismaClient
) => {
    try {
        const prompt = await (tx || prisma).prompts.update({
            where: { id },
            data: {
                status,
                updatedAt: new Date(),
            },
        })
        return prompt
    } catch (error) {
        logger.error('更新提示词状态失败：', error)
        throw error
    }
}

/**
 * 停用节点指定类型的所有提示词
 * @param nodeId 节点 ID
 * @param type 提示词类型
 * @param tx 事务客户端（可选）
 */
export const deactivatePromptsByTypeDao = async (
    nodeId: number,
    type: PromptType,
    tx?: PrismaClient
) => {
    try {
        await (tx || prisma).prompts.updateMany({
            where: {
                nodeId,
                type,
                status: 1,
                deletedAt: null,
            },
            data: {
                status: 0,
                updatedAt: new Date(),
            },
        })
    } catch (error) {
        logger.error('停用提示词失败：', error)
        throw error
    }
}

/**
 * 软删除提示词
 * @param id 提示词 ID
 * @param tx 事务客户端（可选）
 */
export const softDeletePromptDao = async (
    id: number,
    tx?: PrismaClient
) => {
    try {
        await (tx || prisma).prompts.update({
            where: { id },
            data: { deletedAt: new Date() },
        })
    } catch (error) {
        logger.error('删除提示词失败：', error)
        throw error
    }
}
