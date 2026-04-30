/**
 * 线程状态读取
 *
 * 从 PostgresSaver checkpointer 读取线程最新检查点，
 * 返回 useStream initialValues 所需的字典格式状态。
 * 同时支持加载子代理 thread 消息。
 */

import { getCheckpointer } from '~~/server/services/workflow/checkpointer'
import { mapStoredMessageToChatMessage } from '@langchain/core/messages'
import { sanitizeName } from './subAgentToolFactory'
import { logger } from '#shared/utils/logger'

/**
 * 将 checkpointer 中的消息转为 useStream 期望的平坦字典格式
 * 输出格式: { type: "human"/"ai"/"tool", content: "...", id: "...", ... }
 *
 * 注意：不能使用 BaseMessage.toDict()，它返回的是 constructor 格式
 * { type: "constructor", id: [...], kwargs: {...} }，前端无法解析
 *
 * @param msg - LangChain BaseMessage 实例、stored message 格式 { type, data } 或平坦字典
 */
export function messageToFlatDict(msg: any): Record<string, unknown> {
    // BaseMessage 实例（有 _getType 方法）
    if (typeof msg._getType === 'function') {
        const dict: Record<string, unknown> = {
            type: msg._getType(), // 'human', 'ai', 'tool'
            content: msg.content,
            id: msg.id,
        }
        if (msg.tool_calls?.length) dict.tool_calls = msg.tool_calls
        if (msg.tool_call_id) dict.tool_call_id = msg.tool_call_id
        if (msg.additional_kwargs && Object.keys(msg.additional_kwargs).length > 0) {
            dict.additional_kwargs = msg.additional_kwargs
        }
        // 保留 response_metadata（用于前端过滤注入的上下文消息）
        if (msg.response_metadata && Object.keys(msg.response_metadata).length > 0) {
            dict.response_metadata = msg.response_metadata
        }
        return dict
    }
    // stored message 格式 ({ type, data })，先转为 BaseMessage 再提取
    if (msg.data && msg.type) {
        try {
            const instance = mapStoredMessageToChatMessage(msg)
            return messageToFlatDict(instance)
        } catch {
            return msg
        }
    }
    // 已是平坦字典格式
    return msg
}

/**
 * 获取线程的最新状态值（用于前端 initialValues）
 *
 * 同时读取 LangGraph 的 pending interrupts —— 当用户在 interrupt 卡片
 * （如 template_select / stance_select）暂停期间刷新页面时，前端依赖
 * `values.__interrupt__` 来恢复卡片渲染（useStreamChat.interruptData
 * 从 initialValues.__interrupt__ 读取）。
 *
 * 不读 interrupts 的话，刷新后用户会看到工具卡片永久 loading（因为
 * interrupt 帧只在第一次 SSE 流时发送，刷新就丢了）。
 *
 * @param threadId 线程 ID（即 sessionId）
 * @returns 包含 messages 数组 + __interrupt__（如有）的状态对象，或 null（线程不存在时）
 */
export async function getThreadValuesService(
    threadId: string
): Promise<Record<string, unknown> | null> {
    const checkpointer = await getCheckpointer()

    const tuple = await checkpointer.getTuple({
        configurable: { thread_id: threadId },
    })

    if (!tuple) return null

    const channelValues = tuple.checkpoint.channel_values as Record<string, any>
    const rawMessages = channelValues.messages

    // 从同一 tuple 的 pendingWrites 抽 __interrupt__ —— 无需二次查 DB
    const pendingInterrupts = extractPendingInterrupts(tuple.pendingWrites)

    if (Array.isArray(rawMessages) && rawMessages.length > 0) {
        const flatMessages = rawMessages.map(messageToFlatDict)
        // 过滤掉 system message 和注入的上下文消息，防止泄露到前端
        const filteredMessages = flatMessages.filter(msg => {
            if (msg.type === 'system') return false
            // 检查 HumanMessage 是否是注入的上下文消息
            if (msg.type === 'human') {
                const injector = (msg as any).response_metadata?.injectedBy as string | undefined
                if (injector?.startsWith('ModuleContext') || injector?.startsWith('CaseMaterial') || injector?.startsWith('SubAgentContext')) {
                    return false
                }
            }
            return true
        })
        return {
            ...channelValues,
            messages: filteredMessages,
            ...(pendingInterrupts.length > 0 ? { __interrupt__: pendingInterrupts } : {}),
        }
    }

    return {
        ...(channelValues as Record<string, unknown>),
        ...(pendingInterrupts.length > 0 ? { __interrupt__: pendingInterrupts } : {}),
    }
}

