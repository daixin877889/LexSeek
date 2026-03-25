/**
 * 节点管理系统类型定义
 */

import type {
    nodes,
    nodeGroups,
    prompts,
    levelNodeAccess,
} from '~~/generated/prisma/client'

/** 节点类型枚举值数组（真相源） */
export const NODE_TYPES = ['analysis', 'document', 'extraction', 'agent'] as const

/** 节点类型枚举 */
export type NodeType = (typeof NODE_TYPES)[number]

/** 节点类型标签映射 */
export const NodeTypeLabels: Record<NodeType, string> = {
    analysis: '分析模块',
    document: '文书模块',
    extraction: '数据提取',
    agent: '主代理',
}

/** 节点类型徽章变体映射 */
export const NodeTypeVariants: Record<NodeType, 'default' | 'secondary' | 'outline'> = {
    analysis: 'default',
    document: 'secondary',
    extraction: 'outline',
    agent: 'outline',
}

/** 节点状态枚举 */
export enum NodeStatus {
    /** 禁用 */
    DISABLED = 0,
    /** 启用 */
    ENABLED = 1,
}

/** 节点状态标签映射 */
export const NodeStatusLabels: Record<NodeStatus, string> = {
    [NodeStatus.DISABLED]: '禁用',
    [NodeStatus.ENABLED]: '启用',
}

/** 提示词类型枚举 */
export type PromptType = 'system' | 'user' | 'assistant'

/** 提示词类型标签映射 */
export const PromptTypeLabels: Record<PromptType, string> = {
    system: '系统提示词',
    user: '用户提示词',
    assistant: '助手提示词',
}

/** 提示词状态枚举 */
export enum PromptStatus {
    /** 未生效 */
    INACTIVE = 0,
    /** 生效 */
    ACTIVE = 1,
}

/** 提示词状态标签映射 */
export const PromptStatusLabels: Record<PromptStatus, string> = {
    [PromptStatus.INACTIVE]: '未生效',
    [PromptStatus.ACTIVE]: '生效',
}

// 重导出 Prisma 类型（便于使用）
export type Node = nodes
export type NodeGroup = nodeGroups
export type Prompt = prompts
export type LevelNodeAccess = levelNodeAccess

/** 创建节点分组输入类型 */
export interface CreateNodeGroupInput {
    name: string
    description?: string | null
    priority?: number
}

/** 更新节点分组输入类型 */
export type UpdateNodeGroupInput = Partial<CreateNodeGroupInput>

/** 创建节点输入类型 */
export interface CreateNodeInput {
    name: string
    title?: string | null
    description?: string | null
    type: NodeType
    priority?: number
    modelId: number
    tools?: string[]
    groupId?: number | null
    status?: number
    outputSchema?: Record<string, unknown> | null
}

/** 更新节点输入类型 */
export type UpdateNodeInput = Partial<Omit<CreateNodeInput, 'name'>>

/** 节点列表查询参数 */
export interface NodeListParams {
    /** 页码 */
    page?: number
    /** 每页数量 */
    pageSize?: number
    /** 节点类型筛选 */
    type?: NodeType
    /** 分组ID筛选 */
    groupId?: number
    /** 状态筛选 */
    status?: number
    /** 关键词搜索（名称/标题） */
    keyword?: string
    /** 排序字段 */
    orderBy?: 'priority' | 'name' | 'createdAt'
    /** 排序方向 */
    orderDir?: 'asc' | 'desc'
}

/** 节点分组列表查询参数 */
export interface NodeGroupListParams {
    /** 页码 */
    page?: number
    /** 每页数量 */
    pageSize?: number
    /** 关键词搜索 */
    keyword?: string
    /** 排序字段 */
    orderBy?: 'priority' | 'name' | 'createdAt'
    /** 排序方向 */
    orderDir?: 'asc' | 'desc'
}

/** 节点详情（包含关联数据） */
export interface NodeWithRelations extends Node {
    group?: NodeGroup | null
    model?: {
        id: number
        name: string
        displayName: string
    }
    prompts?: Prompt[]
}

/** 节点分组详情（包含节点数量） */
export interface NodeGroupWithCount extends NodeGroup {
    _count?: {
        nodes: number
    }
}

// ==================== 提示词相关类型 ====================

/** 创建提示词输入类型 */
export interface CreatePromptInput {
    /** 提示词名称 */
    name: string
    /** 提示词显示标题 */
    title?: string | null
    /** 提示词内容 */
    content: string
    /** 变量列表 */
    variables?: string[]
    /** 提示词类型 */
    type: PromptType
    /** 关联的节点ID */
    nodeId: number
}

/** 更新提示词输入类型 */
export interface UpdatePromptInput {
    /** 提示词显示标题 */
    title?: string | null
    /** 提示词内容 */
    content?: string
    /** 变量列表 */
    variables?: string[]
}

/** 提示词列表查询参数 */
export interface PromptListParams {
    /** 页码 */
    page?: number
    /** 每页数量 */
    pageSize?: number
    /** 节点ID筛选 */
    nodeId?: number
    /** 提示词类型筛选 */
    type?: PromptType
    /** 状态筛选 */
    status?: number
    /** 关键词搜索（名称/标题） */
    keyword?: string
    /** 排序字段 */
    orderBy?: 'version' | 'name' | 'createdAt'
    /** 排序方向 */
    orderDir?: 'asc' | 'desc'
}

/** 提示词详情（包含关联数据） */
export interface PromptWithRelations extends Prompt {
    node?: {
        id: number
        name: string
        title: string | null
    }
}

/** 变量渲染输入类型 */
export interface RenderPromptInput {
    /** 提示词ID */
    promptId: number
    /** 变量值映射 */
    variables: Record<string, string>
}

/** 预览渲染输入类型 */
export interface PreviewPromptInput {
    /** 提示词内容 */
    content: string
    /** 变量值映射 */
    variables: Record<string, string>
}
