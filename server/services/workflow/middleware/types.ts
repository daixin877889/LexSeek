/**
 * 中间件优先级排序和互斥校验
 *
 * 解决问题：中间件顺序为隐性约定，当前无运行时保障，全靠开发者手动排列。
 *
 * 通过 buildMiddlewareStack 提供：
 * 1. 声明式优先级排序（priority 越小越先执行）
 * 2. 互斥校验（如 caseMaterialContext 和 moduleContext 不能同时挂载）
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
    /** 案件材料预处理（需在材料上下文之前完成） */
    PROCESS_MATERIAL: 10,
    /** 积分消耗（需在实际推理之前扣点） */
    POINT_CONSUMPTION: 20,
    /** 案件材料上下文注入（与 MODULE_CONTEXT 互斥） */
    MATERIAL_CONTEXT: 30,
    /** 模块上下文注入（与 MATERIAL_CONTEXT 互斥） */
    MODULE_CONTEXT: 30,
    /** 摘要压缩（在上下文注入之后、安全截断之前） */
    SUMMARIZATION: 40,
    /** 安全截断兜底（summarization 的最后防线） */
    SAFETY_TRIM: 50,
    /** Skills 发现和加载（wrapModelCall 注入 prompt） */
    SKILLS_DISCOVERY: 60,
    /** 待办列表中间件 */
    TODO_LIST: 80,
    /** 分析结果持久化（必须最后执行） */
    RESULT_PERSISTENCE: 90,
} as const

/** 中间件名称常量，统一命名避免硬编码 */
export const MIDDLEWARE_NAMES = {
    PROCESS_MATERIAL: 'caseProcessMaterial',
    POINT_CONSUMPTION: 'pointConsumption',
    MATERIAL_CONTEXT: 'caseMaterialContext',
    MODULE_CONTEXT: 'moduleContext',
    SUMMARIZATION: 'summarization',
    SAFETY_TRIM: 'safetyTrim',
    SKILLS_DISCOVERY: 'skillsDiscovery',
    TODO_LIST: 'todoList',
    RESULT_PERSISTENCE: 'analysisResultPersistence',
    /** 合同审查结果持久化（与 RESULT_PERSISTENCE 语义对等，独立 agent 使用） */
    REVIEW_RESULT_PERSISTENCE: 'reviewResultPersistence',
} as const

/**
 * 构建中间件执行栈
 *
 * 根据 priority 升序排列中间件，并校验互斥规则。
 *
 * @param items - 带优先级的中间件列表
 * @returns 排序后的中间件数组，可直接传入 createAgent({ middleware })
 * @throws 互斥中间件同时挂载时抛出错误
 */
export function buildMiddlewareStack(items: MiddlewareWithPriority[]): AgentMiddleware[] {
    // 互斥校验：caseMaterialContext 和 moduleContext 不能同时挂载
    const hasMaterial = items.some(i => i.name === MIDDLEWARE_NAMES.MATERIAL_CONTEXT)
    const hasModule = items.some(i => i.name === MIDDLEWARE_NAMES.MODULE_CONTEXT)
    if (hasMaterial && hasModule) {
        throw new Error(
            `${MIDDLEWARE_NAMES.MATERIAL_CONTEXT} 和 ${MIDDLEWARE_NAMES.MODULE_CONTEXT} 不能同时挂载，`
            + '它们提供互斥的上下文注入策略',
        )
    }

    // 按 priority 升序排列（相同优先级保持注册顺序）
    const sorted = [...items].sort((a, b) => a.priority - b.priority)

    logger.debug('中间件执行顺序', {
        order: sorted.map(i => `${i.name}(${i.priority})`),
    })

    return sorted.map(i => i.middleware)
}
