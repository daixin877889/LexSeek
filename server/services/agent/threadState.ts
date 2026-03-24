/**
 * 线程状态读取
 *
 * 从 PostgresSaver checkpointer 读取线程最新检查点，
 * 返回 useStream initialValues 所需的字典格式状态。
 */

import { getCheckpointer } from '~~/server/services/workflow/checkpointer'
import { mapStoredMessageToChatMessage } from '@langchain/core/messages'

/**
 * 将 checkpointer 中的消息转为 useStream 期望的平坦字典格式
 * 输出格式: { type: "human"/"ai"/"tool", content: "...", id: "...", ... }
 *
 * 注意：不能使用 BaseMessage.toDict()，它返回的是 constructor 格式
 * { type: "constructor", id: [...], kwargs: {...} }，前端无法解析
 */
function messageToFlatDict(msg: any): Record<string, unknown> {
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
 * @param threadId 线程 ID（即 sessionId）
 * @returns 包含 messages 数组的状态对象，或 null（线程不存在时）
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

    if (Array.isArray(rawMessages) && rawMessages.length > 0) {
        return {
            ...channelValues,
            messages: rawMessages.map(messageToFlatDict),
        }
    }

    return channelValues as Record<string, unknown>
}
