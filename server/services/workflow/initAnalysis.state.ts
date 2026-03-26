/**
 * 初始化分析 LangGraph 工作流状态定义
 *
 * 定义初始化分析工作流的 State 类型
 * 工作流为单循环节点，串行执行所选模块的分析 Agent
 */

import { Annotation } from '@langchain/langgraph'
import { messagesStateReducer } from '@langchain/langgraph'
import type { BaseMessage } from '@langchain/core/messages'

/**
 * 通用 reducer：使用新值覆盖旧值
 */
const replaceReducer = <T>(current: T, update: T): T =>
    update !== undefined ? update : current

/**
 * Record 合并 reducer：将新的键值对合并到已有的 Record 中
 */
const mergeRecordReducer = (
    existing: Record<string, string>,
    updated: Record<string, string>,
): Record<string, string> => ({ ...existing, ...updated })

/**
 * 初始化分析工作流状态注解
 *
 * 状态包含：标识信息、模块配置、结果累积、控制标志
 */
export const InitAnalysisAnnotation = Annotation.Root({
    // ==================== 消息历史 ====================
    /** 对话消息历史（用于 Agent 对话） */
    messages: Annotation<BaseMessage[]>({
        reducer: messagesStateReducer,
        default: () => [],
    }),

    // ==================== 标识 ====================
    /** 用户 ID */
    userId: Annotation<number>,
    /** 案件 ID */
    caseId: Annotation<number>,
    /** 会话 ID（对应 LangGraph thread_id） */
    sessionId: Annotation<string>,

    // ==================== 模块配置 ====================
    /** 用户选择的模块名称列表（固定顺序） */
    selectedModules: Annotation<string[]>({
        reducer: replaceReducer,
        default: () => [],
    }),
    /** 当前执行的模块索引 */
    currentModuleIndex: Annotation<number>({
        reducer: replaceReducer,
        default: () => 0,
    }),

    // ==================== 结果累积 ====================
    /** 已完成模块的结果（后续模块可引用前面结果） */
    completedResults: Annotation<Record<string, string>>({
        reducer: mergeRecordReducer,
        default: () => ({}),
    }),
    /** 失败模块记录 */
    failedModules: Annotation<Record<string, string>>({
        reducer: mergeRecordReducer,
        default: () => ({}),
    }),

    // ==================== 当前模块 ====================
    /** 当前正在执行的模块名（前端用于 Progress Bar） */
    currentModule: Annotation<string>({
        reducer: replaceReducer,
        default: () => '',
    }),

    // ==================== 控制 ====================
    /** 工作流是否完成 */
    isComplete: Annotation<boolean>({
        reducer: replaceReducer,
        default: () => false,
    }),
    /** 错误信息 */
    error: Annotation<string | null>({
        reducer: replaceReducer,
        default: () => null,
    }),
})

/** 工作流状态类型 */
export type InitAnalysisState = typeof InitAnalysisAnnotation.State
