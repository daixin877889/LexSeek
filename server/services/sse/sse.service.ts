/**
 * SSE 服务端
 *
 * 实现 Server-Sent Events 连接管理和流式数据发送
 * 用于案件分析工作流的实时通信
 *
 * @see Requirements 7.1, 7.2
 * @see design.md - SSE 流式通信
 */

import type { H3Event } from 'h3'
import { createEventStream, setResponseHeader } from 'h3'
import { logger } from '#shared/utils/logger'
import { SSEMessageType, type SSEMessage } from '#shared/types/case'

/**
 * SSE 连接配置
 */
export interface SSEConnectionConfig {
    /** 心跳间隔（毫秒），默认 30000 */
    heartbeatInterval?: number
    /** 是否启用心跳，默认 true */
    enableHeartbeat?: boolean
    /** 连接超时（毫秒），默认 0 表示不超时 */
    connectionTimeout?: number
}

/**
 * SSE 连接实例
 */
export interface SSEConnection {
    /** 连接 ID */
    id: string
    /** 事件流 */
    eventStream: ReturnType<typeof createEventStream>
    /** 心跳定时器 */
    heartbeatTimer?: ReturnType<typeof setInterval>
    /** 连接超时定时器 */
    timeoutTimer?: ReturnType<typeof setTimeout>
    /** 是否已关闭 */
    isClosed: boolean
    /** 创建时间 */
    createdAt: Date
    /** 最后活动时间 */
    lastActivityAt: Date
}

/**
 * SSE 连接管理器
 *
 * 管理所有活跃的 SSE 连接
 */
class SSEConnectionManager {
    /** 活跃连接映射 */
    private connections: Map<string, SSEConnection> = new Map()

    /** 添加连接 */
    add(connection: SSEConnection): void {
        this.connections.set(connection.id, connection)
        logger.debug('SSE 连接已添加', {
            connectionId: connection.id,
            totalConnections: this.connections.size,
        })
    }

    /** 移除连接 */
    remove(connectionId: string): void {
        const connection = this.connections.get(connectionId)
        if (connection) {
            if (connection.heartbeatTimer) {
                clearInterval(connection.heartbeatTimer)
            }
            if (connection.timeoutTimer) {
                clearTimeout(connection.timeoutTimer)
            }
            this.connections.delete(connectionId)
            logger.debug('SSE 连接已移除', {
                connectionId,
                totalConnections: this.connections.size,
            })
        }
    }

    /** 获取连接 */
    get(connectionId: string): SSEConnection | undefined {
        return this.connections.get(connectionId)
    }

    /** 检查连接是否存在 */
    has(connectionId: string): boolean {
        return this.connections.has(connectionId)
    }

    /** 获取所有连接数量 */
    get size(): number {
        return this.connections.size
    }

    /** 清理所有连接 */
    clear(): void {
        for (const [, connection] of this.connections) {
            if (connection.heartbeatTimer) {
                clearInterval(connection.heartbeatTimer)
            }
            if (connection.timeoutTimer) {
                clearTimeout(connection.timeoutTimer)
            }
        }
        this.connections.clear()
        logger.info('所有 SSE 连接已清理')
    }
}

/** 全局连接管理器实例 */
const connectionManager = new SSEConnectionManager()

