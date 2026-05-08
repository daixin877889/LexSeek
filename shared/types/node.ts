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

/** 提示词类型枚举值数组（单一来源） */
export const PROMPT_TYPES = ['system', 'user', 'user_injection', 'assistant'] as const

/** 提示词类型 */
export type PromptType = typeof PROMPT_TYPES[number]

/** 提示词类型标签映射 */
export const PromptTypeLabels: Record<PromptType, string> = {
    system: '系统提示词',
    user: '用户提示词',
    user_injection: '用户每轮注入',
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
    /** 是否启用思考模式 */
    thinkingEnabled?: boolean
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
        modelType?: string
        supportsThinking?: boolean
    }
    prompts?: Prompt[]
}

/**
 * 节点关联的提示词引用（多对多扁平视图）
 *
 * 用途：节点详情接口（GET /api/v1/admin/nodes/:id）返回的 `prompts` 字段元素类型；
 * 也用于前端节点弹框 "提示词" tab 与提示词选择器组件之间的数据交换。
 *
 * 字段语义：
 * - `displayOrder`：来自 `node_prompts.displayOrder`（同节点内拼接顺序，升序）
 * - `referencedByCount`：来自 `_count.nodePrompts`（该 prompt 被多少个节点引用）
 */
export interface NodePromptRef {
    id: number
    name: string
    title: string | null
    type: string
    status: number
    version: string
    displayOrder: number
    referencedByCount: number
}

/**
 * 节点关联的 Skill 引用（多对多扁平视图）
 *
 * 用途：节点详情接口（GET /api/v1/admin/nodes/:id）返回的 `skills` 字段元素类型，
 * 用于详情页只读展示该节点挂载的 Skills（按 priority 升序）。
 *
 * 字段语义：
 * - `name`：来自 `skills.name`（主键，文件系统 Skill 目录名）
 * - `title` / `customTitle`：管理员可在后台为 Skill 自定义中文展示名
 * - `description`：SKILL.md frontmatter 中的描述（触发场景）
 * - `status`：1 启用 / 0 停用
 * - `priority`：来自 `node_skills.priority`（同节点内 Skill 排序）
 */
export interface NodeSkillRef {
    name: string
    title: string | null
    customTitle: string | null
    description: string | null
    status: number
    priority: number
}

/**
 * 节点配置中工具列表项的元信息
 *
 * 用途：节点详情接口（GET /api/v1/admin/nodes/:id）返回的 `toolDetails` 字段元素类型，
 * 用于详情页显示每个挂载工具的名称 + 描述（升级前只有 name 一个 badge）。
 *
 * 字段语义：
 * - `name`：工具唯一标识（与 `nodes.tools` JSON 列里存的字符串一致）
 * - `description`：工具元信息中的描述；若工具已从注册表移除则为 null（仅返回 name）
 */
export interface NodeToolDetailRef {
    name: string
    description: string | null
}

/**
 * GET /api/v1/admin/nodes/:id 返回体类型
 *
 * 基于 `NodeWithRelations`，把 `prompts` 字段替换为多对多扁平视图（`NodePromptRef[]`），
 * 并补充 `skills` / `toolDetails` 两个只读视图字段（详情页用）：
 *   - `skills`：节点挂载的 Skills（按 priority 升序）
 *   - `toolDetails`：节点 `tools` JSON 列对应的工具元信息（含 description）
 *
 * 历史 `NodeWithRelations.prompts?: Prompt[]` 是直接从 `prompts.nodeId` 单值关系下取的快照，
 * Phase 6 改造后不再使用；该接口由 `node_prompts` 关联表提供，每条带 `displayOrder` + 引用计数。
 */
export type NodeWithPromptsResponse = Omit<NodeWithRelations, 'prompts'> & {
    prompts: NodePromptRef[]
    skills: NodeSkillRef[]
    toolDetails: NodeToolDetailRef[]
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

/**
 * 提示词列表 / 详情返回体类型
 *
 * Phase 6 起 `prompts.nodeId` 字段已删，节点关联走 `node_prompts` 多对多表。
 * - 列表接口（GET /api/v1/admin/prompts）：每条带 `referencedByCount`（被多少个节点引用）。
 * - 详情接口（GET /api/v1/admin/prompts/:id）：额外带 `referencedByNodes`（节点引用列表，含
 *   `displayOrder` 用于按节点装配顺序展示）。
 */
export interface PromptWithRelations extends Prompt {
    /** 被多少个节点引用（来自 _count.nodePrompts） */
    referencedByCount?: number
    /** 节点引用列表（仅详情接口返回） */
    referencedByNodes?: Array<{
        id: number
        name: string
        title: string | null
        displayOrder: number
    }>
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

// ==================== 完整 prompt 预览相关类型 ====================

/**
 * 节点完整 prompt 预览中单条 user / assistant 消息项
 *
 * 用于「用户触发消息」「预设助手消息」两类列表式展示，
 * 每条独立卡片，不做拼接（与 system / user_injection 多段拼接行为不同）。
 */
export interface NodePromptsPreviewItem {
    /** 提示词唯一名称（数据库 prompts.name） */
    name: string
    /** 提示词显示标题（管理员自定义，可空） */
    title: string | null
    /** 已完成模板变量占位渲染的内容 */
    content: string
}

/**
 * 节点完整 prompt 预览返回结构（4 类分组动态展示）
 *
 * 后端按 type 分桶：
 * - `system` / `userInjection`：多段按 displayOrder 升序 `'\n\n'` join，给出拼接结果 + 段数
 * - `userItems` / `assistantItems`：列表式输出，按 displayOrder 升序，每项独立卡片
 *
 * 任意一类为空（无生效 prompt）时返回 null（system / userInjection）或 null（userItems / assistantItems），
 * 前端按 v-if 动态渲染对应分段，不渲染空段。
 */
export interface NodePromptsPreview {
    system: { content: string; count: number } | null
    userInjection: { content: string; count: number } | null
    userItems: NodePromptsPreviewItem[] | null
    assistantItems: NodePromptsPreviewItem[] | null
}
