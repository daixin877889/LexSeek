/**
 * Agent 事件与会话相关枚举。
 *
 * 这些枚举在阶段 1 引入，作为 AI 基建统一改造的底座类型层。
 * 所有 session.scope / session.type / SSE custom event / interrupt 字面量
 * 在后续阶段会逐步替换为这里的枚举。
 *
 * @see docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md §3.4 §A.B
 */

import type { ContractReviewEvent, RiskLevel } from './contract'

/**
 * 会话域：caseSessions.scope 的取值。
 * 用于 agentWorker 路由分流，决定调度到哪个 Agent。
 */
export enum SessionScope {
    /** 案件域：含小索 / 模块对话 / 案件初分 */
    CASE = 'case',
    /** 通用问答域：跨案件全局通用助手 */
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
    /**
     * 子代理思考 token 流。LangChain handleLLMNewToken 的 token 参数对 Anthropic
     * thinking 块和 DeepSeek/OpenAI o1 的 reasoning_content 都不暴露 — 必须从第 6
     * 参数 fields.chunk 解析。前端累到 AIMessage.additional_kwargs.reasoning_content，
     * extractThinking 走格式 3 直接渲染"思考"step。
     */
    SUB_AGENT_THINKING_TOKEN = 'sub_agent_thinking_token',
    SUB_AGENT_TOOL_START = 'sub_agent_tool_start',
    SUB_AGENT_TOOL_END = 'sub_agent_tool_end',
    SUB_AGENT_STATUS = 'sub_agent_status',

    // ── 业务结果落库通知 ──
    ANALYSIS_RESULT_SAVED = 'analysis_result_saved',
    /**
     * 模块分析摘要生成进度（合成工具卡片）。
     *
     * 由 saveAnalysisResult 工具在 DB 落库后发出 phase:'start'，
     * await completeAnalysisWithRAG 完成后发出 phase:'end'。
     * 前端 useStreamChat 拦截后注入合成 toolCall 到 parentMessageId 对应的 AIMessage，
     * 让用户看到一张"正在生成结果摘要…"工具卡片，与 save_analysis_result 卡片并列。
     */
    ANALYSIS_SUMMARY = 'analysis_summary',
    /** 阶段 5：文书草稿落库通知 */
    DRAFT_SAVED = 'draft_saved',
    DRAFT_UPDATED = 'draft_updated',
    /** 阶段 5：合同审查结果落库通知 */
    CONTRACT_REVIEW_SAVED = 'contract_review_saved',

    // ── 合同审查阶段事件（contractReviewStageEmitter 发布）──
    /**
     * 合同审查阶段总线事件 — 实际运行时使用，name='contract_review'，
     * data 是 ContractReviewEvent 判别联合（含 stage/risk/progress 三种 type 的子事件）。
     */
    CONTRACT_REVIEW = 'contract_review',
    /** 子事件枚举值（保留供未来拆分使用，当前未直接发布）*/
    CONTRACT_STAGE = 'contract_stage',
    CONTRACT_RISK = 'contract_risk',
    CONTRACT_PROGRESS = 'contract_progress',

