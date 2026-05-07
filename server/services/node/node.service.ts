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
import type { SdkType } from '#shared/types/model'
import { DEFAULT_SDK_TYPE } from '#shared/types/model'
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
    getNodeConfigDao,
    getNodeConfigByIdDao,
} from './node.dao'
import { findModelByIdDao } from '../model/models.dao'
import type { nodes } from '~~/generated/prisma/client'

// ==================== 节点配置类型定义 ====================

/** 节点配置中的提示词信息 */
export interface NodePromptConfig {
    id: number
    name: string
    content: string
    version: string
    type: string
    status: number
    /** 同节点内多 prompt 的拼接顺序，越小越靠前；默认 100 */
    displayOrder?: number
}

/** 节点配置中的 API 密钥信息 */
export interface NodeApiKeyConfig {
    id: number
    apiKey: string
    status: number
}

/** 节点完整配置 */
export interface NodeConfig {
    /** 节点 ID */
    id: number
    /** 节点名称（唯一标识） */
    name: string
    /** 节点标题 */
    title: string
    /** 节点描述 */
    description: string
    /** 节点类型 */
    type: string
    /** 生效的提示词列表 */
    prompts: NodePromptConfig[]
    /** 模型 ID */
    modelId: number
    /** 模型名称 */
    modelName: string
    /** 模型类型 */
    modelType: string
    /** 模型状态 */
    modelStatus: number
    /** 模型 SDK 类型，用于指定使用的 LangChain 包，默认为 'openai' */
    modelSdkType: SdkType
    /** 模型提供商 ID */
    modelProviderId: number
    /** 模型提供商名称 */
    modelProviderName: string
    /** 模型提供商 API 基础 URL */
    modelProviderBaseUrl: string
    /** 模型提供商描述 */
    modelProviderDescription: string
    /** API 密钥列表 */
    modelApiKeys: NodeApiKeyConfig[]
    /** 节点工具列表 */
    tools: string[]
    /** 结构化输出 schema（JSON Schema 格式，用于 extraction 类型节点） */
    outputSchema: Record<string, unknown> | null
    /** 模型上下文窗口大小（tokens） */
    modelContextWindow?: number
    /** 模型单次调用最大输出 tokens（模型物理上限） */
    modelMaxOutputTokens?: number
    /** 节点是否启用思考模式 */
    thinkingEnabled: boolean
    /** 关联模型是否支持思考切换 */
    modelSupportsThinking: boolean
}

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

    // 非 extraction/agent 类型强制清空 outputSchema
    const SCHEMA_TYPES = ['extraction', 'agent']
    const cleanedData = (!SCHEMA_TYPES.includes(data.type) && data.outputSchema)
        ? { ...data, outputSchema: null }
        : data
    return await createNodeDao(cleanedData)
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

    // 非 extraction/agent 类型强制清空 outputSchema
    const finalType = data.type ?? existing.type
    const SCHEMA_TYPES = ['extraction', 'agent']
    const cleanedData = (!SCHEMA_TYPES.includes(finalType) && data.outputSchema !== undefined)
        ? { ...data, outputSchema: null }
        : data
    return await updateNodeDao(id, cleanedData)
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

// ==================== 节点配置服务 ====================

/**
 * 通过节点名称获取完整配置
 * 包括模型、提供商、API 密钥和生效的提示词
 * @param name 节点名称
 * @returns 节点完整配置或 null
 */
