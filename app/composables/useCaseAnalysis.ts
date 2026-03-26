/**
 * 案件分析 SSE 客户端 composable
 *
 * 实现与后端 SSE 服务的实时通信，处理工作流消息和中断事件
 * 支持工作流的启动、恢复和状态管理
 *
 * @see Requirements 7.1, 7.2, 7.3
 * @see design.md - SSE 流式通信
 */

import type { Ref } from 'vue'
import {
    SSEMessageType,
    InterruptType,
    WorkflowPhase,
    type SSEMessage,
    type InterruptData,
    type CaseInfoCheckInterruptData,
    type BasicInfoConfirmInterruptData,
    type ModuleSelectInterruptData,
    type AnalysisModuleInfo,
    type AnalysisResult,
    type InsufficientPointsInterruptData,
} from '#shared/types/case'

// 注意：类型请直接从 #shared/types/case 导入，避免重复导出警告

/**
 * 中断类型对应的映射常量
 */
const INTERRUPT_PHASE_MAP: Record<InterruptType, WorkflowPhase> = {
    [InterruptType.CASE_INFO_CHECK]: WorkflowPhase.CASE_INFO_CHECK,
    [InterruptType.BASIC_INFO_CONFIRM]: WorkflowPhase.EXTRACT_INFO,
    [InterruptType.MODULE_SELECT]: WorkflowPhase.MODULE_SELECT,
    [InterruptType.INSUFFICIENT_POINTS]: WorkflowPhase.ANALYSIS_TASK,
}

const INTERRUPT_TASK_ID_MAP: Record<InterruptType, string> = {
    [InterruptType.CASE_INFO_CHECK]: 'case-info-check',
    [InterruptType.BASIC_INFO_CONFIRM]: 'basic-info-confirm',
    [InterruptType.MODULE_SELECT]: 'module-select',
    [InterruptType.INSUFFICIENT_POINTS]: 'insufficient-points',
}

const INTERRUPT_TASK_TITLE_MAP: Record<string, string> = {
    'case-info-check': '案情信息检查',
    'basic-info-confirm': '基本信息确认',
    'module-select': '选择分析模块',
    'insufficient-points': '积分充值',
}

/**
 * 工具调用信息接口
 */
export interface ToolCallInfo {
    toolName: string
    toolCallId: string
    args?: Record<string, unknown>
    result?: unknown
    status: 'calling' | 'completed' | 'error'
}

/**
 * SSE 任务状态接口（与 shared/types/case-analysis.ts 中的 TaskStatus 不同）
 * 用于 SSE 消息中的任务状态跟踪
 */
export interface SSETaskStatus {
    taskName: string
    taskTitle: string
    status: 'pending' | 'running' | 'completed' | 'error'
    content?: string
    result?: unknown
}

/**
 * 案件分析状态接口
 */
export interface CaseAnalysisState {
    /** 是否已连接 */
    isConnected: boolean
    /** 是否正在加载 */
    isLoading: boolean
    /** 是否处于中断状态 */
    isInterrupted: boolean
    /** 是否已完成 */
    isComplete: boolean
    /** 当前工作流阶段 */
    currentPhase: WorkflowPhase | null
    /** 当前中断数据 */
    currentInterrupt: InterruptData | null
    /** 错误信息 */
    error: string | null
    /** 消息列表 */
    messages: SSEMessage[]
    /** 当前流式文本 */
    streamingText: string
    /** 当前推理内容 */
    reasoningText: string
    /** 工具调用列表 */
    toolCalls: ToolCallInfo[]
    /** 任务状态列表 */
    tasks: SSETaskStatus[]
    /** 分析结果列表 */
    analysisResults: AnalysisResult[]
}

/**
 * 案件分析配置接口
 */
export interface CaseAnalysisConfig {
    /** 案件 ID */
    caseId: number
    /** 会话 ID（可选，不指定则使用最新会话或创建新会话） */
    sessionId?: string
    /** 是否强制创建新会话 */
    forceNewSession?: boolean
    /** 恢复数据（用于从中断点恢复） */
    resumeData?: unknown
}

