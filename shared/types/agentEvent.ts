/**
 * Agent 事件与会话相关枚举。
 *
 * 这些枚举在阶段 1 引入，作为 AI 基建统一改造的底座类型层。
 * 所有 session.scope / session.type / SSE custom event / interrupt 字面量
 * 在后续阶段会逐步替换为这里的枚举。
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
