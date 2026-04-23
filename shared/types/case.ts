/**
 * 案件相关类型定义
 *
 * 整合了案件、会话、分析等相关类型
 * 供客户端和服务端共用
 */

import type { OssFileDto } from './file'

// ==================== 案件类型选项 ====================

/** 案件类型选项（用于下拉选择） */
export interface CaseTypeOption {
  id: number
  name: string
}

// ==================== 案件状态枚举 ====================

/** 案件状态枚举 */
export enum CaseStatus {
  CONSULTING   = 1,   // 咨询阶段（默认）
  PREPARING    = 2,   // 准备阶段
  FIRST_TRIAL  = 3,   // 一审阶段
  SECOND_TRIAL = 4,   // 二审阶段
  CLOSED       = 99,  // 结案
  ARCHIVED     = 999, // 归档
}

/** 
 * 案件材料类型枚举
 * 
 * 注意：这是项目中统一使用的材料类型枚举
 */
export enum CaseMaterialType {
    /** 文本内容 */
    CASE_CONTENT = 1,
    /** 文档 */
    DOCUMENT = 2,
    /** 图片 */
    IMAGE = 3,
    /** 音频 */
    AUDIO = 4,
}

/** 案件材料类型文本映射 */
export const CaseMaterialTypeText: Record<CaseMaterialType, string> = {
    [CaseMaterialType.CASE_CONTENT]: '文本',
    [CaseMaterialType.DOCUMENT]: '文档',
    [CaseMaterialType.IMAGE]: '图片',
    [CaseMaterialType.AUDIO]: '音频',
}

/**
 * 根据 MIME 类型判断材料类型
 *
 * 前后端共用，确保类型映射规则一致
 */
export function getMaterialTypeFromMime(mimeType: string | null | undefined): CaseMaterialType {
    if (!mimeType) return CaseMaterialType.DOCUMENT
    const lower = mimeType.toLowerCase()
    if (lower.startsWith('image/') || lower.includes('image')) return CaseMaterialType.IMAGE
    if (lower.startsWith('audio/') || lower.includes('audio')) return CaseMaterialType.AUDIO
    return CaseMaterialType.DOCUMENT
}

/**
 * 案件材料参数接口
 * 用于创建案件时提交材料信息
 */
export interface CaseMaterialParam {
    /** 材料类型 */
    type: CaseMaterialType
    /** 材料名称（可选，默认使用文件名） */
    name?: string
    /** 文本内容（type=CASE_CONTENT 时必填） */
    content?: string
    /** OSS 文件 ID（type!=CASE_CONTENT 时必填） */
    ossFileId?: number
    /** 材料分组（可选） */
    materialGroup?: string
}

/**
 * promptInput 提交的标准化数据
 * 由调用方决定如何处理（创建案件 or 发送补充消息）
 * text 为空字符串时表示纯附件提交，调用方应使用 data.text.trim() 判断
 */
export interface PromptSubmitData {
    /** 用户输入的文本 */
    text: string
    /** 已选材料列表 */
    materials: CaseMaterialParam[]
}

/** 案件状态文本映射 */
export const CaseStatusText: Record<CaseStatus, string> = {
  [CaseStatus.CONSULTING]:   '咨询阶段',
  [CaseStatus.PREPARING]:    '准备阶段',
  [CaseStatus.FIRST_TRIAL]:  '一审阶段',
  [CaseStatus.SECOND_TRIAL]: '二审阶段',
  [CaseStatus.CLOSED]:       '结案',
  [CaseStatus.ARCHIVED]:     '归档',
}

/** 徽章 Tailwind 类（固定色系 + dark 变体） */
export const CaseStatusBadgeClass: Record<CaseStatus, string> = {
  [CaseStatus.CONSULTING]:   'bg-zinc-500/10 text-zinc-700 dark:bg-zinc-500/15 dark:text-zinc-300',
  [CaseStatus.PREPARING]:    'bg-blue-500/10 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  [CaseStatus.FIRST_TRIAL]:  'bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  [CaseStatus.SECOND_TRIAL]: 'bg-orange-500/10 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
  [CaseStatus.CLOSED]:       'bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  [CaseStatus.ARCHIVED]:     'bg-muted text-muted-foreground',
}