/** 生成唯一连接 ID */
function generateConnectionId(): string {
    return `sse_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
}

/**
 * 格式化 SSE 消息
 *
 * @param message SSE 消息对象
 * @returns 格式化后的 JSON 字符串
 */
export function formatSSEMessage(message: SSEMessage): string {
    return JSON.stringify({
        ...message,
        timestamp: message.timestamp ?? Date.now(),
    })
}

/**
 * 发送 SSE 消息
 *
 * @param connection SSE 连接实例
 * @param message 消息对象
 * @returns 是否发送成功
 */
export async function sendSSEMessageService(
    connection: SSEConnection,
    message: SSEMessage
): Promise<boolean> {
    if (connection.isClosed) {
        logger.warn('SSE 连接已关闭，无法发送消息', {
            connectionId: connection.id,
            messageType: message.type,
        })
        return false
    }

    try {
        const formattedMessage = formatSSEMessage(message)
        await connection.eventStream.push(formattedMessage)
        connection.lastActivityAt = new Date()
        return true
    } catch (error) {
        logger.error('SSE 消息发送失败', {
            connectionId: connection.id,
            messageType: message.type,
            error: error instanceof Error ? error.message : '未知错误',
        })
        return false
    }
}


/**
 * 关闭 SSE 连接
 *
 * @param connection SSE 连接实例
 */
export async function closeSSEConnectionService(connection: SSEConnection): Promise<void> {
    if (connection.isClosed) {
        return
    }

    try {
        // 发送关闭消息
        await sendSSEMessageService(connection, {
            type: SSEMessageType.CLOSED,
            message: '连接已关闭',
        })

        // 关闭事件流
        await connection.eventStream.close()
    } catch (error) {
        logger.error('SSE 连接关闭时发生错误', {
            connectionId: connection.id,
            error: error instanceof Error ? error.message : '未知错误',
        })
    } finally {
        connection.isClosed = true
        connectionManager.remove(connection.id)
    }

    logger.info('SSE 连接已关闭', { connectionId: connection.id })
}

/**
 * 创建 SSE 连接
 *
 * 建立 SSE 连接并返回连接实例
 * 支持心跳保活和连接超时
 *
 * @param event H3 事件对象
 * @param config 连接配置
 * @returns SSE 连接实例
 */
export async function createSSEConnectionService(
    event: H3Event,
    config: SSEConnectionConfig = {}
): Promise<SSEConnection> {
    const {
        heartbeatInterval = 30000,
        enableHeartbeat = true,
        connectionTimeout = 0,
    } = config

    // 设置 SSE 响应头
    setResponseHeader(event, 'Content-Type', 'text/event-stream')
    setResponseHeader(event, 'Cache-Control', 'no-cache')
    setResponseHeader(event, 'Connection', 'keep-alive')

    const eventStream = createEventStream(event)
    const connectionId = generateConnectionId()
    const now = new Date()

    // 创建连接实例
    const connection: SSEConnection = {
        id: connectionId,
        eventStream,
        isClosed: false,
        createdAt: now,
        lastActivityAt: now,
    }

    // 设置心跳
    if (enableHeartbeat && heartbeatInterval > 0) {
        connection.heartbeatTimer = setInterval(async () => {
            if (!connection.isClosed) {
                try {
                    await sendSSEMessageService(connection, {
                        type: SSEMessageType.HEARTBEAT,
                        message: 'ping',
                    })
                } catch (error) {
                    logger.warn('SSE 心跳发送失败', {
                        connectionId,
                        error: error instanceof Error ? error.message : '未知错误',
                    })
                    // 心跳失败，关闭连接
                    await closeSSEConnectionService(connection)
                }
            }
        }, heartbeatInterval)
    }

    // 设置连接超时
    if (connectionTimeout > 0) {
        connection.timeoutTimer = setTimeout(async () => {
            logger.info('SSE 连接超时', { connectionId })
            await closeSSEConnectionService(connection)
        }, connectionTimeout)
    }

    // 监听连接关闭
    eventStream.onClosed(() => {
        logger.info('SSE 连接已关闭（客户端断开）', { connectionId })
        connection.isClosed = true
        connectionManager.remove(connectionId)
    })

    // 添加到连接管理器
    connectionManager.add(connection)

    // 发送连接成功消息
    await sendSSEMessageService(connection, {
        type: SSEMessageType.CONNECTED,
        message: '连接成功',
        data: { connectionId },
    })

    logger.info('SSE 连接已建立', {
        connectionId,
        heartbeatInterval: enableHeartbeat ? heartbeatInterval : 'disabled',
        connectionTimeout: connectionTimeout > 0 ? connectionTimeout : 'disabled',
    })

    return connection
}


/**
 * 发送中断事件
 *
 * 当工作流需要用户输入时，发送中断事件
 *
 * @param connection SSE 连接实例
 * @param interruptType 中断类型
 * @param interruptMessage 中断消息
 * @param interruptData 中断数据
 * @returns 是否发送成功
 *
 * @see Requirements 7.4, 7.5
 */
export async function sendInterruptEventService(
    connection: SSEConnection,
    interruptType: string,
    interruptMessage: string,
    interruptData?: Record<string, unknown>
): Promise<boolean> {
    return sendSSEMessageService(connection, {
        type: SSEMessageType.INTERRUPT,
        message: interruptMessage,
        data: {
            __interrupt__: {
                type: interruptType,
                message: interruptMessage,
                data: interruptData,
            },
        },
    })
}

/**
 * 发送解析后的中断事件
 *
 * 使用从工作流结果中提取的中断数据发送中断事件
 *
 * @param connection SSE 连接实例
 * @param interrupt 解析后的中断数据
 * @returns 是否发送成功
 *
 * @see Requirements 7.4, 7.5
 */
export async function sendParsedInterruptEventService(
    connection: SSEConnection,
    interrupt: {
        type: string
        message: string
        data: Record<string, unknown>
        resumable: boolean
        node: string
    }
): Promise<boolean> {
    logger.info('发送解析后的中断事件', {
        connectionId: connection.id,
        interruptType: interrupt.type,
        node: interrupt.node,
        resumable: interrupt.resumable,
    })

    return sendSSEMessageService(connection, {
        type: SSEMessageType.INTERRUPT,
        message: interrupt.message,
        data: {
            __interrupt__: {
                type: interrupt.type,
                message: interrupt.message,
                data: interrupt.data,
                resumable: interrupt.resumable,
                node: interrupt.node,
            },
        },
    })
}

/**
 * 发送中断恢复确认事件
 *
 * 当用户提交中断响应后，发送确认恢复
 *
 * @param connection SSE 连接实例
 * @param interruptType 中断类型
 * @param resumeData 恢复时提交的数据摘要
 * @returns 是否发送成功
 *
 * @see Requirements 7.5
 */
export async function sendInterruptResumeEventService(
    connection: SSEConnection,
    interruptType: string,
    resumeData?: Record<string, unknown>
): Promise<boolean> {
    logger.info('发送中断恢复事件', {
        connectionId: connection.id,
        interruptType,
    })

    return sendSSEMessageService(connection, {
        type: SSEMessageType.INFO,
        message: '工作流已恢复',
        data: {
            status: 'resumed',
            interruptType,
            resumeData,
        },
    })
}


/**
 * 发送任务开始事件
 *
 * @param connection SSE 连接实例
 * @param taskName 任务名称
 * @param taskTitle 任务标题
 * @returns 是否发送成功
 */
export async function sendTaskStartEventService(
    connection: SSEConnection,
    taskName: string,
    taskTitle: string
): Promise<boolean> {
    return sendSSEMessageService(connection, {
        type: SSEMessageType.TASK_START,
        message: `开始${taskTitle}`,
        data: { taskName, taskTitle },
    })
}

/**
 * 发送任务进度事件（流式内容）
 *
 * @param connection SSE 连接实例
 * @param taskName 任务名称
 * @param content 内容增量
 * @returns 是否发送成功
 */
export async function sendTaskProgressEventService(
    connection: SSEConnection,
    taskName: string,
    content: string
): Promise<boolean> {
    return sendSSEMessageService(connection, {
        type: SSEMessageType.TASK_PROGRESS,
        message: content,
        data: { taskName },
    })
}

/**
 * 发送任务完成事件
 *
 * @param connection SSE 连接实例
 * @param taskName 任务名称
 * @param taskTitle 任务标题
 * @param result 任务结果
 * @returns 是否发送成功
 */
export async function sendTaskCompleteEventService(
    connection: SSEConnection,
    taskName: string,
    taskTitle: string,
    result?: unknown
): Promise<boolean> {
    return sendSSEMessageService(connection, {
        type: SSEMessageType.TASK_COMPLETE,
        message: `${taskTitle}完成`,
        data: { taskName, taskTitle, result },
    })
}

/**
 * 发送文本增量事件
 *
 * 用于流式输出 AI 生成的文本
 *
 * @param connection SSE 连接实例
 * @param delta 文本增量
 * @param taskName 任务名称（可选）
 * @returns 是否发送成功
 */
export async function sendTextDeltaEventService(
    connection: SSEConnection,
    delta: string,
    taskName?: string
): Promise<boolean> {
    return sendSSEMessageService(connection, {
        type: SSEMessageType.TEXT_DELTA,
        message: delta,
        data: { taskName: taskName ?? undefined },
    })
}

/**
 * 发送推理过程事件
 *
 * @param connection SSE 连接实例
 * @param reasoning 推理内容
 * @param taskName 任务名称（可选）
 * @returns 是否发送成功
 */
export async function sendReasoningEventService(
    connection: SSEConnection,
    reasoning: string,
    taskName?: string
): Promise<boolean> {
    return sendSSEMessageService(connection, {
        type: SSEMessageType.REASONING,
        message: reasoning,
        data: { taskName: taskName ?? undefined },
    })
}


/**
 * 发送工具调用事件
 *
 * @param connection SSE 连接实例
 * @param toolName 工具名称
 * @param toolCallId 工具调用 ID
 * @param args 工具参数
 * @param taskName 任务名称（可选）
 * @returns 是否发送成功
 */
export async function sendToolCallEventService(
    connection: SSEConnection,
    toolName: string,
    toolCallId: string,
    args?: Record<string, unknown>,
    taskName?: string
): Promise<boolean> {
    return sendSSEMessageService(connection, {
        type: SSEMessageType.TOOL_CALL,
        message: `调用工具: ${toolName}`,
        data: { toolName, toolCallId, args, taskName },
    })
}

/**
 * 发送工具结果事件
 *
 * @param connection SSE 连接实例
 * @param toolName 工具名称
 * @param toolCallId 工具调用 ID
 * @param result 工具结果
 * @param taskName 任务名称（可选）
 * @returns 是否发送成功
 */
export async function sendToolResultEventService(
    connection: SSEConnection,
    toolName: string,
    toolCallId: string,
    result: unknown,
    taskName?: string
): Promise<boolean> {
    return sendSSEMessageService(connection, {
        type: SSEMessageType.TOOL_RESULT,
        message: `工具结果: ${toolName}`,
        data: { toolName, toolCallId, result, taskName },
    })
}

/**
 * 发送错误事件
 *
 * @param connection SSE 连接实例
 * @param errorMessage 错误消息
 * @param errorData 错误数据（可选）
 * @returns 是否发送成功
 */
export async function sendErrorEventService(
    connection: SSEConnection,
    errorMessage: string,
    errorData?: Record<string, unknown>
): Promise<boolean> {
    return sendSSEMessageService(connection, {
        type: SSEMessageType.ERROR,
        message: errorMessage,
        data: errorData,
    })
}

/**
 * 发送工作流开始事件
 *
 * @param connection SSE 连接实例
 * @param workflowData 工作流数据
 * @returns 是否发送成功
 */
export async function sendWorkflowStartEventService(
    connection: SSEConnection,
    workflowData?: Record<string, unknown>
): Promise<boolean> {
    return sendSSEMessageService(connection, {
        type: SSEMessageType.WORKFLOW_START,
        message: '工作流开始',
        data: workflowData,
    })
}

/**
 * 发送工作流完成事件
 *
 * @param connection SSE 连接实例
 * @param workflowData 工作流数据
 * @returns 是否发送成功
 */
export async function sendWorkflowCompleteEventService(
    connection: SSEConnection,
    workflowData?: Record<string, unknown>
): Promise<boolean> {
    return sendSSEMessageService(connection, {
        type: SSEMessageType.WORKFLOW_COMPLETE,
        message: '工作流完成',
        data: workflowData,
    })
}

/**
 * 获取 SSE 连接管理器
 *
 * @returns 连接管理器实例
 */
export function getSSEConnectionManagerService(): SSEConnectionManager {
    return connectionManager
}

/**
 * 检查连接是否活跃
 *
 * @param connection SSE 连接实例
 * @returns 是否活跃
 */
export function isConnectionActiveService(connection: SSEConnection): boolean {
    return !connection.isClosed
}

/**
 * 返回 SSE 响应
 *
 * 在 API 处理器中返回 SSE 响应
 *
 * @param connection SSE 连接实例
 * @returns 事件流发送函数
 */
export function sendSSEResponseService(connection: SSEConnection) {
    return connection.eventStream.send()
}
