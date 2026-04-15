/**
 * 修复 LangGraph checkpoint 中因工具节点中断产生的 orphan tool_use
 *
 * ## 背景
 *
 * LangGraph 使用 step-level checkpoint：每个 step 完成后持久化状态。
 * 当 agent 调用工具时流程是：
 *   1. Step N: 模型节点产出 AIMessage(tool_use) → 写入 checkpoint
 *   2. Step N+1: 工具节点执行 → 产出 ToolMessage → 写入 checkpoint
 *
 * 如果 step N+1 中途工具被中断（用户点停止、agent 超时、进程崩溃），会留下：
 *   - Step N 的 AIMessage(tool_use) 已持久化
 *   - Step N+1 的 ToolMessage 未产生
 *
 * 此时 checkpoint 的 messages 数组末尾是 AIMessage(tool_use) 没有对应 ToolMessage。
 *
 * ## 后果
 *
 * 用户继续对话（发新的 HumanMessage）时，LangGraph 会把新消息拼到末尾再发给
 * LLM。Anthropic Messages API 严格要求 tool_use 紧跟 tool_result：
 *   messages[i]:   AIMessage(tool_use[X])
 *   messages[i+1]: 必须包含 tool_result[X]
 * 违反时 API 返回 400 invalid_request_error。
 *
 * ## 修复策略
 *
 * 扫描 checkpoint 最新 version 的 messages 数组，对每个 orphan tool_use 插入
 * 一条合成 ToolMessage 占位符，content 为"工具执行被中断：..."。这样恢复时
 * LLM 看到的是完整的 tool_use → tool_result 配对，能正常继续。
 *
 * ## 何时调用
 *
 * 在 `agentWorker` 的 catch 块里（failed / cancelled 路径）自动调用，
 * 作为所有异常退出的兜底。
 */

import { logger } from '#shared/utils/logger'

/**
 * LangChain 序列化消息格式（checkpoint_blobs 里 messages 通道的 JSON 元素）
 *
 * 形如：
 * ```json
 * {
 *   "lc": 1,
 *   "type": "constructor",
 *   "id": ["langchain_core", "messages", "ToolMessage"],
 *   "kwargs": { ... }
 * }
 * ```
 */
export interface SerializedMessage {
    lc: number
    type: string
    id: string[]
    kwargs: Record<string, unknown>
}

interface OrphanInfo {
    insertAfterIndex: number
    toolCallId: string
    toolName: string | undefined
}

interface SerializedToolCall {
    id: string
    name?: string
    args?: unknown
    type?: string
}

/**
 * 纯函数：扫描 messages 数组检测 orphan tool_use，返回修复后的新数组
 *
 * @param messages LangChain 序列化格式的消息数组
 * @param errorMessage 用于合成 ToolMessage 的错误描述
 * @returns `{ patched, count }` - 修复后的新数组 + 修复数量
 *
 * @example
 * ```ts
 * const { patched, count } = repairSerializedMessages(messages, '执行超时')
 * if (count > 0) {
 *   // 写回 checkpoint
 * }
 * ```
 */
export function repairSerializedMessages(
    messages: SerializedMessage[],
    errorMessage: string,
): { patched: SerializedMessage[], count: number } {
    const orphans = detectOrphans(messages)
    if (orphans.length === 0) {
        return { patched: messages, count: 0 }
    }

    // 从后往前插入，避免索引偏移影响后续插入点
    const result = [...messages]
    const sorted = [...orphans].sort((a, b) => b.insertAfterIndex - a.insertAfterIndex)
    for (const orphan of sorted) {
        result.splice(
            orphan.insertAfterIndex + 1,
            0,
            createSyntheticToolMessage(orphan.toolCallId, orphan.toolName, errorMessage),
        )
    }
    return { patched: result, count: orphans.length }
}

function detectOrphans(messages: SerializedMessage[]): OrphanInfo[] {
    const orphans: OrphanInfo[] = []

    for (let i = 0; i < messages.length; i++) {
        const cls = messageClass(messages[i]!)
        if (cls !== 'AIMessage' && cls !== 'AIMessageChunk') continue

        const toolCalls = getToolCalls(messages[i]!)
        if (toolCalls.length === 0) continue

        // 从 i+1 开始贪婪匹配连续的 ToolMessage
        const matched = new Set<string>()
        let lastMatchedIndex = i
        for (let j = i + 1; j < messages.length && matched.size < toolCalls.length; j++) {
            const next = messages[j]!
            if (messageClass(next) !== 'ToolMessage') break
            const tcid = typeof next.kwargs?.tool_call_id === 'string'
                ? next.kwargs.tool_call_id
                : undefined
            if (!tcid || !toolCalls.some(t => t.id === tcid)) break
            matched.add(tcid)
            lastMatchedIndex = j
        }

        // 未匹配的 tool_call 都是 orphan
        for (const tc of toolCalls) {
            if (!matched.has(tc.id)) {
                orphans.push({
                    insertAfterIndex: lastMatchedIndex,
                    toolCallId: tc.id,
                    toolName: tc.name,
                })
            }
        }
    }

    return orphans
}

