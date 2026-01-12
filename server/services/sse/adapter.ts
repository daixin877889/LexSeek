/**
 * AI SDK 适配器服务
 *
 * 使用 @ai-sdk/langchain 的 toUIMessageStream 转换 LangGraph 流式数据
 * 使用 ai 包的 createUIMessageStreamResponse 创建 SSE 响应
 *
 * 该适配器作为 LangGraph 工作流和前端 AI SDK 组件之间的桥梁，
 * 将 LangGraph 的流式输出转换为 AI SDK 可消费的格式
 *
 * @see Requirements 12.3, 12.4, 7.4, 7.5
 * @see design.md - LangGraph 工作流与 AI SDK 适配器集成
 */

import { toUIMessageStream, toBaseMessages } from '@ai-sdk/langchain'
import { createUIMessageStreamResponse, type UIMessage } from 'ai'
import type { H3Event } from 'h3'
import type { BaseMessage } from '@langchain/core/messages'
import { InterruptType } from '#shared/types/case'
import { logger } from '#shared/utils/logger'

/**
 * LangGraph 中断信息接口
 *
 * 当工作流执行到 interrupt() 时返回的中断信息结构
 *
 * @see Requirements 7.4
 */
export interface LangGraphInterrupt {
    /** 中断携带的值（传递给 interrupt() 的参数） */
    value: Record<string, unknown>
    /** 是否可恢复 */
    resumable: boolean
    /** 中断发生的节点命名空间 */
    ns: string[]
    /** 中断发生的时机 */
    when?: 'during' | 'after'
}

/**
 * 解析后的中断数据接口
 *
 * 从 LangGraph 中断信息中提取的结构化数据
 *
 * @see Requirements 7.4
 */
export interface ParsedInterruptData {
    /** 中断类型 */
    type: InterruptType
    /** 中断消息 */
    message: string
    /** 中断携带的数据 */
    data: Record<string, unknown>
    /** 是否可恢复 */
    resumable: boolean
    /** 中断发生的节点 */
    node: string
}

/**
 * 工作流执行结果接口（包含可能的中断信息）
 */
export interface WorkflowExecutionResult {
    /** 工作流状态 */
    state: Record<string, unknown>
    /** 中断信息（如果工作流被中断） */
    interrupt?: ParsedInterruptData
    /** 是否被中断 */
    isInterrupted: boolean
}

/**
 * LangGraph 流式数据类型
 *
 * LangGraph 的 stream() 方法返回的 AsyncIterable
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LangGraphStream = AsyncIterable<any> | ReadableStream<any>

/**
 * 流式响应配置
 */
export interface StreamResponseConfig {
    /** 是否启用调试日志 */
    debug?: boolean
    /** 自定义响应头 */
    headers?: Record<string, string>
}

/**
 * 将 LangGraph 流转换为 AI SDK UIMessageStream
 *
 * 使用 @ai-sdk/langchain 的 toUIMessageStream 函数
 * 自动识别流类型（直接模型流或 LangGraph 流）
 *
 * @param stream LangGraph 流式数据
 * @returns AI SDK UIMessageStream
 *
 * @example
 * ```typescript
 * const graphStream = await graph.stream(
 *     { messages: langchainMessages },
 *     { streamMode: ['values', 'messages'] }
 * )
 * const uiStream = convertToUIMessageStream(graphStream)
 * ```
 */
export function convertToUIMessageStream(stream: LangGraphStream) {
    return toUIMessageStream(stream)
}

/**
 * 将 AI SDK UIMessages 转换为 LangChain BaseMessages
 *
 * 使用 @ai-sdk/langchain 的 toBaseMessages 函数
 * 用于将前端发送的消息转换为 LangGraph 可处理的格式
 *
 * @param messages AI SDK UIMessage 数组
 * @returns LangChain BaseMessage 数组
 *
 * @example
 * ```typescript
 * const uiMessages: UIMessage[] = await req.json()
 * const langchainMessages = await convertToLangChainMessages(uiMessages)
 * const stream = await graph.stream({ messages: langchainMessages })
 * ```
 */