/** 判断状态是否只读（UI 禁用编辑/分析/写记忆入口） */
export function isCaseReadOnly(status: CaseStatus | number): boolean {
  return status === CaseStatus.ARCHIVED
}

/** 会话状态枚举 */
export enum SessionStatus {
    /** 进行中 */
    IN_PROGRESS = 1,
    /** 已完成 */
    COMPLETED = 2,
    /** 已中断 */
    INTERRUPTED = 3,
    /** 已失败 */
    FAILED = 4,
}

/** 会话状态文本映射 */
export const SessionStatusText: Record<SessionStatus, string> = {
    [SessionStatus.IN_PROGRESS]: '进行中',
    [SessionStatus.COMPLETED]: '已完成',
    [SessionStatus.INTERRUPTED]: '已中断',
    [SessionStatus.FAILED]: '已失败',
}

// ==================== SSE 和工作流枚举 ====================

/** SSE 消息类型枚举（与服务端保持一致） */
export enum SSEMessageType {
    // 连接状态
    CONNECTED = 'connected',
    HEARTBEAT = 'heartbeat',
    CLOSED = 'closed',

    // 工作流状态
    WORKFLOW_START = 'workflow:start',
    WORKFLOW_COMPLETE = 'workflow:complete',
    WORKFLOW_ERROR = 'workflow:error',

    // 中断事件
    INTERRUPT = 'interrupt',

    // 分析任务
    TASK_START = 'task:start',
    TASK_PROGRESS = 'task:progress',
    TASK_COMPLETE = 'task:complete',
    TASK_ERROR = 'task:error',

    // AI 生成
    REASONING = 'reasoning',
    TEXT_DELTA = 'text:delta',
    TEXT_COMPLETE = 'text:complete',

    // 工具调用
    TOOL_CALL = 'tool:call',
    TOOL_RESULT = 'tool:result',

    // 通用
    INFO = 'info',
    WARNING = 'warning',
    ERROR = 'error',
}

/** 中断类型枚举 */
export enum InterruptType {
    /** 中断点1：案情信息检查 */
    CASE_INFO_CHECK = 'case_info_check',
    /** 中断点2：基本信息确认 */
    BASIC_INFO_CONFIRM = 'basic_info_confirm',
    /** 中断点3：模块选择 */
    MODULE_SELECT = 'module_select',
    /** 中断点4：积分不足 */
    INSUFFICIENT_POINTS = 'insufficient_points',
    /** 中断点5：合同审查立场选择 */
    AWAITING_STANCE = 'awaiting_stance',
}

// ==================== 案件基本信息接口 ====================

/** 扩展字段项（LLM 根据案件类型自动提取的额外信息） */
export interface ExtraField {
    /** 英文标识（camelCase） */
    name: string
    /** 中文名称 */
    title: string
    /** 提取的值 */
    value: string
}

/** 结构化提取结果（固定字段 + 动态扩展字段） */
export interface ExtractedCaseInfo {
    /** 案件标题 */
    title: string
    /** 原告列表 */
    plaintiff: string[]
    /** 被告列表 */
    defendant: string[]
    /** 案件类型（必须匹配 case_types 表中的值） */
    caseType: string
    /** 案件概述 */
    summary: string
    /** 扩展字段列表 */
    extraFields: ExtraField[]
}

/** 原告/被告信息 */
export interface PartyInfo {
    /** 名称 */
    name: string
    /** 类型：individual-个人，company-公司 */
    type?: 'individual' | 'company'
    /** 联系方式 */
    contact?: string
    /** 地址 */
    address?: string
    /** 其他信息 */
    extra?: Record<string, unknown>
}

// ==================== SSE 消息接口 ====================