    /**
     * 材料就绪保底进度事件（中间件等待期间发出）。
     *
     * 由 caseProcessMaterialMiddleware 在等待识别+200 字摘要双就绪期间发出
     * phase:'start'/'progress'/'end'。前端 useStreamChat 拦截后合成
     * process_materials 同款 toolCall（toolCallId='prepare-${runId}'），
     * 复用 MaterialProcessTool.vue 渲染。
     */
    PREPARE_MATERIALS = 'prepare_materials',

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

/**
 * 合成工具卡片名称常量。
 *
 * "合成"指卡片不是 LLM 主动调起的真实工具，而是后端通过 SSE 事件让前端渲染出工具卡片样式的进度展示。
 * 字面量被 useStreamChat（前端）和 saveAnalysisResult.tool（后端）两端共用，必须在共享类型层定义。
 */
export const SYNTHETIC_TOOL_GENERATE_SUMMARY = 'generate_summary' as const

/**
 * 摘要生成阶段事件 payload（合成工具卡片驱动数据）。
 *
 * - phase='start'：DB 落库完成，开始 await completeAnalysisWithRAG
 * - phase='end' + success=true：摘要 + embedding 全部完成
 * - phase='end' + success=false：摘要生成或 embedding 写入失败
 *   （注意：save 工具仍会返回 success；摘要失败只是次要功能降级）
 */
export type AnalysisSummaryPayload =
    | {
        phase: 'start'
        toolCallId: string
        parentMessageId: string
        analysisId: number
    }
    | {
        phase: 'end'
        toolCallId: string
        parentMessageId: string
        analysisId: number
        success: true
        summary: string
    }
    | {
        phase: 'end'
        toolCallId: string
        parentMessageId: string
        analysisId: number
        success: false
        error: string
    }

export interface DraftSavedPayload {
    draftId: number
    summary: string
    title?: string
    href: string
}

/** DRAFT_UPDATED event payload(update_document_draft 工具发) */
export interface DraftUpdatedPayload {
    draftId: number
    changedFields: string[]
    summary: string
}

export interface ContractReviewSavedPayload {
    reviewId: number
    riskCount: number
    topRisks: Array<{ title?: string; level?: RiskLevel }>
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
    level: RiskLevel
    source: string
    /** SSE 推送增量风险卡时携带的完整条款原文（前端展示用，等价于 contractRisks.clauseText） */
    clauseText?: string
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

/** 材料项状态（保底进度卡片用） */
export type PrepareMaterialStatus = 'pending' | 'recognizing' | 'summarizing' | 'ready' | 'failed'

/**
 * 单条材料状态（不携带 type 字段——前端渲染只用 name + status）
 *
 * 注：`material.ts` 已有 `MaterialItem`（前端上传态，含 file/content/needServerProcess）
 * 与 `MaterialProcessTool.vue` 局部 `MaterialItem`（卡片渲染用）。三者语义不同，
 * 此处加 `Prepare` 前缀强调专属 PrepareMaterials SSE 事件。
 */
export interface PrepareMaterialItem {
    id: number
    name: string
    status: PrepareMaterialStatus
}

/** PREPARE_MATERIALS payload */
export type PrepareMaterialsPayload =
    | { phase: 'start';    toolCallId: string; materials: PrepareMaterialItem[] }
    | { phase: 'progress'; toolCallId: string; materials: PrepareMaterialItem[] }
    | { phase: 'end';      toolCallId: string; materials: PrepareMaterialItem[]; failedCount: number }

/**
 * SSE 自定义事件类型 → payload 类型映射。
 * publishCustomEvent<T> 用此映射做编译期类型校验。
 */
export interface SSECustomEventMap {
    [SSECustomEventType.SUB_AGENT_TOKEN]: SubAgentTokenPayload
    /** 复用 SubAgentTokenPayload 形状，metadata 含 messageId/delta（同 SUB_AGENT_TOKEN） */
    [SSECustomEventType.SUB_AGENT_THINKING_TOKEN]: SubAgentTokenPayload
    [SSECustomEventType.SUB_AGENT_TOOL_START]: SubAgentToolStartPayload
    [SSECustomEventType.SUB_AGENT_TOOL_END]: SubAgentToolEndPayload
    [SSECustomEventType.SUB_AGENT_STATUS]: SubAgentStatusPayload
    [SSECustomEventType.ANALYSIS_RESULT_SAVED]: AnalysisResultSavedPayload
    [SSECustomEventType.ANALYSIS_SUMMARY]: AnalysisSummaryPayload
    [SSECustomEventType.DRAFT_SAVED]: DraftSavedPayload
    [SSECustomEventType.DRAFT_UPDATED]: DraftUpdatedPayload
    [SSECustomEventType.CONTRACT_REVIEW_SAVED]: ContractReviewSavedPayload
    [SSECustomEventType.CONTRACT_REVIEW]: ContractReviewEvent
    [SSECustomEventType.CONTRACT_STAGE]: ContractStagePayload
    [SSECustomEventType.CONTRACT_RISK]: ContractRiskPayload
    [SSECustomEventType.CONTRACT_PROGRESS]: ContractProgressPayload
    [SSECustomEventType.CHILD_AGENT_INVOKED]: ChildAgentInvokedPayload
    [SSECustomEventType.PREPARE_MATERIALS]: PrepareMaterialsPayload
}

/**
 * Interrupt 类型。
 *
 * 用于 LangGraph workflow / Agent 中断恢复机制：
 * - 后端：interrupt({ type: InterruptType.X, ... }) 抛出 GraphInterrupt
 * - 前端：根据 interrupt.type 查 InterruptRegistry 渲染对应 handler 组件（阶段 7 完成）
 *
 * 阶段 1 仅引入枚举，**不**强制替换现有字符串字面量。后续阶段在搬迁业务 vertical 时
 * 顺便完成替换。
 */
export enum InterruptType {
    /** 积分不足，需充值 */
    INSUFFICIENT_POINTS = 'insufficient_points',
    /** 非会员，需开通会员 */
    NEED_MEMBERSHIP = 'need_membership',
    /** 案件基本信息确认（initAnalysis）*/
    BASIC_INFO_CONFIRM = 'basic_info_confirm',
    /** 案件信息复核（小索 / 模块对话）*/
    CASE_INFO_CHECK = 'case_info_check',
    /** 选择分析模块（initAnalysis）*/
    MODULE_SELECT = 'module_select',
    /** 合同审查立场选择（旧值；运行时未使用，保留以兼容已记录的 spec / 测试断言） */
    CONTRACT_STANCE = 'contract_stance',
    /** 合同审查立场选择 — 实际运行时值（reviewContract.tool 透传给前端 StanceSelectCard） */
    STANCE_SELECT = 'stance_select',
    /** 文书模板选择 — 实际运行时值（draftDocument.tool 透传给前端 TemplateSelectCard） */
    TEMPLATE_SELECT = 'template_select',
    /** 案件信息提取确认 */
    EXTRACT_CASE_INFO = 'extract_case_info',
}