/**
 * 案件分析 composable 返回值接口
 */
export interface UseCaseAnalysisReturn {
    /** 状态 */
    state: Ref<CaseAnalysisState>
    /** 启动分析 */
    startAnalysis: (config: CaseAnalysisConfig) => Promise<void>
    /** 恢复工作流（从中断点继续） */
    resumeWorkflow: (resumeData: unknown) => Promise<void>
    /** 停止分析 */
    stopAnalysis: () => void
    /** 重置状态 */
    reset: () => void
    /** 清除错误 */
    clearError: () => void
}

/**
 * 创建初始状态
 */
function createInitialState(): CaseAnalysisState {
    return {
        isConnected: false,
        isLoading: false,
        isInterrupted: false,
        isComplete: false,
        currentPhase: null,
        currentInterrupt: null,
        error: null,
        messages: [],
        streamingText: '',
        reasoningText: '',
        toolCalls: [],
        tasks: [],
        analysisResults: [],
    }
}

/**
 * 案件分析 SSE 客户端 composable
 *
 * 提供与后端 SSE 服务的实时通信功能
 *
 * @returns 案件分析相关的状态和方法
 *
 * @example
 * ```vue
 * <script setup>
 * const { state, startAnalysis, resumeWorkflow, stopAnalysis } = useCaseAnalysis()
 *
 * // 启动分析
 * await startAnalysis({ caseId: 123 })
 *
 * // 监听中断事件
 * watch(() => state.value.isInterrupted, (interrupted) => {
 *     if (interrupted && state.value.currentInterrupt) {
 *         // 处理中断，显示对应的交互界面
 *     }
 * })
 *
 * // 恢复工作流
 * await resumeWorkflow({ modules: ['case_summary', 'timeline'] })
 * </script>
 * ```
 */