/** SSE 消息接口 */
export interface SSEMessage {
    type: SSEMessageType | string
    message: string
    data?: Record<string, unknown>
    timestamp?: number
}

/** 中断数据接口 */
export interface InterruptData {
    type: InterruptType
    message: string
    data: Record<string, unknown>
    resumable: boolean
    node: string
}

/** 案情信息检查中断数据接口（中断点1） */
export interface CaseInfoCheckInterruptData extends InterruptData {
    type: InterruptType.CASE_INFO_CHECK
    data: {
        /** 检查结果 */
        checkResult: {
            /** 案情信息是否充足 */
            sufficient: boolean
            /** 检查结果说明 */
            message: string
            /** 缺失的信息类型列表 */
            missingInfo?: string[]
            /** 建议补充的内容 */
            suggestions?: string[]
        }
        /** 当前材料内容摘要 */
        materialSummary: string
    }
}

/** 基本信息确认中断数据接口（中断点2） */
export interface BasicInfoConfirmInterruptData extends InterruptData {
    type: InterruptType.BASIC_INFO_CONFIRM
    data: {
        /** 提取的基本信息 */
        extractedInfo: {
            /** 案件标题 */
            title: string
            /** 原告列表 */
            plaintiff: string[]
            /** 被告列表 */
            defendant: string[]
            /** 案件摘要 */
            summary: string
            /** 案件类型名称 */
            caseTypeName?: string
            /** 案由 */
            causeOfAction?: string
            /** 诉讼标的金额 */
            amount?: string
            /** 案件发生时间 */
            caseDate?: string
            /** 案件发生地点 */
            caseLocation?: string
        }
        /** 案件类型 ID */
        caseTypeId: number
        /** 案件类型名称 */
        caseTypeName: string
    }
}

/** 模块选择中断数据接口（中断点3） */
export interface ModuleSelectInterruptData extends InterruptData {
    type: InterruptType.MODULE_SELECT
    data: {
        /** 可用的分析模块列表 */
        availableModules: AnalysisModuleInfo[]
        /** 用户当前可用积分 */
        userAvailablePoints: number
        /** 用户是否有足够积分 */
        hasEnoughPoints: boolean
    }
}

/** 积分不足中断数据接口（中断点4） */
export interface InsufficientPointsInterruptData extends InterruptData {
    type: InterruptType.INSUFFICIENT_POINTS
    data: {
        /** 用户是否为有效会员 */
        isMember: boolean
        /** 当前可用积分 */
        availablePoints: number
        /** 本次需要的积分数 */
        requiredPoints: number
        /** 已累计扣减积分 */
        totalPointsConsumed: number
        /** 已累计使用 token 数 */
        totalTokensConsumed: number
        /** 中断原因类型 */
        reason: 'no_membership' | 'insufficient_points' | 'service_error'
    }
}

/** 联合类型：所有中断数据类型 */
export type TypedInterruptData =
    | CaseInfoCheckInterruptData
    | BasicInfoConfirmInterruptData
    | ModuleSelectInterruptData
    | InsufficientPointsInterruptData

// ==================== 分析模块接口 ====================

/** 分析模块信息接口 */
export interface AnalysisModuleInfo {
    nodeId: number
    name: string
    title: string
    type: string
    pointCost: number
    discount?: number
    hasAccess: boolean
}

/** 分析模块（简化版） */
export interface AnalysisModule {
    /** 模块ID（节点ID） */
    id: number
    /** 模块名称 */
    name: string
    /** 模块描述 */
    description?: string
}

/** 分析结果接口 */
export interface AnalysisResult {
    nodeId: number
    moduleName: string
    moduleTitle: string
    content: string
    analyzedAt: string
    /** 版本号 */
    version?: number
}

/** 分析模块展示状态 */
export type AnalysisModuleDisplayStatus = 'complete' | 'in_progress' | 'idle' | 'failed'