function messageClass(m: SerializedMessage): string {
    const id = m.id
    return Array.isArray(id) && id.length > 0 ? id[id.length - 1]! : ''
}

function getToolCalls(m: SerializedMessage): SerializedToolCall[] {
    const raw = m.kwargs?.tool_calls
    if (!Array.isArray(raw)) return []
    return raw.filter((tc): tc is SerializedToolCall =>
        !!tc && typeof tc === 'object' && typeof (tc as { id?: unknown }).id === 'string',
    )
}

function createSyntheticToolMessage(
    toolCallId: string,
    toolName: string | undefined,
    errorMessage: string,
): SerializedMessage {
    return {
        lc: 1,
        type: 'constructor',
        id: ['langchain_core', 'messages', 'ToolMessage'],
        kwargs: {
            status: 'error',
            content: `工具执行被中断：${errorMessage}`,
            tool_call_id: toolCallId,
            name: toolName,
            additional_kwargs: {},
            response_metadata: {},
            id: `repair-${toolCallId}`,
        },
    }
}

// ────────────────────────────────────────────────────────────────
// 数据库集成：读取 checkpoint blob → 修复 → 写回
// ────────────────────────────────────────────────────────────────

interface CheckpointRow {
    checkpoint: {
        channel_versions?: Record<string, string | number>
    }
}

interface BlobRow {
    blob: Buffer | null
    type: string
}

/**
 * 修复指定 thread 最新 checkpoint 中的 orphan tool_use
 *
 * 直接就地修改 checkpoint_blobs 里 messages 通道的最新 version，
 * 不创建新 checkpoint、不影响父子关系。适合作为 agentWorker catch 块的兜底。
 *
 * @param threadId LangGraph thread_id（对应 agent run 的 sessionId）
 * @param errorMessage 用于合成 ToolMessage 的错误描述
 * @returns 修复的 orphan 数量；0 表示无需修复
 */
export async function repairOrphanToolUseCheckpoint(
    threadId: string,
    errorMessage: string,
): Promise<number> {
    // 1. 查最新 checkpoint 获取 messages 的 version
    const checkpoints = await prisma.$queryRaw<CheckpointRow[]>`
        SELECT checkpoint
        FROM checkpoints
        WHERE thread_id = ${threadId}
          AND checkpoint_ns = ''
        ORDER BY checkpoint_id DESC
        LIMIT 1
    `
    if (checkpoints.length === 0) return 0

    const messagesVersion = checkpoints[0]!.checkpoint?.channel_versions?.messages
    if (messagesVersion === undefined || messagesVersion === null) return 0

    const versionStr = String(messagesVersion)

    // 2. 查 messages blob
    const blobs = await prisma.$queryRaw<BlobRow[]>`
        SELECT blob, type
        FROM checkpoint_blobs
        WHERE thread_id = ${threadId}
          AND checkpoint_ns = ''
          AND channel = 'messages'
          AND version = ${versionStr}
    `
    if (blobs.length === 0 || !blobs[0]!.blob || blobs[0]!.type !== 'json') return 0

    // 3. 反序列化、修复、序列化
    let messages: SerializedMessage[]
    try {
        const parsed = JSON.parse(blobs[0]!.blob.toString('utf8'))
        if (!Array.isArray(parsed)) return 0
        messages = parsed
    } catch (err) {
        logger.error(`[repairOrphanToolUse] thread=${threadId} JSON parse 失败:`, err)
        return 0
    }

    const { patched, count } = repairSerializedMessages(messages, errorMessage)
    if (count === 0) return 0

    // 4. 写回同一 version 的 blob
    const patchedBuffer = Buffer.from(JSON.stringify(patched), 'utf8')
    await prisma.$executeRaw`
        UPDATE checkpoint_blobs
        SET blob = ${patchedBuffer}
        WHERE thread_id = ${threadId}
          AND checkpoint_ns = ''
          AND channel = 'messages'
          AND version = ${versionStr}
    `

    logger.info(
        `[repairOrphanToolUse] thread=${threadId} 修复 ${count} 个 orphan tool_use`,
    )
    return count
}