export function useCaseAnalysis(): UseCaseAnalysisReturn {
    // 状态
    const state = ref<CaseAnalysisState>(createInitialState())

    // 当前配置
    let currentConfig: CaseAnalysisConfig | null = null

    // EventSource 实例
    let eventSource: EventSource | null = null

    // AbortController 用于取消 fetch 请求
    let abortController: AbortController | null = null

    /**
     * 解析 SSE 消息
     */
    function parseSSEMessage(data: string): SSEMessage | null {
        try {
            // SSE 消息格式可能是 "data: {...}" 或直接是 "{...}"
            let jsonStr = data
            if (data.startsWith('data:')) {
                jsonStr = data.slice(5).trim()
            }
            if (!jsonStr || jsonStr === '[DONE]') {
                return null
            }
            return JSON.parse(jsonStr) as SSEMessage
        } catch {
            console.warn('解析 SSE 消息失败:', data)
            return null
        }
    }

    /**
     * 处理中断事件
     *
     * 解析 __interrupt__ 字段，更新状态并触发对应的 UI 交互
     *
     * @see Requirements 7.4, 7.5
     */
    function handleInterrupt(message: SSEMessage): void {
        const interruptData = message.data?.__interrupt__ as InterruptData | undefined
        if (interruptData) {
            state.value.isInterrupted = true
            state.value.currentInterrupt = interruptData
            state.value.isLoading = false

            // 根据中断类型更新当前阶段
            updatePhaseFromInterrupt(interruptData.type)

            // 更新任务清单状态
            updateTaskStatusFromInterrupt(interruptData.type)

            console.log('收到中断事件:', interruptData.type, interruptData.message)
        }
    }

    /**
     * 根据中断类型更新当前工作流阶段
     *
     * @param interruptType 中断类型
     */
    function updatePhaseFromInterrupt(interruptType: InterruptType): void {
        state.value.currentPhase = INTERRUPT_PHASE_MAP[interruptType] || state.value.currentPhase
    }

    /**
     * 根据中断类型更新任务清单状态
     *
     * @param interruptType 中断类型
     */
    function updateTaskStatusFromInterrupt(interruptType: InterruptType): void {
        const taskId = INTERRUPT_TASK_ID_MAP[interruptType]
        if (taskId) {
            const existingTask = state.value.tasks.find(t => t.taskName === taskId)
            if (existingTask) {
                existingTask.status = 'running'
            } else {
                state.value.tasks.push({
                    taskName: taskId,
                    taskTitle: INTERRUPT_TASK_TITLE_MAP[taskId] || taskId,
                    status: 'running',
                })
            }
        }
    }

    /**
     * 处理任务开始事件
     */
    function handleTaskStart(message: SSEMessage): void {
        const { taskName, taskTitle } = message.data || {}
        if (taskName && taskTitle) {
            // 更新或添加任务状态
            const existingIndex = state.value.tasks.findIndex(t => t.taskName === taskName)
            const taskStatus: SSETaskStatus = {
                taskName: taskName as string,
                taskTitle: taskTitle as string,
                status: 'running',
            }

            if (existingIndex >= 0) {
                state.value.tasks[existingIndex] = taskStatus
            } else {
                state.value.tasks.push(taskStatus)
            }
        }
    }

    /**
     * 处理任务进度事件
     */
    function handleTaskProgress(message: SSEMessage): void {
        const { taskName } = message.data || {}
        // 累积流式文本
        state.value.streamingText += message.message

        // 更新任务内容
        if (taskName) {
            const task = state.value.tasks.find(t => t.taskName === taskName)
            if (task) {
                task.content = (task.content || '') + message.message
            }
        }
    }

    /**
     * 处理任务完成事件
     */
    function handleTaskComplete(message: SSEMessage): void {
        const { taskName, result } = message.data || {}
        if (taskName) {
            const task = state.value.tasks.find(t => t.taskName === taskName)
            if (task) {
                task.status = 'completed'
                task.result = result
            }
        }

        // 清空流式文本
        state.value.streamingText = ''
    }

    /**
     * 处理文本增量事件
     */
    function handleTextDelta(message: SSEMessage): void {
        state.value.streamingText += message.message
    }

    /**
     * 处理推理事件
     */
    function handleReasoning(message: SSEMessage): void {
        state.value.reasoningText += message.message
    }

    /**
     * 处理工具调用事件
     */
    function handleToolCall(message: SSEMessage): void {
        const { toolName, toolCallId, args } = message.data || {}
        if (toolName && toolCallId) {
            state.value.toolCalls.push({
                toolName: toolName as string,
                toolCallId: toolCallId as string,
                args: args as Record<string, unknown> | undefined,
                status: 'calling',
            })
        }
    }

    /**
     * 处理工具结果事件
     */
    function handleToolResult(message: SSEMessage): void {
        const { toolCallId, result } = message.data || {}
        if (toolCallId) {
            const toolCall = state.value.toolCalls.find(t => t.toolCallId === toolCallId)
            if (toolCall) {
                toolCall.result = result
                toolCall.status = 'completed'
            }
        }
    }

    /**
     * 处理工作流完成事件
     */
    function handleWorkflowComplete(message: SSEMessage): void {
        state.value.isComplete = true
        state.value.isLoading = false
        state.value.currentPhase = WorkflowPhase.COMPLETE

        // 提取分析结果
        const results = message.data?.analysisResults as AnalysisResult[] | undefined
        if (results) {
            state.value.analysisResults = results
        }
    }

    /**
     * 处理错误事件
     */
    function handleError(message: SSEMessage): void {
        state.value.error = message.message
        state.value.isLoading = false
    }

    /**
     * 处理 SSE 消息
     */
    function handleSSEMessage(message: SSEMessage): void {
        // 添加到消息列表
        state.value.messages.push(message)

        // 根据消息类型处理
        switch (message.type) {
            case SSEMessageType.CONNECTED:
                state.value.isConnected = true
                break

            case SSEMessageType.WORKFLOW_START:
                state.value.isLoading = true
                state.value.currentPhase = (message.data?.currentPhase as WorkflowPhase) || WorkflowPhase.MATERIAL_PROCESS
                break

            case SSEMessageType.WORKFLOW_COMPLETE:
                handleWorkflowComplete(message)
                break

            case SSEMessageType.WORKFLOW_ERROR:
            case SSEMessageType.ERROR:
                handleError(message)
                break

            case SSEMessageType.INTERRUPT:
                handleInterrupt(message)
                break

            case SSEMessageType.TASK_START:
                handleTaskStart(message)
                break

            case SSEMessageType.TASK_PROGRESS:
                handleTaskProgress(message)
                break

            case SSEMessageType.TASK_COMPLETE:
                handleTaskComplete(message)
                break

            case SSEMessageType.TEXT_DELTA:
                handleTextDelta(message)
                break

            case SSEMessageType.REASONING:
                handleReasoning(message)
                break

            case SSEMessageType.TOOL_CALL:
                handleToolCall(message)
                break

            case SSEMessageType.TOOL_RESULT:
                handleToolResult(message)
                break

            case SSEMessageType.INFO:
                // 处理信息消息，更新当前阶段
                if (message.data?.currentPhase) {
                    state.value.currentPhase = message.data.currentPhase as WorkflowPhase
                }
                break

            case SSEMessageType.HEARTBEAT:
                // 心跳消息，不做处理
                break

            case SSEMessageType.CLOSED:
                state.value.isConnected = false
                break

            default:
                console.log('未处理的消息类型:', message.type)
        }
    }

    /**
     * 启动 SSE 连接
     */
    async function startSSEConnection(config: CaseAnalysisConfig): Promise<void> {
        // 关闭现有连接
        stopAnalysis()

        currentConfig = config
        state.value.isLoading = true
        state.value.error = null

        // 创建 AbortController
        abortController = new AbortController()

        try {
            // 使用 fetch 发起 POST 请求建立 SSE 连接
            const response = await fetch(`/api/v1/case/analysis/stream/${config.caseId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'text/event-stream',
                },
                body: JSON.stringify({
                    sessionId: config.sessionId,
                    forceNewSession: config.forceNewSession,
                    resumeData: config.resumeData,
                }),
                signal: abortController.signal,
            })

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}))
                throw new Error(errorData.message || `请求失败: ${response.status}`)
            }

            if (!response.body) {
                throw new Error('响应体为空')
            }

            // 读取 SSE 流
            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''

            while (true) {
                const { done, value } = await reader.read()

                if (done) {
                    state.value.isConnected = false
                    // 如果流结束时仍在加载状态，说明没有收到完成或错误消息
                    if (state.value.isLoading && !state.value.isComplete && !state.value.isInterrupted) {
                        state.value.isLoading = false
                    }
                    break
                }

                // 解码数据
                buffer += decoder.decode(value, { stream: true })

                // 按行分割处理
                const lines = buffer.split('\n')
                buffer = lines.pop() || '' // 保留最后一个不完整的行

                for (const line of lines) {
                    const trimmedLine = line.trim()
                    if (!trimmedLine) continue

                    // 解析 SSE 消息
                    const message = parseSSEMessage(trimmedLine)
                    if (message) {
                        handleSSEMessage(message)
                    }
                }
            }
        } catch (error: unknown) {
            if (error instanceof Error && error.name === 'AbortError') {
                // 请求被取消，不做处理
                return
            }

            const errorMessage = error instanceof Error ? error.message : '连接失败'
            state.value.error = errorMessage
            state.value.isLoading = false
            console.error('SSE 连接错误:', error)
        }
    }

    /**
     * 启动分析
     */
    async function startAnalysis(config: CaseAnalysisConfig): Promise<void> {
        // 重置状态
        reset()
        await startSSEConnection(config)
    }

    /**
     * 恢复工作流
     *
     * 从中断点继续执行工作流，支持数据验证
     *
     * @param resumeData 恢复数据
     * @throws 如果没有活跃的分析会话或数据验证失败
     *
     * @see Requirements 7.5
     */
    async function resumeWorkflow(resumeData: unknown): Promise<void> {
        if (!currentConfig) {
            throw new Error('没有活跃的分析会话')
        }

        // 验证恢复数据
        const currentInterrupt = state.value.currentInterrupt
        if (currentInterrupt) {
            const validation = validateResumeData(currentInterrupt.type, resumeData)
            if (!validation.valid) {
                throw new Error(validation.error || '恢复数据验证失败')
            }

            // 格式化恢复数据
            resumeData = formatResumeData(currentInterrupt.type, resumeData)

            // 更新任务状态为已完成
            updateTaskStatusOnResume(currentInterrupt.type)
        }

        // 清除中断状态
        state.value.isInterrupted = false
        state.value.currentInterrupt = null
        state.value.streamingText = ''
        state.value.reasoningText = ''

        // 使用恢复数据重新连接
        await startSSEConnection({
            ...currentConfig,
            resumeData,
        })
    }

    /**
     * 恢复工作流时更新任务状态
     *
     * @param interruptType 中断类型
     */
    function updateTaskStatusOnResume(interruptType: InterruptType): void {
        const taskIdMap: Record<InterruptType, string> = {
            [InterruptType.CASE_INFO_CHECK]: 'case-info-check',
            [InterruptType.BASIC_INFO_CONFIRM]: 'basic-info-confirm',
            [InterruptType.MODULE_SELECT]: 'module-select',
            [InterruptType.INSUFFICIENT_POINTS]: 'insufficient-points',
        }

        const taskId = taskIdMap[interruptType]
        if (taskId) {
            const task = state.value.tasks.find(t => t.taskName === taskId)
            if (task) {
                task.status = 'completed'
            }
        }
    }

    /**
     * 停止分析
     */
    function stopAnalysis(): void {
        // 取消 fetch 请求
        if (abortController) {
            abortController.abort()
            abortController = null
        }

        // 关闭 EventSource
        if (eventSource) {
            eventSource.close()
            eventSource = null
        }

        state.value.isConnected = false
        state.value.isLoading = false
    }

    /**
     * 重置状态
     */
    function reset(): void {
        stopAnalysis()
        state.value = createInitialState()
        currentConfig = null
    }

    /**
     * 清除错误
     */
    function clearError(): void {
        state.value.error = null
    }

    // 组件卸载时清理
    onUnmounted(() => {
        stopAnalysis()
    })

    return {
        state,
        startAnalysis,
        resumeWorkflow,
        stopAnalysis,
        reset,
        clearError,
    }
}

/**
 * 获取中断处理器名称
 *
 * 根据中断类型返回对应的处理器组件名称
 *
 * @param type 中断类型
 * @returns 处理器组件名称
 */
export function getInterruptHandlerName(type: InterruptType): string {
    const handlerMap: Record<InterruptType, string> = {
        [InterruptType.CASE_INFO_CHECK]: 'CaseInfoCheckHandler',
        [InterruptType.BASIC_INFO_CONFIRM]: 'BasicInfoConfirmHandler',
        [InterruptType.MODULE_SELECT]: 'ModuleSelectHandler',
        [InterruptType.INSUFFICIENT_POINTS]: 'InsufficientPointsHandler',
    }
    return handlerMap[type] || 'DefaultInterruptHandler'
}

/**
 * 格式化中断消息
 *
 * 根据中断类型返回用户友好的提示消息
 *
 * @param type 中断类型
 * @returns 格式化后的消息
 */
export function formatInterruptMessage(type: InterruptType): string {
    const messageMap: Record<InterruptType, string> = {
        [InterruptType.CASE_INFO_CHECK]: '请补充案情信息',
        [InterruptType.BASIC_INFO_CONFIRM]: '请确认案件基本信息',
        [InterruptType.MODULE_SELECT]: '请选择要执行的分析模块',
        [InterruptType.INSUFFICIENT_POINTS]: '积分不足，请充值后继续',
    }
    return messageMap[type] || '请处理中断请求'
}

/**
 * 类型守卫：检查是否为案情信息检查中断
 *
 * @param interrupt 中断数据
 * @returns 是否为案情信息检查中断
 */
export function isCaseInfoCheckInterrupt(
    interrupt: InterruptData | null
): interrupt is CaseInfoCheckInterruptData {
    return interrupt?.type === InterruptType.CASE_INFO_CHECK
}

/**
 * 类型守卫：检查是否为基本信息确认中断
 *
 * @param interrupt 中断数据
 * @returns 是否为基本信息确认中断
 */
export function isBasicInfoConfirmInterrupt(
    interrupt: InterruptData | null
): interrupt is BasicInfoConfirmInterruptData {
    return interrupt?.type === InterruptType.BASIC_INFO_CONFIRM
}

/**
 * 类型守卫：检查是否为模块选择中断
 *
 * @param interrupt 中断数据
 * @returns 是否为模块选择中断
 */
export function isModuleSelectInterrupt(
    interrupt: InterruptData | null
): interrupt is ModuleSelectInterruptData {
    return interrupt?.type === InterruptType.MODULE_SELECT
}

/**
 * 类型守卫：检查是否为积分不足中断
 *
 * @param interrupt 中断数据
 * @returns 是否为积分不足中断
 */
export function isInsufficientPointsInterrupt(
    interrupt: InterruptData | null
): interrupt is InsufficientPointsInterruptData {
    return interrupt?.type === InterruptType.INSUFFICIENT_POINTS
}

/**
 * 从中断数据中提取案情检查结果
 *
 * @param interrupt 中断数据
 * @returns 案情检查结果，如果不是案情检查中断则返回 null
 */
export function extractCaseInfoCheckResult(interrupt: InterruptData | null): {
    checkResult: CaseInfoCheckInterruptData['data']['checkResult']
    materialSummary: string
} | null {
    if (!isCaseInfoCheckInterrupt(interrupt)) {
        return null
    }
    return {
        checkResult: interrupt.data.checkResult,
        materialSummary: interrupt.data.materialSummary,
    }
}

/**
 * 从中断数据中提取基本信息
 *
 * @param interrupt 中断数据
 * @returns 提取的基本信息，如果不是基本信息确认中断则返回 null
 */
export function extractBasicInfo(interrupt: InterruptData | null): {
    extractedInfo: BasicInfoConfirmInterruptData['data']['extractedInfo']
    caseTypeId: number
    caseTypeName: string
} | null {
    if (!isBasicInfoConfirmInterrupt(interrupt)) {
        return null
    }
    return {
        extractedInfo: interrupt.data.extractedInfo,
        caseTypeId: interrupt.data.caseTypeId,
        caseTypeName: interrupt.data.caseTypeName,
    }
}

/**
 * 从中断数据中提取模块选择信息
 *
 * @param interrupt 中断数据
 * @returns 模块选择信息，如果不是模块选择中断则返回 null
 */
export function extractModuleSelectInfo(interrupt: InterruptData | null): {
    availableModules: AnalysisModuleInfo[]
    userAvailablePoints: number
    hasEnoughPoints: boolean
} | null {
    if (!isModuleSelectInterrupt(interrupt)) {
        return null
    }
    return {
        availableModules: interrupt.data.availableModules,
        userAvailablePoints: interrupt.data.userAvailablePoints,
        hasEnoughPoints: interrupt.data.hasEnoughPoints,
    }
}

/**
 * 验证中断恢复数据
 *
 * 根据中断类型验证用户提交的恢复数据是否符合预期格式
 *
 * @param interruptType 中断类型
 * @param userInput 用户输入
 * @returns 验证结果
 *
 * @see Requirements 7.5
 */
export function validateResumeData(
    interruptType: InterruptType,
    userInput: unknown
): { valid: boolean; error?: string } {
    if (userInput === undefined || userInput === null) {
        return { valid: false, error: '恢复数据不能为空' }
    }

    switch (interruptType) {
        case InterruptType.CASE_INFO_CHECK:
            // 案情信息检查：期望字符串类型的补充信息
            if (typeof userInput !== 'string' || userInput.trim() === '') {
                return { valid: false, error: '请提供案情补充信息' }
            }
            return { valid: true }

        case InterruptType.BASIC_INFO_CONFIRM:
            // 基本信息确认：期望字符串（确认）或对象（修改后的信息）
            if (typeof userInput === 'string') {
                return { valid: true }
            }
            if (typeof userInput === 'object') {
                const info = userInput as Record<string, unknown>
                if (!info.title && !info.plaintiff && !info.defendant) {
                    return { valid: false, error: '请提供有效的基本信息' }
                }
                return { valid: true }
            }
            return { valid: false, error: '基本信息格式无效' }

        case InterruptType.MODULE_SELECT:
            // 模块选择：期望对象包含 modules 数组
            if (typeof userInput === 'object') {
                const selection = userInput as Record<string, unknown>
                if (Array.isArray(selection.modules) && selection.modules.length > 0) {
                    return { valid: true }
                }
            }
            // 也接受字符串格式（逗号分隔的模块名）
            if (typeof userInput === 'string' && userInput.trim() !== '') {
                return { valid: true }
            }
            return { valid: false, error: '请选择至少一个分析模块' }

        case InterruptType.INSUFFICIENT_POINTS:
            // 积分不足恢复：期望包含 type 字段的对象
            if (typeof userInput === 'object' && userInput !== null) {
                const data = userInput as Record<string, unknown>
                if (data.type === 'points_recharged') {
                    return { valid: true }
                }
            }
            return { valid: false, error: '恢复数据格式无效' }

        default:
            return { valid: true }
    }
}

/**
 * 格式化恢复数据
 *
 * 将用户输入转换为工作流期望的格式
 *
 * @param interruptType 中断类型
 * @param userInput 用户输入
 * @returns 格式化后的数据
 *
 * @see Requirements 7.5
 */
export function formatResumeData(
    interruptType: InterruptType,
    userInput: unknown
): unknown {
    switch (interruptType) {
        case InterruptType.CASE_INFO_CHECK:
            // 案情信息检查：直接返回字符串
            return String(userInput)

        case InterruptType.BASIC_INFO_CONFIRM:
            // 基本信息确认：如果是字符串则直接返回，否则返回对象
            if (typeof userInput === 'string') {
                return userInput
            }
            return userInput

        case InterruptType.MODULE_SELECT:
            // 模块选择：确保返回包含 modules 数组的对象
            if (typeof userInput === 'string') {
                // 将逗号分隔的字符串转换为数组
                const modules = userInput.split(/[,，、]/).map((s) => s.trim()).filter(Boolean)
                return { modules }
            }
            return userInput

        case InterruptType.INSUFFICIENT_POINTS:
            // 积分不足恢复：直接透传
            return userInput

        default:
            return userInput
    }
}

/**
 * 创建案情补充恢复数据
 *
 * @param supplementInfo 补充的案情信息
 * @returns 格式化的恢复数据
 */
export function createCaseInfoResumeData(supplementInfo: string): string {
    return supplementInfo.trim()
}

/**
 * 创建基本信息确认恢复数据
 *
 * @param confirmedInfo 确认或修改后的基本信息
 * @returns 格式化的恢复数据
 */
export function createBasicInfoResumeData(confirmedInfo: {
    title?: string
    plaintiff?: string[]
    defendant?: string[]
    summary?: string
    caseTypeName?: string
} | string): unknown {
    // 如果是简单确认字符串，直接返回
    if (typeof confirmedInfo === 'string') {
        return confirmedInfo
    }
    // 返回修改后的信息对象
    return confirmedInfo
}

/**
 * 创建模块选择恢复数据
 *
 * @param selectedModules 选择的模块名称列表
 * @returns 格式化的恢复数据
 */
export function createModuleSelectResumeData(selectedModules: string[]): { modules: string[] } {
    return { modules: selectedModules }
}