/**
 * 读取当前 head checkpoint 的 pending __interrupt__ writes。
 *
 * 不依赖 graph.getState().tasks（旧实现）—— 那条路径用 dummy createAgent
 * + getState() 还原 tasks，但 LangGraph 的 _prepareSingleTask 算法依赖 graph
 * 的 processes/channels 拓扑来识别 task。caseMain 等 agent 带大量 middleware
 * 和 tools，dummy createAgent 只有 model+checkpointer 拓扑完全不同，
 * tasks.interrupts 几乎总是空——导致 worker 漏判 INTERRUPTED 把 run 错标 completed，
 * 前端刷新永远拿不到 interrupt 数据（线上"刷新后模板卡片消失"的真根因）。
 *
 * 改用 PostgresSaver.getTuple() 拿 raw pending_writes：LangGraph 在 task
 * interrupt 时会把 INTERRUPT channel 的 value 写入 checkpoint_writes 表，
 * pendingWrites 形态 `Array<[task_id, channel, value]>` —— 直接过滤
 * channel === '__interrupt__' 即可，与 graph schema 无关。
 *
 * 出错或无 interrupt 时返回空数组（不阻塞页面加载）。
 */
function extractPendingInterrupts(pendingWrites: unknown): unknown[] {
    if (!Array.isArray(pendingWrites) || pendingWrites.length === 0) return []
    // pendingWrites: Array<[task_id, channel, value]>
    // LangGraph constants.INTERRUPT === '__interrupt__'，RESUME === '__resume__'

    // 第一遍：收集所有已 resume 的 task_id
    // 用户点"使用此模板"后，LangGraph 把 resume 命令以 __resume__ channel 写到
    // 同一个 task。如果只看 __interrupt__ 不看 __resume__，会把已 resolved 的
    // interrupt 误认为 active，导致刷新时重新渲染选择卡片（线上 bug：用户点完
    // 模板、graph 在跑下一步时刷新，卡片状态还原成 active）。
    const resumedTasks = new Set<string>()
    for (const write of pendingWrites) {
        if (!Array.isArray(write) || write.length < 3) continue
        if (write[1] === '__resume__') resumedTasks.add(String(write[0]))
    }

    // 第二遍：只返回未被 resume 的 interrupt
    const interrupts: unknown[] = []
    for (const write of pendingWrites) {
        if (!Array.isArray(write) || write.length < 3) continue
        const taskId = String(write[0])
        const channel = write[1]
        const value = write[2]
        if (channel === '__interrupt__' && value != null && !resumedTasks.has(taskId)) {
            interrupts.push(value)
        }
    }
    return interrupts
}

/** 子代理 thread 消息记录 */
export interface SubAgentThread {
    /** 子代理工具调用 ID（对应 AIMessage 中的 tool_call.id） */
    toolCallId: string
    /** 子代理名称（节点 name） */
    agentName: string
    /** 子代理 thread ID */
    threadId: string
    /** 子代理消息列表 */
    messages: Record<string, unknown>[]
}

/**
 * 从主 thread 消息中提取子代理工具调用，加载对应的子代理 thread 消息
 *
 * 子代理工具名格式: ask_{safeName}_expert
 * 子代理 thread_id 格式: {sessionId}_sub_{safeName}
 *
 * @param sessionId 主会话 ID
 * @param messages 主 thread 的平坦字典消息列表
 * @returns 子代理 thread 消息映射（按 toolCallId 索引）
 */
export async function loadSubAgentThreads(
    sessionId: string,
    messages: Record<string, unknown>[],
): Promise<SubAgentThread[]> {
    const checkpointer = await getCheckpointer()
    const subAgentThreads: SubAgentThread[] = []

    // 从 AI 消息中提取子代理工具调用
    for (const msg of messages) {
        if (msg.type !== 'ai' || !Array.isArray(msg.tool_calls)) continue

        for (const toolCall of msg.tool_calls as any[]) {
            const toolName = toolCall.name as string
            if (!toolName?.startsWith('ask_') || !toolName?.endsWith('_expert')) continue

            // 从工具名反推节点 safeName: ask_{safeName}_expert → {safeName}
            const safeName = toolName.slice(4, -7) // 去掉 "ask_" 和 "_expert"
            const subThreadId = `${sessionId}_sub_${safeName}`

            try {
                const subTuple = await checkpointer.getTuple({
                    configurable: { thread_id: subThreadId },
                })

                if (!subTuple) continue

                const subChannelValues = subTuple.checkpoint.channel_values as Record<string, any>
                const subRawMessages = subChannelValues?.messages

                if (Array.isArray(subRawMessages) && subRawMessages.length > 0) {
                    // 过滤 system message 和注入的上下文消息
                    const filteredMessages = subRawMessages
                        .map(messageToFlatDict)
                        .filter(msg => {
                            if (msg.type === 'system') return false
                            const meta = msg.response_metadata as { injectedBy?: string } | undefined
                            if (meta?.injectedBy) return false
                            return true
                        })
                    subAgentThreads.push({
                        toolCallId: toolCall.id as string,
                        agentName: safeName,
                        threadId: subThreadId,
                        messages: filteredMessages,
                    })
                }
            }
            catch (error) {
                logger.warn(`加载子代理 thread 失败: ${subThreadId}`, {
                    error: error instanceof Error ? error.message : '未知错误',
                })
            }
        }
    }

    return subAgentThreads
}