/** 分析模块卡片数据（四态 + 锁定） */
export interface AnalysisModuleCard {
    moduleName: string
    moduleTitle: string
    status: AnalysisModuleDisplayStatus
    /** 是否被 init-analysis 流程锁定 */
    locked?: boolean
    /** status=complete 时有值 */
    content?: string
    analyzedAt?: string
    version?: number
}

// ==================== API 类型 ====================

/** 创建案件输入 */
export interface CreateCaseInput {
    /** 案件标题（可选，未提供时自动生成） */
    title?: string
    /** 案件内容/描述 */
    content?: string | null
    /** 用户 ID */
    userId: number
    /** 案件类型 ID */
    caseTypeId: number
    /** 原告信息 */
    plaintiff?: PartyInfo[] | null
    /** 被告信息 */
    defendant?: PartyInfo[] | null
    /** 是否为示范案件 */
    isDemo?: boolean
    /** 案件材料（可选） */
    materials?: CaseMaterialParam[]
    /** 案件概述（AI 提取） */
    summary?: string | null
    /** AI 提取的扩展字段 */
    extractedInfo?: ExtraField[] | null
}

/** 更新案件输入 */
export interface UpdateCaseInput {
    /** 案件标题 */
    title?: string
    /** 案件内容/描述 */
    content?: string | null
    /** 案件类型 ID */
    caseTypeId?: number
    /** 原告信息 */
    plaintiff?: PartyInfo[] | null
    /** 被告信息 */
    defendant?: PartyInfo[] | null
    /** 案件状态 */
    status?: number
    /** 法院名称 */
    courtName?: string | null
    /** 一审案件编号 */
    firstInstanceCaseNo?: string | null
    /** 二审案件编号 */
    secondInstanceCaseNo?: string | null
    /** 一审法官姓名 */
    firstInstanceJudge?: string | null
    /** 二审法官姓名 */
    secondInstanceJudge?: string | null
}

/** 案件列表查询参数 */
export interface CaseListParams {
    /** 页码 */
    page?: number
    /** 每页数量 */
    pageSize?: number
    /** 用户 ID */
    userId?: number
    /** 案件类型 ID */
    caseTypeId?: number
    /** 案件状态 */
    status?: number
    /** 是否为示范案件 */
    isDemo?: boolean
    /** 关键词搜索 */
    keyword?: string
    /** 排序字段 */
    orderBy?: 'id' | 'title' | 'createdAt' | 'updatedAt'
    /** 排序方向 */
    orderDir?: 'asc' | 'desc'
}

/** 会话类型枚举 */
export enum SessionType {
    /** 普通对话 */
    NORMAL = 1,
    /** 初始化分析 */
    INIT_ANALYSIS = 2,
    /** 模块对话 */
    MODULE_CHAT = 3,
}

/** 创建会话输入 */
export interface CreateSessionInput {
    /** 会话唯一标识（对应 LangGraph thread_id） */
    sessionId: string
    /** 案件 ID */
    caseId: number
    /** 会话状态 */
    status?: number
    /** 会话类型 */
    type?: number
    /** 会话元数据 */
    metadata?: Record<string, unknown>
}

/** 示范案例文件材料（与 server DemoCaseMaterial 结构同步） */
export interface DemoCaseFileMaterial {
  name: string
  type: 2 | 3 | 4
  sourceOssFileId: number
}

/** 示范案例列表项（GET /api/v1/demo-cases 返回） */
export interface DemoCaseListItem {
  id: number
  title: string
  /** 案例简介（admin 填写的短描述，可能为空） */
  description: string | null
  /** 卡片预览文本：description 优先，否则从 content 截取前 120 字符（后端计算） */
  preview: string | null
  /** 预设文件材料数量（不含文本内容） */
  materialCount: number
  caseTypeId: number
  caseTypeName: string
  coverImage: string | null
  priority: number
}

/** 示范案例 prepare 响应 */
export interface DemoCasePrepareResponse {
  content: string | null
  files: OssFileDto[]
}
