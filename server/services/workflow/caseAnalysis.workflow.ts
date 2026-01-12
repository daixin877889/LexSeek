/**
 * 案件分析工作流
 *
 * 使用 LangGraph StateGraph 组装完整的案件分析工作流
 * 包含 3 个中断点：
 * 1. 案情信息检查（循环检查-补充）
 * 2. 基本信息确认（用户确认/修改）
 * 3. 模块选择（用户选择分析模块）
 *
 * @see Requirements 1.1, 1.5, 1.6, 12.1, 12.2
 * @see design.md - LangGraph 工作流架构
 */

import { StateGraph } from '@langchain/langgraph'
import {
    CaseAnalysisAnnotation,
    type CaseAnalysisState,
} from './state'
import { WorkflowPhase } from '#shared/types/case'
import { getCheckpointer } from './checkpointer'
import {
    materialProcessNode,
    MATERIAL_PROCESS_NODE_NAME,
    caseInfoCheckNode,
    CASE_INFO_CHECK_NODE_NAME,
    extractInfoNode,
    EXTRACT_INFO_NODE_NAME,
    moduleSelectNode,
    MODULE_SELECT_NODE_NAME,
    analysisTaskNode,
    ANALYSIS_TASK_NODE_NAME,
} from './nodes'
import { logger } from '#shared/utils/logger'

/** 工作流编译后的类型 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CaseAnalysisWorkflow = any

/** 全局工作流实例（单例模式） */
let workflowInstance: CaseAnalysisWorkflow | null = null

/** 工作流是否正在初始化 */
let isInitializing = false

/**
 * 材料处理节点后的路由函数
 *
 * 根据材料处理结果决定下一步：
 * - 如果有错误，结束工作流
 * - 如果成功，进入案情信息检查节点
 *
 * @param state 当前工作流状态
 * @returns 下一个节点名称
 */
function routeAfterMaterialProcess(state: typeof CaseAnalysisAnnotation.State): string {
    // 如果有错误，结束工作流
    if (state.error) {
        logger.info('材料处理失败，结束工作流', { error: state.error })
        return '__end__'
    }

    // 进入案情信息检查节点
    return CASE_INFO_CHECK_NODE_NAME
}

/**
 * 案情信息检查节点后的路由函数
 *
 * 根据检查结果决定下一步：
 * - 如果有错误，结束工作流
 * - 如果信息充足，进入基本信息提取节点
 * - 如果信息不足，等待用户补充（通过 interrupt 处理）
 *
 * @param state 当前工作流状态
 * @returns 下一个节点名称
 */
function routeAfterCaseInfoCheck(state: typeof CaseAnalysisAnnotation.State): string {
    // 如果有错误，结束工作流
    if (state.error) {
        logger.info('案情信息检查失败，结束工作流', { error: state.error })
        return '__end__'
    }

    // 如果信息充足，进入基本信息提取节点
    if (state.caseInfoSufficient) {
        return EXTRACT_INFO_NODE_NAME
    }

    // 信息不足的情况由 interrupt 处理，这里不会执行到
    // 但为了类型安全，返回 END
    return '__end__'
}

/**
 * 基本信息提取节点后的路由函数
 *
 * 根据提取结果决定下一步：
 * - 如果有错误，结束工作流
 * - 如果用户已确认，进入模块选择节点
 * - 如果未确认，等待用户确认（通过 interrupt 处理）
 *
 * @param state 当前工作流状态
 * @returns 下一个节点名称
 */
function routeAfterExtractInfo(state: typeof CaseAnalysisAnnotation.State): string {
    // 如果有错误，结束工作流
    if (state.error) {
        logger.info('基本信息提取失败，结束工作流', { error: state.error })
        return '__end__'
    }

    // 如果用户已确认，进入模块选择节点
    if (state.basicInfoConfirmed) {
        return MODULE_SELECT_NODE_NAME
    }

    // 未确认的情况由 interrupt 处理，这里不会执行到
    return '__end__'
}

/**
 * 模块选择节点后的路由函数
 *
 * 根据选择结果决定下一步：
 * - 如果有错误，结束工作流
 * - 如果用户已选择模块，进入分析任务节点
 * - 如果未选择，等待用户选择（通过 interrupt 处理）
 *
 * @param state 当前工作流状态
 * @returns 下一个节点名称
 */
function routeAfterModuleSelect(state: typeof CaseAnalysisAnnotation.State): string {
    // 如果有错误，结束工作流
    if (state.error) {
        logger.info('模块选择失败，结束工作流', { error: state.error })
        return '__end__'
    }

    // 如果用户已选择模块，进入分析任务节点
    if (state.selectedModules.length > 0) {
        return ANALYSIS_TASK_NODE_NAME
    }

    // 未选择的情况由 interrupt 处理，这里不会执行到
    return '__end__'
}

