/**
 * 案件相关类型定义
 *
 * 整合了案件、会话、分析等相关类型
 * 供客户端和服务端共用
 */

// ==================== 案件状态枚举 ====================

/** 案件状态枚举 */
export enum CaseStatus {
    /** 进行中 */
    IN_PROGRESS = 1,
    /** 已完成 */
    COMPLETED = 2,
    /** 已关闭 */
    CLOSED = 3,
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

/** 案件状态文本映射 */
export const CaseStatusText: Record<CaseStatus, string> = {
    [CaseStatus.IN_PROGRESS]: '进行中',
    [CaseStatus.COMPLETED]: '已完成',
    [CaseStatus.CLOSED]: '已关闭',
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
}

/** 工作流阶段枚举 */
export enum WorkflowPhase {
    MATERIAL_PROCESS = 'material_process',
    CASE_INFO_CHECK = 'case_info_check',
    EXTRACT_INFO = 'extract_info',
    MODULE_SELECT = 'module_select',
    ANALYSIS_TASK = 'analysis_task',
    COMPLETE = 'complete',
}

// ==================== 任务相关类型 ====================

/** 任务状态 */
export type TaskStatus = 'pending' | 'active' | 'completed'

/** 任务类型 */
export type TaskType = 'checkpoint' | 'analysis'

/** 任务项 */
export interface TaskItem {
    /** 任务ID */
    id: string
    /** 任务名称 */
    name: string
    /** 任务描述（可选） */
    description?: string
    /** 任务类型：中断点或分析模块 */
    type: TaskType
    /** 任务状态 */
    status: TaskStatus
    /** 排序顺序 */
    order: number
    /** 关联的分析结果ID（用于跳转） */
    resultId?: number
    /** 关联的节点ID */
    nodeId?: number
}

/** 预定义的中断点任务 */
export const CHECKPOINT_TASKS: Omit<TaskItem, 'status'>[] = [
    { id: 'case-info-check', name: '案情信息检查', type: 'checkpoint', order: 1 },
    { id: 'basic-info-confirm', name: '基本信息确认', type: 'checkpoint', order: 2 },
    { id: 'module-select', name: '选择分析模块', type: 'checkpoint', order: 3 },
]

/** 中断点ID映射 */
export const INTERRUPT_TASK_MAP: Record<string, string> = {
    case_info_check: 'case-info-check',
    basic_info_confirm: 'basic-info-confirm',
    module_select: 'module-select',
}

// ==================== 案件基本信息接口 ====================

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

/** 联合类型：所有中断数据类型 */
export type TypedInterruptData =
    | CaseInfoCheckInterruptData
    | BasicInfoConfirmInterruptData
    | ModuleSelectInterruptData

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

/** 创建会话输入 */
export interface CreateSessionInput {
    /** 会话唯一标识（对应 LangGraph thread_id） */
    sessionId: string
    /** 案件 ID */
    caseId: number
    /** 会话状态 */
    status?: number
}
