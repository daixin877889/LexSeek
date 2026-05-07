import { collectToolUsesFromContent } from '~~/server/services/workflow/repairOrphanToolUse'

/**
 * 统计 messages 数组中指定工具被调用的次数
 *
 * 支持 LangChain BaseMessage 实例（含 tool_calls 字段）
 * 也支持 plain object 形式（LangGraph SDK 序列化后）。
 *
 * 同时兼容 @langchain/anthropic 1.x streaming + thinking 模式 AIMessageChunk reduce
 * 漏同步 tool_calls 的形态——content 数组里的 {type:'tool_use'} 块也认作调用。
 */
export function countToolCalls(
    messages: Array<{ tool_calls?: Array<{ name?: string }>, content?: unknown }> | undefined | null,
    targetNames: string[],
): number {
    if (!messages || messages.length === 0) return 0
    const targetSet = new Set(targetNames)
    let count = 0
    for (const msg of messages) {
        const seen = new Set<string>()
        const calls = (msg as any).tool_calls
        if (Array.isArray(calls)) {
            for (const call of calls) {
                if (!call?.name || !targetSet.has(call.name)) continue
                const id = typeof call.id === 'string' ? call.id : undefined
                if (id) {
                    if (seen.has(id)) continue
                    seen.add(id)
                }
                count++
            }
        }
        for (const block of collectToolUsesFromContent((msg as any).content, seen)) {
            if (block.name && targetSet.has(block.name)) count++
        }
    }
    return count
}