export async function convertToLangChainMessages(
    messages: UIMessage[]
): Promise<BaseMessage[]> {
    return toBaseMessages(messages)
}

/**
 * 创建 AI SDK 流式响应
 *
 * 使用 ai 包的 createUIMessageStreamResponse 函数
 * 将 UIMessageStream 转换为标准的 SSE 响应
 *
 * @param stream UIMessageStream 流
 * @param config 响应配置
 * @returns Response 对象
 *
 * @example
 * ```typescript
 * const uiStream = convertToUIMessageStream(graphStream)
 * return createStreamResponse(uiStream)
 * ```
 */
export function createStreamResponse(
    stream: ReturnType<typeof toUIMessageStream>,
    config?: StreamResponseConfig
): Response {
    const { headers = {} } = config ?? {}

    return createUIMessageStreamResponse({
        stream,
        headers: {
            'X-Accel-Buffering': 'no', // 禁用 nginx 缓冲
            ...headers,
        },
    })
}

/**
 * 处理 LangGraph 工作流流式输出
 *
 * 完整的流式处理流程：
 * 1. 接收 LangGraph 流
 * 2. 转换为 AI SDK UIMessageStream
 * 3. 创建 SSE 响应
 *
 * @param stream LangGraph 流式数据
 * @param config 响应配置
 * @returns Response 对象
 *
 * @example
 * ```typescript
 * // 在 API 处理函数中
 * export default defineEventHandler(async (event) => {
 *     const workflow = await getCaseAnalysisWorkflow()
 *     const stream = await workflow.stream(
 *         initialState,
 *         { configurable: { thread_id: sessionId }, streamMode: ['values', 'messages'] }
 *     )
 *     return handleLangGraphStream(stream)
 * })
 * ```
 */
export function handleLangGraphStream(
    stream: LangGraphStream,
    config?: StreamResponseConfig
): Response {
    const { debug = false } = config ?? {}

    if (debug) {
        logger.debug('处理 LangGraph 流式输出')
    }

    // 转换为 AI SDK UIMessageStream
    const uiStream = convertToUIMessageStream(stream)

    // 创建 SSE 响应
    return createStreamResponse(uiStream, config)
}

/**
 * 从请求中提取 UIMessages 并转换为 LangChain 格式
 *
 * 用于处理前端发送的聊天消息
 *
 * @param event H3 事件对象
 * @returns LangChain BaseMessage 数组
 *
 * @example
 * ```typescript
 * export default defineEventHandler(async (event) => {
 *     const langchainMessages = await extractAndConvertMessages(event)
 *     const stream = await graph.stream({ messages: langchainMessages })
 *     return handleLangGraphStream(stream)
 * })
 * ```
 */
export async function extractAndConvertMessages(
    event: H3Event
): Promise<BaseMessage[]> {
    const body = await readBody(event)
    const messages: UIMessage[] = body.messages ?? []

    if (messages.length === 0) {
        logger.warn('请求中没有消息')
        return []
    }

    return convertToLangChainMessages(messages)
}

/**
 * 创建带中断处理的流式响应
 *
 * 在流式输出中处理 LangGraph 的 interrupt 事件
 * 当检测到 __interrupt__ 字段时，会在流中包含中断信息
 *
 * @param stream LangGraph 流式数据
 * @param config 响应配置
 * @returns Response 对象
 *
 * @see Requirements 7.4, 7.5
 */
export function handleLangGraphStreamWithInterrupt(
    stream: LangGraphStream,
    config?: StreamResponseConfig
): Response {
    // toUIMessageStream 会自动处理 LangGraph 的中断事件
    // 中断信息会作为流的一部分传递给前端
    return handleLangGraphStream(stream, config)
}

/**
 * 检查工作流执行结果是否包含中断
 *
 * 当使用 invoke() 而非 stream() 时，检查返回结果中的 __interrupt__ 字段
 *
 * @param result 工作流执行结果
 * @returns 是否包含中断
 *
 * @see Requirements 7.4
 */