/**
 * 分析任务节点后的路由函数
 *
 * 根据分析结果决定下一步：
 * - 如果有错误，结束工作流
 * - 如果所有模块完成，结束工作流
 * - 如果还有模块未完成，继续执行分析任务节点
 *
 * @param state 当前工作流状态
 * @returns 下一个节点名称
 */
function routeAfterAnalysisTask(state: typeof CaseAnalysisAnnotation.State): string {
    // 如果有错误，结束工作流
    if (state.error) {
        logger.info('分析任务失败，结束工作流', { error: state.error })
        return '__end__'
    }

    // 如果工作流已完成，结束
    if (state.isComplete || state.currentPhase === WorkflowPhase.COMPLETE) {
        logger.info('所有分析任务完成，结束工作流')
        return '__end__'
    }

    // 如果还有模块未完成，继续执行
    if (state.currentModuleIndex < state.selectedModules.length) {
        return ANALYSIS_TASK_NODE_NAME
    }

    // 所有模块完成，结束工作流
    return '__end__'
}

/**
 * 创建案件分析工作流图
 *
 * 使用 StateGraph 定义工作流结构：
 * START -> material_process -> case_info_check -> extract_info -> module_select -> analysis_task -> END
 *
 * @returns StateGraph 实例
 */
function createWorkflowGraph() {
    // 创建 StateGraph
    const graph = new StateGraph(CaseAnalysisAnnotation)
        // 添加节点
        // Requirements 1.1: 使用 StateGraph 定义统一的案件分析流程
        .addNode(MATERIAL_PROCESS_NODE_NAME, materialProcessNode)
        .addNode(CASE_INFO_CHECK_NODE_NAME, caseInfoCheckNode)
        .addNode(EXTRACT_INFO_NODE_NAME, extractInfoNode)
        .addNode(MODULE_SELECT_NODE_NAME, moduleSelectNode)
        .addNode(ANALYSIS_TASK_NODE_NAME, analysisTaskNode)
        // 添加边
        // START -> material_process
        .addEdge('__start__', MATERIAL_PROCESS_NODE_NAME)
        // material_process -> case_info_check 或 END（根据条件）
        .addConditionalEdges(
            MATERIAL_PROCESS_NODE_NAME,
            routeAfterMaterialProcess,
            [CASE_INFO_CHECK_NODE_NAME, '__end__']
        )
        // case_info_check -> extract_info 或 END（根据条件）
        // 注意：interrupt 会在节点内部处理循环
        .addConditionalEdges(
            CASE_INFO_CHECK_NODE_NAME,
            routeAfterCaseInfoCheck,
            [EXTRACT_INFO_NODE_NAME, '__end__']
        )
        // extract_info -> module_select 或 END（根据条件）
        .addConditionalEdges(
            EXTRACT_INFO_NODE_NAME,
            routeAfterExtractInfo,
            [MODULE_SELECT_NODE_NAME, '__end__']
        )
        // module_select -> analysis_task 或 END（根据条件）
        .addConditionalEdges(
            MODULE_SELECT_NODE_NAME,
            routeAfterModuleSelect,
            [ANALYSIS_TASK_NODE_NAME, '__end__']
        )
        // analysis_task -> analysis_task（循环）或 END（根据条件）
        .addConditionalEdges(
            ANALYSIS_TASK_NODE_NAME,
            routeAfterAnalysisTask,
            [ANALYSIS_TASK_NODE_NAME, '__end__']
        )

    return graph
}

/**
 * 获取编译后的案件分析工作流
 *
 * 使用单例模式，确保整个应用只有一个工作流实例
 * 首次调用时会自动编译工作流并配置 checkpointer
 *
 * @returns 编译后的工作流实例
 *
 * @example
 * ```typescript
 * const workflow = await getCaseAnalysisWorkflow()
 *
 * // 启动新的工作流
 * const result = await workflow.invoke(initialState, {
 *     configurable: { thread_id: sessionId }
 * })
 *
 * // 恢复中断的工作流
 * const result = await workflow.invoke(
 *     new Command({ resume: userInput }),
 *     { configurable: { thread_id: sessionId } }
 * )
 * ```
 */
export async function getCaseAnalysisWorkflow(): Promise<CaseAnalysisWorkflow> {
    // 如果已有实例，直接返回
    if (workflowInstance) {
        return workflowInstance
    }

    // 如果正在初始化，等待初始化完成
    if (isInitializing) {
        while (isInitializing) {
            await new Promise(resolve => setTimeout(resolve, 100))
        }
        if (workflowInstance) {
            return workflowInstance
        }
    }

    try {
        isInitializing = true
        logger.info('初始化案件分析工作流...')

        // 获取检查点器
        // Requirements 1.5, 1.6: 配置 PostgresSaver 作为 checkpointer
        const checkpointer = await getCheckpointer()

        // 创建工作流图
        const graph = createWorkflowGraph()

        // 编译工作流，配置 checkpointer
        // Requirements 12.1, 12.2: 使用 StateGraph 组装所有节点
        workflowInstance = graph.compile({
            checkpointer,
            // 启用中断功能
            interruptBefore: [],
            interruptAfter: [],
        })

        logger.info('案件分析工作流初始化完成')

        return workflowInstance
    } catch (error) {
        logger.error('案件分析工作流初始化失败:', error)
        // 重置状态，允许重试
        workflowInstance = null
        throw error
    } finally {
        isInitializing = false
    }
}

