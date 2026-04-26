/**
 * Agent 事件与会话相关枚举。
 *
 * 这些枚举在阶段 1 引入，作为 AI 基建统一改造的底座类型层。
 * 所有 session.scope / session.type / SSE custom event / interrupt 字面量
 * 在后续阶段会逐步替换为这里的枚举。
 *
 * @see docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md §3.4 §A.B
 */

/**
 * 会话域：caseSessions.scope 的取值。
 * 用于 agentWorker 路由分流，决定调度到哪个 Agent。
 */
export enum SessionScope {
    /** 案件域：含小索 / 模块对话 / 案件初分 */
    CASE = 'case',
    /** 法律助手域：跨案件全局通用助手 */
    ASSISTANT = 'assistant',
    /** 文书生成域 */
    DOCUMENT = 'document',
    /** 合同审查域 */
    CONTRACT = 'contract',
}

/**
 * 会话类型：caseSessions.type 的取值。
 * 仅在 SessionScope.CASE 域内使用，用于二级路由。
 */
export enum SessionType {
    /** 案件主对话（小索）*/
    CHAT = 1,
    /** 案件初始化分析（StateGraph）*/
    ANALYSIS = 2,
    /** 模块对话 */
    MODULE = 3,
}

/**
 * SSE 自定义事件类型。
 * 由 agentEventBridge.publishCustomEvent 发布，前端通过 useStreamChat 的 onCustomEvent 接收。
 */
export enum SSECustomEventType {
    // ── 子代理工具相关（subAgentToolFactory 发布）──
    SUB_AGENT_TOKEN = 'sub_agent_token',
    SUB_AGENT_TOOL_START = 'sub_agent_tool_start',
    SUB_AGENT_TOOL_END = 'sub_agent_tool_end',
    SUB_AGENT_STATUS = 'sub_agent_status',

    // ── 业务结果落库通知 ──
    ANALYSIS_RESULT_SAVED = 'analysis_result_saved',
    /** 阶段 5：文书草稿落库通知 */
    DRAFT_SAVED = 'draft_saved',
    /** 阶段 5：合同审查结果落库通知 */
    CONTRACT_REVIEW_SAVED = 'contract_review_saved',

    // ── 合同审查阶段事件（contractReviewStageEmitter 发布）──
    CONTRACT_STAGE = 'contract_stage',
    CONTRACT_RISK = 'contract_risk',
    CONTRACT_PROGRESS = 'contract_progress',

    /** 阶段 5/6：主代理调起子代理时通知前端 */
    CHILD_AGENT_INVOKED = 'child_agent_invoked',
}

/** 子代理 token 事件 payload */
export interface SubAgentTokenPayload {
    agentName: string
    token: number
    runningTotal?: number
}

export interface SubAgentToolStartPayload {
    toolCallId: string
    agentName: string
    toolName: string
    args?: unknown
}

export interface SubAgentToolEndPayload {
    toolCallId: string
    agentName: string
    toolName: string
    result?: unknown
}

export interface SubAgentStatusPayload {
    agentName: string
    status: 'running' | 'completed' | 'failed'
    error?: string
}

export interface AnalysisResultSavedPayload {
    moduleName: string
    nodeId: number
    analysisId: number
    summary?: string
}

export interface DraftSavedPayload {
    draftId: number
    summary: string
    title?: string
    href: string
}

export interface ContractReviewSavedPayload {
    reviewId: number
    riskCount: number
    topRisks: Array<{ source: string; level: string; quote?: string }>
    href: string
}

export interface ContractStagePayload {
    stage: 'detect' | 'stance' | 'analyze' | 'summarize'
    progress?: number
    note?: string
}

export interface ContractRiskPayload {
    riskId: number
    code?: string
    level: string
    source: string
    anchorQuote?: string
}

export interface ContractProgressPayload {
    current: number
    total: number
    note?: string
}

export interface ChildAgentInvokedPayload {
    parentAgentName: string
    childAgentName: string
    toolName: string
}

/**
 * SSE 自定义事件类型 → payload 类型映射。
 * publishCustomEvent<T> 用此映射做编译期类型校验。
 */
export interface SSECustomEventMap {
    [SSECustomEventType.SUB_AGENT_TOKEN]: SubAgentTokenPayload
    [SSECustomEventType.SUB_AGENT_TOOL_START]: SubAgentToolStartPayload
    [SSECustomEventType.SUB_AGENT_TOOL_END]: SubAgentToolEndPayload
    [SSECustomEventType.SUB_AGENT_STATUS]: SubAgentStatusPayload
    [SSECustomEventType.ANALYSIS_RESULT_SAVED]: AnalysisResultSavedPayload
    [SSECustomEventType.DRAFT_SAVED]: DraftSavedPayload
    [SSECustomEventType.CONTRACT_REVIEW_SAVED]: ContractReviewSavedPayload
    [SSECustomEventType.CONTRACT_STAGE]: ContractStagePayload
    [SSECustomEventType.CONTRACT_RISK]: ContractRiskPayload
    [SSECustomEventType.CONTRACT_PROGRESS]: ContractProgressPayload
    [SSECustomEventType.CHILD_AGENT_INVOKED]: ChildAgentInvokedPayload
}