export function hasInterrupt(result: Record<string, unknown>): boolean {
    return '__interrupt__' in result && Array.isArray(result.__interrupt__) && result.__interrupt__.length > 0
}

/**
 * 从工作流执行结果中提取中断信息
 *
 * 解析 __interrupt__ 字段，提取中断类型、消息和数据
 *
 * @param result 工作流执行结果
 * @returns 解析后的中断数据，如果没有中断则返回 null
 *
 * @see Requirements 7.4
 *
 * @example
 * ```typescript
 * const result = await workflow.invoke(state, config)
 * const interrupt = extractInterruptData(result)
 * if (interrupt) {
 *     // 处理中断
 *     console.log('中断类型:', interrupt.type)
 *     console.log('中断消息:', interrupt.message)
 * }
 * ```
 */
export function extractInterruptData(result: Record<string, unknown>): ParsedInterruptData | null {
    if (!hasInterrupt(result)) {
        return null
    }

    const interrupts = result.__interrupt__ as LangGraphInterrupt[]
    const interrupt = interrupts[0] // 通常只有一个中断

    if (!interrupt || !interrupt.value) {
        return null
    }

    // 从中断值中提取类型和消息
    const value = interrupt.value
    const type = (value.type as InterruptType) || InterruptType.CASE_INFO_CHECK
    const message = (value.message as string) || ''

    // 提取节点名称（从命名空间中获取）
    const node = interrupt.ns?.[0]?.split(':')[0] || 'unknown'

    // 移除 type 和 message 后的其他数据
    const { type: _type, message: _message, ...data } = value

    return {
        type,
        message,
        data: data as Record<string, unknown>,
        resumable: interrupt.resumable,
        node,
    }
}

/**
 * 处理工作流执行结果（包含中断检测）
 *
 * 统一处理工作流执行结果，自动检测和提取中断信息
 *
 * @param result 工作流执行结果
 * @returns 处理后的执行结果
 *
 * @see Requirements 7.4
 *
 * @example
 * ```typescript
 * const result = await workflow.invoke(state, config)
 * const processed = processWorkflowResult(result)
 *
 * if (processed.isInterrupted) {
 *     // 发送中断事件给前端
 *     await sendInterruptEvent(connection, processed.interrupt)
 * } else {
 *     // 继续处理正常结果
 * }
 * ```
 */
export function processWorkflowResult(result: Record<string, unknown>): WorkflowExecutionResult {
    const interrupt = extractInterruptData(result)

    // 移除 __interrupt__ 字段，返回干净的状态
    const { __interrupt__, ...state } = result

    return {
        state,
        interrupt: interrupt ?? undefined,
        isInterrupted: interrupt !== null,
    }
}

/**
 * 创建中断响应数据
 *
 * 将解析后的中断数据转换为前端可消费的格式
 * 用于通过 SSE 发送给前端
 *
 * @param interrupt 解析后的中断数据
 * @returns 前端可消费的中断响应数据
 *
 * @see Requirements 7.4
 */
export function createInterruptResponse(interrupt: ParsedInterruptData): {
    type: string
    message: string
    data: Record<string, unknown>
    resumable: boolean
    node: string
} {
    return {
        type: interrupt.type,
        message: interrupt.message,
        data: interrupt.data,
        resumable: interrupt.resumable,
        node: interrupt.node,
    }
}

/**
 * 验证中断类型是否有效
 *
 * @param type 中断类型字符串
 * @returns 是否为有效的中断类型
 */
export function isValidInterruptType(type: string): type is InterruptType {
    return Object.values(InterruptType).includes(type as InterruptType)
}

/**
 * 根据中断类型获取中断处理器名称
 *
 * 用于前端根据中断类型显示对应的交互界面
 *
 * @param type 中断类型
 * @returns 处理器名称
 *
 * @see Requirements 7.4
 */