export const getNodeConfigService = async (name: string): Promise<NodeConfig | null> => {
    try {
        const nodeConfig = await getNodeConfigDao(name)
        if (!nodeConfig) {
            logger.warn('节点配置不存在', { name })
            return null
        }

        // 验证模型配置
        if (!nodeConfig.model) {
            logger.error('节点未关联模型', { name, nodeId: nodeConfig.id })
            return null
        }

        // 验证提供商配置
        if (!nodeConfig.model.modelProvider) {
            logger.error('节点模型未关联提供商', { name, modelId: nodeConfig.modelId })
            return null
        }

        // 构建节点配置
        const config: NodeConfig = {
            id: nodeConfig.id,
            name: nodeConfig.name,
            title: nodeConfig.title || nodeConfig.name,
            description: nodeConfig.description || '',
            type: nodeConfig.type,
            prompts: nodeConfig.nodePrompts.map((np) => ({
                id: np.prompt.id,
                name: np.prompt.name,
                content: np.prompt.content,
                version: np.prompt.version,
                type: np.prompt.type,
                status: np.prompt.status,
                displayOrder: np.displayOrder,
            })),
            modelId: nodeConfig.modelId,
            modelName: nodeConfig.model.name,
            modelType: nodeConfig.model.modelType,
            modelStatus: nodeConfig.model.status ?? 0,
            // 获取模型的 SDK 类型，如果未设置则使用默认值 'openai' 以保持向后兼容
            modelSdkType: (nodeConfig.model.sdkType as SdkType) || DEFAULT_SDK_TYPE,
            modelProviderId: nodeConfig.model.modelProvider.id,
            modelProviderName: nodeConfig.model.modelProvider.name,
            modelProviderBaseUrl: nodeConfig.model.modelProvider.baseUrl,
            modelProviderDescription: nodeConfig.model.modelProvider.description || '',
            modelApiKeys: nodeConfig.model.modelProvider.modelApiKeys.map((apiKey) => ({
                id: apiKey.id,
                apiKey: apiKey.apiKey,
                status: apiKey.status ?? 0,
            })),
            tools: (nodeConfig.tools as string[]) || [],
            outputSchema: (nodeConfig.outputSchema as Record<string, unknown>) ?? null,
            modelContextWindow: nodeConfig.model.contextWindow ?? undefined,
            modelMaxOutputTokens: nodeConfig.model.maxOutputTokens ?? undefined,
            thinkingEnabled: nodeConfig.thinkingEnabled ?? false,
            modelSupportsThinking: nodeConfig.model.supportsThinking ?? false,
        }

        return config
    } catch (error: any) {
        logger.error('获取节点配置失败', {
            error: error.message,
            stack: error.stack,
            name,
        })
        throw new Error(`获取节点配置失败: ${error.message}`)
    }
}

/**
 * 获取节点配置（带验证）
 *
 * 封装通用验证逻辑：检查节点是否存在、是否启用、是否有 API 密钥
 * @param nodeName 节点名称
 * @param nodeTitle 节点显示名称（用于错误信息）
 * @returns 验证后的节点配置
 * @throws 如果节点未配置、未启用或未配置 API 密钥
 */
export const getValidNodeConfig = async (
    nodeName: string,
    displayName?: string
): Promise<NodeConfig> => {
    const label = displayName ?? nodeName
    const config = await getNodeConfigService(nodeName)

    if (!config) {
        throw new Error(`${label} 节点未配置或未启用`)
    }

    if (config.modelApiKeys.length === 0) {
        throw new Error(`${label} 节点的模型提供商未配置 API 密钥`)
    }

    return config
}

/**
 * 通过节点 ID 获取完整配置
 * 包括模型、提供商、API 密钥和生效的提示词
 * @param id 节点 ID
 * @returns 节点完整配置或 null
 */
export const getNodeConfigByIdService = async (id: number): Promise<NodeConfig | null> => {
    try {
        const nodeConfig = await getNodeConfigByIdDao(id)
        if (!nodeConfig) {
            logger.warn('节点配置不存在', { id })
            return null
        }

        // 验证模型配置
        if (!nodeConfig.model) {
            logger.error('节点未关联模型', { id, nodeId: nodeConfig.id })
            return null
        }

        // 验证提供商配置
        if (!nodeConfig.model.modelProvider) {
            logger.error('节点模型未关联提供商', { id, modelId: nodeConfig.modelId })
            return null
        }

        // 构建节点配置
        const config: NodeConfig = {
            id: nodeConfig.id,
            name: nodeConfig.name,
            title: nodeConfig.title || nodeConfig.name,
            description: nodeConfig.description || '',
            type: nodeConfig.type,
            prompts: nodeConfig.nodePrompts.map((np) => ({
                id: np.prompt.id,
                name: np.prompt.name,
                content: np.prompt.content,
                version: np.prompt.version,
                type: np.prompt.type,
                status: np.prompt.status,
                displayOrder: np.displayOrder,
            })),
            modelId: nodeConfig.modelId,
            modelName: nodeConfig.model.name,
            modelType: nodeConfig.model.modelType,
            modelStatus: nodeConfig.model.status ?? 0,
            // 获取模型的 SDK 类型，如果未设置则使用默认值 'openai' 以保持向后兼容
            modelSdkType: (nodeConfig.model.sdkType as SdkType) || DEFAULT_SDK_TYPE,
            modelProviderId: nodeConfig.model.modelProvider.id,
            modelProviderName: nodeConfig.model.modelProvider.name,
            modelProviderBaseUrl: nodeConfig.model.modelProvider.baseUrl,
            modelProviderDescription: nodeConfig.model.modelProvider.description || '',
            modelApiKeys: nodeConfig.model.modelProvider.modelApiKeys.map((apiKey) => ({
                id: apiKey.id,
                apiKey: apiKey.apiKey,
                status: apiKey.status ?? 0,
            })),
            tools: (nodeConfig.tools as string[]) || [],
            outputSchema: (nodeConfig.outputSchema as Record<string, unknown>) ?? null,
            modelContextWindow: nodeConfig.model.contextWindow ?? undefined,
            modelMaxOutputTokens: nodeConfig.model.maxOutputTokens ?? undefined,
            thinkingEnabled: nodeConfig.thinkingEnabled ?? false,
            modelSupportsThinking: nodeConfig.model.supportsThinking ?? false,
        }

        return config
    } catch (error: any) {
        logger.error('通过 ID 获取节点配置失败', {
            error: error.message,
            stack: error.stack,
            id,
        })
        throw new Error(`获取节点配置失败: ${error.message}`)
    }
}

