/**
 * LangGraph 工作流状态定义
 *
 * 定义案件分析工作流的状态类型和初始状态
 * 工作流包含 3 个中断点：
 * 1. 案情信息检查（循环检查-补充）
 * 2. 基本信息确认（用户确认/修改）
 * 3. 模块选择（用户选择分析模块）
 *
 * @see Requirements 1.1
 * @see design.md - LangGraph 工作流架构
 */

import { Annotation, messagesStateReducer } from '@langchain/langgraph'
import type { BaseMessage } from '@langchain/core/messages'
import {
    InterruptType,
    WorkflowPhase,
    type AnalysisModuleInfo,
    type AnalysisResult,
    type InterruptData,
} from '#shared/types/case'

// 注意：InterruptType, WorkflowPhase, AnalysisModuleInfo, AnalysisResult, InterruptData
// 已在 shared/types/case.ts 中定义，请直接从那里导入，不要从此文件导入

/**
 * 材料信息接口
 */
export interface MaterialInfo {
    /** 材料 ID */
    id: number
    /** 材料名称 */
    name: string
    /** 材料类型：1-文本，2-文档，3-图片，4-音频 */
    type: number
    /** 材料内容 */
    content: string
}

/**
 * 通用 reducer：使用新值覆盖旧值（如果新值存在）
 */
const replaceReducer = <T>(current: T, update: T): T => (update !== undefined ? update : current)

/**
 * 数组 reducer：合并数组
 */
const arrayReducer = <T>(current: T[], update: T[]): T[] => [...current, ...update]

/**
 * 案件分析工作流状态注解
 *
 * 使用 LangGraph Annotation 定义工作流状态
 * messages 字段使用 messagesStateReducer 支持消息累积
 */
