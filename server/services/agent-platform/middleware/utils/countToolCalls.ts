/**
 * 统计 messages 数组中指定工具被调用的次数
 *
 * 支持 LangChain BaseMessage 实例（含 tool_calls 字段）
 * 也支持 plain object 形式（LangGraph SDK 序列化后）。
 */
export function countToolCalls(
    messages: Array<{ tool_calls?: Array<{ name?: string }> }> | undefined | null,
    targetNames: string[],
): number {
    if (!messages || messages.length === 0) return 0
    const targetSet = new Set(targetNames)
    let count = 0
    for (const msg of messages) {
        const calls = (msg as any).tool_calls
        if (!Array.isArray(calls)) continue
        for (const call of calls) {
            if (call?.name && targetSet.has(call.name)) count++
        }
    }
    return count
}
