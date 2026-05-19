/**
 * 中间件优先级排序
 *
 * 解决问题：中间件顺序为隐性约定，当前无运行时保障，全靠开发者手动排列。
 * 通过 buildMiddlewareStack 提供声明式优先级排序（priority 越小越先执行）。
 */

import type { AgentMiddleware } from 'langchain'

/** 带优先级的中间件描述 */
export interface MiddlewareWithPriority {
    /** 中间件实例 */
    middleware: AgentMiddleware
    /** 优先级，越小越先执行 */
    priority: number
    /** 中间件名称，用于日志和互斥校验 */
    name: string
}

/**
 * 中间件优先级常量
 *
 * 数值越小越先执行，相同优先级的中间件按注册顺序执行。
 * 间隔为 10 方便后续插入新中间件。
 */
export const MIDDLEWARE_PRIORITY = {
    /** 消息完整性兜底（必须最最前，补齐 orphan tool_use 防 Provider 400） */
    MESSAGE_INTEGRITY: 1,
    /** Agent 安全：scope 校验（最前，拒绝的调用不占后续资源） */
    SCOPE_GUARD: 5,
    /** Agent 安全：工具调用次数熔断（spread 多实例） */
    TOOL_CALL_LIMIT: 7,
    /** 案件材料预处理（需在上下文注入之前完成） */
    PROCESS_MATERIAL: 10,
    /** 积分消耗（需在实际推理之前扣点） */
    POINT_CONSUMPTION: 20,
    /** 案件上下文注入（5 段式：档案 + 模块摘要 + 召回记忆 + 材料清单） */
    MODULE_CONTEXT: 30,
    /** 摘要压缩（在上下文注入之后、安全截断之前） */
    SUMMARIZATION: 40,
    /** 安全截断兜底（summarization 的最后防线） */
    SAFETY_TRIM: 50,
    /** Skills 发现和加载（wrapModelCall 注入 prompt） */
    SKILLS_DISCOVERY: 60,
    /** 用户每轮注入（user_injection 类型 prompt → wrapModelCall 临时插入 HumanMessage） */
    USER_INJECTION: 70,
    /** 待办列表中间件 */
    TODO_LIST: 80,
    /** 分析结果持久化（必须最后执行） */
    RESULT_PERSISTENCE: 90,
    /** Agent 安全：审计归档（必须最后，能捕获前两者拒绝/熔断的结果） */
    AUDIT: 100,
} as const

/** 中间件名称常量，统一命名避免硬编码 */
export const MIDDLEWARE_NAMES = {
    MESSAGE_INTEGRITY: 'messageIntegrity',
    SCOPE_GUARD: 'scopeGuard',
    TOOL_CALL_LIMIT: 'toolCallLimit',
    PROCESS_MATERIAL: 'caseProcessMaterial',
    ASSISTANT_PROCESS_MATERIAL: 'assistantProcessMaterial',
    POINT_CONSUMPTION: 'pointConsumption',
    MODULE_CONTEXT: 'caseContext',
    SUMMARIZATION: 'summarization',
    SAFETY_TRIM: 'safetyTrim',
    SKILLS_DISCOVERY: 'skillsDiscovery',
    USER_INJECTION: 'userInjection',
    TODO_LIST: 'todoList',
    RESULT_PERSISTENCE: 'analysisResultPersistence',
    /** 合同审查结果持久化（与 RESULT_PERSISTENCE 语义对等，独立 agent 使用） */
    REVIEW_RESULT_PERSISTENCE: 'reviewResultPersistence',
    AUDIT: 'audit',
} as const

/**
 * 构建中间件执行栈
 *
 * 根据 priority 升序排列中间件。
 *
 * @param items - 带优先级的中间件列表
 * @returns 排序后的中间件数组，可直接传入 createAgent({ middleware })
 */
export function buildMiddlewareStack(items: MiddlewareWithPriority[]): AgentMiddleware[] {
    // 按 priority 升序排列（相同优先级保持注册顺序）
    const sorted = [...items].sort((a, b) => a.priority - b.priority)

    logger.debug('中间件执行顺序', {
        order: sorted.map(i => `${i.name}(${i.priority})`),
    })

    return sorted.map(i => i.middleware)
}