export const CaseAnalysisAnnotation = Annotation.Root({
    // ==================== 消息历史 ====================
    /** 对话消息历史（使用 messagesStateReducer 累积） */
    messages: Annotation<BaseMessage[]>({
        reducer: messagesStateReducer,
        default: () => [],
    }),

    // ==================== 用户和案件标识 ====================
    /** 用户 ID */
    userId: Annotation<number>,
    /** 案件 ID */
    caseId: Annotation<number>,
    /** 会话 ID（对应 LangGraph thread_id） */
    sessionId: Annotation<string>,
    /** 案件类型 ID */
    caseTypeId: Annotation<number>,

    // ==================== 材料相关 ====================
    /** 案件材料列表 */
    materials: Annotation<MaterialInfo[]>({
        reducer: replaceReducer,
        default: () => [],
    }),
    /** 聚合后的材料内容 */
    aggregatedContent: Annotation<string>({
        reducer: replaceReducer,
        default: () => '',
    }),

    // ==================== 案情信息检查（中断点1） ====================
    /** 案情信息是否充足 */
    caseInfoSufficient: Annotation<boolean>({
        reducer: replaceReducer,
        default: () => false,
    }),
    /** 案情信息检查结果/提示 */
    caseInfoCheckResult: Annotation<string>({
        reducer: replaceReducer,
        default: () => '',
    }),
    /** 用户补充的案情信息 */
    supplementedCaseInfo: Annotation<string>({
        reducer: replaceReducer,
        default: () => '',
    }),

    // ==================== 基本信息提取（中断点2） ====================
    /** 案件标题 */
    title: Annotation<string>({
        reducer: replaceReducer,
        default: () => '',
    }),
    /** 原告列表 */
    plaintiff: Annotation<string[]>({
        reducer: replaceReducer,
        default: () => [],
    }),
    /** 被告列表 */
    defendant: Annotation<string[]>({
        reducer: replaceReducer,
        default: () => [],
    }),
    /** 案件类型名称 */
    caseTypeName: Annotation<string>({
        reducer: replaceReducer,
        default: () => '',
    }),
    /** 案件摘要 */
    summary: Annotation<string>({
        reducer: replaceReducer,
        default: () => '',
    }),
    /** 用户是否已确认基本信息 */
    basicInfoConfirmed: Annotation<boolean>({
        reducer: replaceReducer,
        default: () => false,
    }),

    // ==================== 模块选择（中断点3） ====================
    /** 可用的分析模块列表 */
    availableModules: Annotation<AnalysisModuleInfo[]>({
        reducer: replaceReducer,
        default: () => [],
    }),
    /** 用户选择的模块名称列表 */
    selectedModules: Annotation<string[]>({
        reducer: replaceReducer,
        default: () => [],
    }),

    // ==================== 分析任务执行 ====================
    /** 当前执行的模块索引 */
    currentModuleIndex: Annotation<number>({
        reducer: replaceReducer,
        default: () => 0,
    }),
    /** 分析结果列表（累积） */
    analysisResults: Annotation<AnalysisResult[]>({
        reducer: arrayReducer,
        default: () => [],
    }),
    /** 最近执行的模块名称 */
    lastExecutedModule: Annotation<string>({
        reducer: replaceReducer,
        default: () => '',
    }),
    /** 最近执行的模块结果 */
    lastExecutedResult: Annotation<string>({
        reducer: replaceReducer,
        default: () => '',
    }),
    /** 最近执行的模块标题 */
    lastExecutedTitle: Annotation<string>({
        reducer: replaceReducer,
        default: () => '',
    }),

    // ==================== 工作流控制 ====================
    /** 当前工作流阶段 */
    currentPhase: Annotation<WorkflowPhase>({
        reducer: replaceReducer,
        default: () => WorkflowPhase.MATERIAL_PROCESS,
    }),
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

/**
 * 工作流状态类型
 */
export type CaseAnalysisState = typeof CaseAnalysisAnnotation.State

/**
 * 工作流状态更新类型（部分更新）
 */
export type CaseAnalysisStateUpdate = Partial<CaseAnalysisState>

/**
 * 创建初始工作流状态
 *
 * @param params 初始化参数
 * @returns 初始工作流状态
 */
export function createInitialState(params: {
    userId: number
    caseId: number
    sessionId: string
    caseTypeId: number
    materials?: MaterialInfo[]
}): CaseAnalysisStateUpdate {
    return {
        // 用户和案件标识
        userId: params.userId,
        caseId: params.caseId,
        sessionId: params.sessionId,
        caseTypeId: params.caseTypeId,

        // 材料
        materials: params.materials ?? [],
        aggregatedContent: '',

        // 消息历史
        messages: [],

        // 案情信息检查
        caseInfoSufficient: false,
        caseInfoCheckResult: '',
        supplementedCaseInfo: '',

        // 基本信息
        title: '',
        plaintiff: [],
        defendant: [],
        caseTypeName: '',
        summary: '',
        basicInfoConfirmed: false,

        // 模块选择
        availableModules: [],
        selectedModules: [],

        // 分析任务
        currentModuleIndex: 0,
        analysisResults: [],
        lastExecutedModule: '',
        lastExecutedResult: '',
        lastExecutedTitle: '',

        // 工作流控制
        currentPhase: WorkflowPhase.MATERIAL_PROCESS,
        isComplete: false,
        error: null,
    }
}

/**
 * 创建中断数据
 *
 * @param type 中断类型
 * @param message 中断消息
 * @param data 附加数据
 * @param resumable 是否可恢复，默认 true
 * @param node 中断节点名称，默认空字符串
 * @returns 中断数据对象
 */
export function createInterruptData(
    type: InterruptType,
    message: string,
    data?: Record<string, unknown>,
    resumable: boolean = true,
    node: string = ''
): InterruptData {
    return {
        type,
        message,
        data: data ?? {},
        resumable,
        node,
    }
}

/**
 * 检查工作流是否处于指定阶段
 *
 * @param state 工作流状态
 * @param phase 目标阶段
 * @returns 是否处于指定阶段
 */
export function isInPhase(state: CaseAnalysisState, phase: WorkflowPhase): boolean {
    return state.currentPhase === phase
}

/**
 * 检查工作流是否已完成
 *
 * @param state 工作流状态
 * @returns 是否已完成
 */
export function isWorkflowComplete(state: CaseAnalysisState): boolean {
    return state.isComplete || state.currentPhase === WorkflowPhase.COMPLETE
}

/**
 * 检查工作流是否有错误
 *
 * @param state 工作流状态
 * @returns 是否有错误
 */
export function hasWorkflowError(state: CaseAnalysisState): boolean {
    return state.error !== null
}

/**
 * 获取下一个待执行的模块
 *
 * @param state 工作流状态
 * @returns 下一个模块名称，如果没有则返回 null
 */
export function getNextModule(state: CaseAnalysisState): string | null {
    const { selectedModules, currentModuleIndex } = state
    if (currentModuleIndex >= selectedModules.length) {
        return null
    }
    return selectedModules[currentModuleIndex]
}

/**
 * 检查是否所有模块都已执行完成
 *
 * @param state 工作流状态
 * @returns 是否所有模块都已完成
 */
export function areAllModulesComplete(state: CaseAnalysisState): boolean {
    return state.currentModuleIndex >= state.selectedModules.length
}