/**
 * 按类型获取节点配置列表
 *
 * 查询指定类型的节点，按 priority 升序排序
 * 用于工作流模块加载、子代理列表等场景
 *
 * @param types - 节点类型列表，如 ['analysis'] 或 ['analysis', 'document']
 * @returns NodeConfig 列表，按 priority 升序排序
 */
export const getNodeConfigsByTypes = async (
    types: string[] = ['analysis', 'document']
): Promise<NodeConfig[]> => {
    const nodes = await prisma.nodes.findMany({
        where: {
            type: { in: types },
            status: 1,
            deletedAt: null,
        },
        include: {
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
            prompts: {
                where: {
                    status: 1,
                    deletedAt: null,
                },
            },
        },
        orderBy: { priority: 'asc' },
    })

    return nodes
        .filter(node => node.model && node.model.modelProvider)
        .map(node => ({
            id: node.id,
            name: node.name,
            title: node.title || node.name,
            description: node.description || '',
            type: node.type,
            prompts: node.prompts.map(prompt => ({
                id: prompt.id,
                name: prompt.name,
                content: prompt.content,
                version: prompt.version,
                type: prompt.type,
                status: prompt.status,
            })),
            modelId: node.modelId,
            modelName: node.model!.name,
            modelType: node.model!.modelType,
            modelStatus: node.model!.status ?? 0,
            modelSdkType: (node.model!.sdkType as SdkType) || DEFAULT_SDK_TYPE,
            modelProviderId: node.model!.modelProvider!.id,
            modelProviderName: node.model!.modelProvider!.name,
            modelProviderBaseUrl: node.model!.modelProvider!.baseUrl,
            modelProviderDescription: node.model!.modelProvider!.description || '',
            modelApiKeys: node.model!.modelProvider!.modelApiKeys.map(apiKey => ({
                id: apiKey.id,
                apiKey: apiKey.apiKey,
                status: apiKey.status ?? 0,
            })),
            tools: (node.tools as string[]) || [],
            outputSchema: (node.outputSchema as Record<string, unknown>) ?? null,
            modelContextWindow: node.model!.contextWindow ?? undefined,
            modelMaxOutputTokens: node.model!.maxOutputTokens ?? undefined,
            thinkingEnabled: node.thinkingEnabled ?? false,
            modelSupportsThinking: node.model!.supportsThinking ?? false,
        }))
}

/**
 * 决议某次 LLM 调用最终是否启用思考模式。
 *
 * 优先级：
 * 1. 模型层硬门禁：modelSupportsThinking=false → 强制 false
 * 2. 前端用户显式：ctxThinking !== undefined → 用 ctxThinking
 * 3. 节点配置默认：fallback nodeThinkingEnabled
 */
export function resolveThinking(
    modelSupportsThinking: boolean,
    ctxThinking: boolean | undefined,
    nodeThinkingEnabled: boolean,
): boolean {
    if (!modelSupportsThinking) return false
    if (ctxThinking !== undefined) return ctxThinking
    return nodeThinkingEnabled
}

/**
 * 调用方便捷封装：直接从 NodeConfig + ctx.thinking 决议，避免 7 处调用点
 * 重复写 `resolveThinking(nodeConfig.modelSupportsThinking, ..., nodeConfig.thinkingEnabled)`。
 */
export function resolveThinkingFromNodeConfig(
    nodeConfig: NodeConfig,
    ctxThinking: boolean | undefined,
): boolean {
    return resolveThinking(
        nodeConfig.modelSupportsThinking,
        ctxThinking,
        nodeConfig.thinkingEnabled,
    )
}