/**
 * 重置工作流实例
 *
 * 用于测试或需要重新初始化的场景
 */
export function resetCaseAnalysisWorkflow(): void {
    logger.info('重置案件分析工作流实例')
    workflowInstance = null
    isInitializing = false
}

/**
 * 获取工作流状态
 *
 * @returns 工作流状态信息
 */
export function getWorkflowStatus(): {
    initialized: boolean
    initializing: boolean
} {
    return {
        initialized: workflowInstance !== null,
        initializing: isInitializing,
    }
}

/**
 * 检查工作流是否已初始化
 *
 * @returns 是否已初始化
 */
export function isWorkflowInitialized(): boolean {
    return workflowInstance !== null
}

// ==================== 工作流执行辅助函数 ====================

/**
 * 工作流配置接口
 */
export interface WorkflowConfig {
    /** 线程 ID（对应 sessionId） */
    threadId: string
    /** 递归限制（可选，默认 50） */
    recursionLimit?: number
}

/**
 * 创建工作流配置
 *
 * @param config 配置参数
 * @returns LangGraph 配置对象
 */
export function createWorkflowConfig(config: WorkflowConfig): {
    configurable: { thread_id: string }
    recursionLimit: number
} {
    return {
        configurable: {
            thread_id: config.threadId,
        },
        recursionLimit: config.recursionLimit ?? 50,
    }
}

/**
 * 启动案件分析工作流
 *
 * @param initialState 初始状态
 * @param config 工作流配置
 * @returns 工作流执行结果
 */
export async function startCaseAnalysis(
    initialState: Partial<CaseAnalysisState>,
    config: WorkflowConfig
): Promise<CaseAnalysisState> {
    const workflow = await getCaseAnalysisWorkflow()
    const workflowConfig = createWorkflowConfig(config)

    logger.info('启动案件分析工作流', {
        threadId: config.threadId,
        caseId: initialState.caseId,
        userId: initialState.userId,
    })

    const result = await workflow.invoke(initialState, workflowConfig)
    return result as CaseAnalysisState
}

/**
 * 恢复案件分析工作流
 *
 * @param resumeValue 恢复值（用户输入）
 * @param config 工作流配置
 * @returns 工作流执行结果
 */
export async function resumeCaseAnalysis(
    resumeValue: unknown,
    config: WorkflowConfig
): Promise<CaseAnalysisState> {
    const { Command } = await import('@langchain/langgraph')
    const workflow = await getCaseAnalysisWorkflow()
    const workflowConfig = createWorkflowConfig(config)

    logger.info('恢复案件分析工作流', {
        threadId: config.threadId,
    })

    const result = await workflow.invoke(
        new Command({ resume: resumeValue }),
        workflowConfig
    )
    return result as CaseAnalysisState
}

/**
 * 获取工作流当前状态
 *
 * @param config 工作流配置
 * @returns 当前工作流状态，如果不存在则返回 null
 */
export async function getWorkflowState(
    config: WorkflowConfig
): Promise<CaseAnalysisState | null> {
    const workflow = await getCaseAnalysisWorkflow()
    const workflowConfig = createWorkflowConfig(config)

    try {
        const state = await workflow.getState(workflowConfig)
        return state.values as CaseAnalysisState
    } catch (error) {
        logger.warn('获取工作流状态失败', {
            threadId: config.threadId,
            error: error instanceof Error ? error.message : '未知错误',
        })
        return null
    }
}

/**
 * 获取工作流历史记录
 *
 * @param config 工作流配置
 * @param limit 限制返回的记录数量
 * @returns 工作流历史记录
 */
export async function getWorkflowHistory(
    config: WorkflowConfig,
    limit?: number
): Promise<Array<{ values: CaseAnalysisState; next: string[] }>> {
    const workflow = await getCaseAnalysisWorkflow()
    const workflowConfig = createWorkflowConfig(config)

    const history: Array<{ values: CaseAnalysisState; next: string[] }> = []

    for await (const state of workflow.getStateHistory(workflowConfig)) {
        history.push({
            values: state.values as CaseAnalysisState,
            next: state.next,
        })

        if (limit && history.length >= limit) {
            break
        }
    }

    return history
}

// ==================== 导出节点名称常量 ====================

export {
    MATERIAL_PROCESS_NODE_NAME,
    CASE_INFO_CHECK_NODE_NAME,
    EXTRACT_INFO_NODE_NAME,
    MODULE_SELECT_NODE_NAME,
    ANALYSIS_TASK_NODE_NAME,
}

// 注意：状态相关类型和函数请直接从 './state' 导入
// 避免 Nuxt 自动导入时产生重复警告