export function getInterruptHandlerName(type: InterruptType): string {
    const handlerMap: Record<InterruptType, string> = {
        [InterruptType.CASE_INFO_CHECK]: 'CaseInfoCheckHandler',
        [InterruptType.BASIC_INFO_CONFIRM]: 'BasicInfoConfirmHandler',
        [InterruptType.MODULE_SELECT]: 'ModuleSelectHandler',
    }
    return handlerMap[type] || 'DefaultInterruptHandler'
}

/**
 * 流式模式配置
 *
 * LangGraph stream() 方法支持的流式模式
 */
export const STREAM_MODES = {
    /** 仅输出值变化 */
    VALUES: 'values',
    /** 输出消息 */
    MESSAGES: 'messages',
    /** 输出更新 */
    UPDATES: 'updates',
    /** 输出调试信息 */
    DEBUG: 'debug',
} as const

/**
 * 推荐的流式模式配置
 *
 * 用于 LangGraph stream() 方法的 streamMode 参数
 * 同时输出 values 和 messages 以获取完整的流式信息
 */
export const RECOMMENDED_STREAM_MODE = [STREAM_MODES.VALUES, STREAM_MODES.MESSAGES] as const

/**
 * 创建 LangGraph 流式配置
 *
 * @param threadId 线程 ID（对应 sessionId）
 * @param recursionLimit 递归限制（可选，默认 50）
 * @returns LangGraph 流式配置对象
 *
 * @example
 * ```typescript
 * const config = createLangGraphStreamConfig('session-123')
 * const stream = await workflow.stream(state, config)
 * ```
 */
export function createLangGraphStreamConfig(
    threadId: string,
    recursionLimit = 50
): {
    configurable: { thread_id: string }
    recursionLimit: number
    streamMode: readonly ['values', 'messages']
} {
    return {
        configurable: {
            thread_id: threadId,
        },
        recursionLimit,
        streamMode: RECOMMENDED_STREAM_MODE,
    }
}

/**
 * 中断恢复数据接口
 *
 * 用于恢复工作流时传递的数据结构
 *
 * @see Requirements 7.5
 */
export interface InterruptResumeData {
    /** 中断类型 */
    interruptType: InterruptType
    /** 用户提交的数据 */
    userInput: unknown
}

/**
 * 创建恢复命令配置
 *
 * 用于创建 LangGraph Command(resume=...) 所需的配置
 *
 * @param threadId 线程 ID（对应 sessionId）
 * @returns LangGraph 配置对象
 *
 * @see Requirements 7.5
 *
 * @example
 * ```typescript
 * import { Command } from '@langchain/langgraph'
 *
 * const config = createResumeConfig('session-123')
 * const result = await workflow.invoke(new Command({ resume: userInput }), config)
 * ```
 */
export function createResumeConfig(threadId: string): {
    configurable: { thread_id: string }
} {
    return {
        configurable: {
            thread_id: threadId,
        },
    }
}

/**
 * 验证恢复数据格式
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

        default:
            return userInput
    }
}

/**
 * 日志记录中断事件
 *
 * 记录中断事件的详细信息，用于调试和监控
 *
 * @param interrupt 中断数据
 * @param context 上下文信息
 */
export function logInterruptEvent(
    interrupt: ParsedInterruptData,
    context: { sessionId: string; caseId?: number }
): void {
    logger.info('工作流中断', {
        sessionId: context.sessionId,
        caseId: context.caseId,
        interruptType: interrupt.type,
        node: interrupt.node,
        resumable: interrupt.resumable,
        message: interrupt.message.slice(0, 100), // 截取前 100 字符
    })
}

/**
 * 日志记录恢复事件
 *
 * 记录工作流恢复的详细信息
 *
 * @param interruptType 中断类型
 * @param context 上下文信息
 */
export function logResumeEvent(
    interruptType: InterruptType,
    context: { sessionId: string; caseId?: number }
): void {
    logger.info('工作流恢复', {
        sessionId: context.sessionId,
        caseId: context.caseId,
        interruptType,
    })
}
