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

import { AIMessage, AIMessageChunk, ToolMessage, type BaseMessage } from '@langchain/core/messages'
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

/**
 * 从 content 数组里收集 {type:'tool_use'} 块。
 *
 * @langchain/anthropic 1.x streaming + thinking 模式下 AIMessageChunk reduce
 * 会把 tool_use 块只塞进 content 数组,顶层 tool_calls 字段可能为空。
 * Anthropic 兼容协议按 content[*].type 校验 tool_use/tool_result 配对,
 * 所以必须把 content 里的 tool_use 块也认作工具调用。
 *
 * 调用方传入共享 `seen` Set,与"标准路径"读到的 tool_calls 跨路径去重。
 *
 * 跨模块复用：除本文件的 orphan 检测外,countToolCalls / loadSubAgentThreads /
 * buildSummaryPrompt 等任何"判断/枚举 AI 消息工具调用"的地方都应同时用
 * tool_calls 字段 + 本 helper 兜底,否则在 streaming + thinking 模式下漏检。
 */
export function collectToolUsesFromContent(
    content: unknown,
    seen: Set<string>,
): Array<{ id: string, name?: string }> {
    if (!Array.isArray(content)) return []
    const out: Array<{ id: string, name?: string }> = []
    for (const rawBlock of content) {
        if (!rawBlock || typeof rawBlock !== 'object') continue
        const block = rawBlock as unknown as { type?: unknown, id?: unknown, name?: unknown }
        if (block.type !== 'tool_use') continue
        const id = block.id
        if (typeof id !== 'string' || seen.has(id)) continue
        seen.add(id)
        out.push({
            id,
            name: typeof block.name === 'string' ? block.name : undefined,
        })
    }
    return out
}

function getToolCalls(m: SerializedMessage): SerializedToolCall[] {
    const result: SerializedToolCall[] = []
    const seen = new Set<string>()

    const raw = m.kwargs?.tool_calls
    if (Array.isArray(raw)) {
        for (const tc of raw) {
            if (!tc || typeof tc !== 'object') continue
            const id = (tc as { id?: unknown }).id
            if (typeof id !== 'string' || seen.has(id)) continue
            seen.add(id)
            result.push(tc as SerializedToolCall)
        }
    }

    result.push(...collectToolUsesFromContent(m.kwargs?.content, seen))
    return result
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
// 运行时消息修复：对内存中的 BaseMessage[] 做 orphan 检测 + 补齐
// （供 messageIntegrityMiddleware 在 beforeModel 钩子调用，不触及 checkpoint）
// ────────────────────────────────────────────────────────────────

interface RuntimeToolCall {
    id: string
    name?: string
}

function getRuntimeToolCalls(m: BaseMessage): RuntimeToolCall[] {
    if (!(m instanceof AIMessage) && !(m instanceof AIMessageChunk)) return []
    const result: RuntimeToolCall[] = []
    const seen = new Set<string>()

    const raw = (m as AIMessage | AIMessageChunk).tool_calls
    if (Array.isArray(raw)) {
        for (const tc of raw) {
            if (!tc || typeof tc !== 'object') continue
            const id = (tc as { id?: unknown }).id
            if (typeof id !== 'string' || seen.has(id)) continue
            seen.add(id)
            result.push({ id, name: (tc as { name?: string }).name })
        }
    }

    result.push(...collectToolUsesFromContent((m as AIMessage | AIMessageChunk).content, seen))
    return result
}

/**
 * 纯函数：扫描运行时 BaseMessage 数组，对每个 orphan tool_use 插入合成 ToolMessage
 *
 * 与 `repairSerializedMessages` 逻辑完全对齐，但操作对象是反序列化后的 BaseMessage
 * 实例（middleware.beforeModel 钩子拿到的即时 state）。
 *
 * @param messages LangChain BaseMessage 数组（beforeModel 钩子的 state.messages）
 * @param errorMessage 合成 ToolMessage 的错误描述
 * @returns `{ patched, fixed }`——修复后的新数组 + orphan 修复数
 */
export function repairRuntimeMessages(
    messages: BaseMessage[],
    errorMessage: string,
): { patched: BaseMessage[], fixed: number } {
    interface RuntimeOrphan {
        insertAfterIndex: number
        toolCallId: string
        toolName: string | undefined
    }
    const orphans: RuntimeOrphan[] = []

    for (let i = 0; i < messages.length; i++) {
        const toolCalls = getRuntimeToolCalls(messages[i]!)
        if (toolCalls.length === 0) continue

        const matched = new Set<string>()
        let lastMatchedIndex = i
        for (let j = i + 1; j < messages.length && matched.size < toolCalls.length; j++) {
            const next = messages[j]!
            if (!(next instanceof ToolMessage)) break
            const tcid = next.tool_call_id
            if (!tcid || !toolCalls.some(t => t.id === tcid)) break
            matched.add(tcid)
            lastMatchedIndex = j
        }

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

    if (orphans.length === 0) return { patched: messages, fixed: 0 }

    // 从后往前插入，避免索引偏移
    const result = [...messages]
    const sorted = [...orphans].sort((a, b) => b.insertAfterIndex - a.insertAfterIndex)
    for (const o of sorted) {
        const synthetic = new ToolMessage({
            status: 'error',
            content: `工具执行被中断：${errorMessage}`,
            tool_call_id: o.toolCallId,
            name: o.toolName,
            id: `repair-${o.toolCallId}`,
        })
        result.splice(o.insertAfterIndex + 1, 0, synthetic)
    }
    return { patched: result, fixed: orphans.length }
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
 * repair 执行结果
 *
 * 把"无 orphan"和"扫描失败静默跳过"从 return 0 的混淆里拆开：
 * - fixed=0 / parseFailures=0：真的干净
 * - fixed=0 / parseFailures>0：blob 解析失败，orphan 可能存在但未被修（需告警）
 * - fixed>0：有 orphan 被修掉（正常兜底路径）
 */
export interface RepairResult {
    /** 成功修复的 orphan 总数（跨所有 thread/ns 累加） */
    fixed: number
    /** 因 blob 解析失败被跳过的 (thread_id, checkpoint_ns) scope 数；>0 表示漏扫，调用方必须升级告警 */
    parseFailures: number
}

/**
 * 修复指定 session 所有相关 thread / ns 下 checkpoint 的 orphan tool_use
 *
 * 扫描范围（本次扩展，spec: 停止后整个 session 能干净恢复）：
 * - 主 thread（`thread_id = sessionId`）的所有 checkpoint_ns（包括 ns='' 及
 *   LangGraph subgraphs:true 配置下产生的 `{nodeName}:{uuid}` 子图 ns）
 * - 子代理独立 thread（`thread_id LIKE '${sessionId}_sub_%'`）的所有 ns
 *
 * 为什么要扫 subgraph ns：caseMainAgent 使用 createAgent + subgraphs:true，
 * LangGraph 把 ReactAgent 对不同节点的调用建模成独立子图 checkpoint（如
 * claim:<uuid>、defense:<uuid> 等），每个子图独立持有 messages 通道。用户
 * 在这些子图内被 cancel 会留下 orphan tool_use，不修会在下次进入同一子图
 * 时把悬挂 tool_use 发给 LLM，返回 400 invalid_request_error。
 *
 * 为什么要扫子代理独立 thread：subAgentToolFactory 给每个子代理用
 * `${sessionId}_sub_${name}` 作为独立 thread_id；子代理被打断后下次调用
 * 同一工具会从该 thread 读历史，同样会踩 orphan。
 *
 * 直接就地更新 checkpoint_blobs 的对应 version，不创建新 checkpoint、
 * 不影响父子链。幂等：扫过无 orphan 的 scope 返回 fixed=0，多次调用无副作用。
 *
 * @param sessionId 会话 ID（对应主 LangGraph thread_id）
 * @param errorMessage 合成 ToolMessage 的错误描述
 * @returns `RepairResult`——fixed 是修复数，parseFailures>0 必须上报
 */
export async function repairOrphanToolUseCheckpoint(
    sessionId: string,
    errorMessage: string,
): Promise<RepairResult> {
    // 一次性枚举该 session 全部相关 (thread_id, checkpoint_ns) scope，避免按 thread 二次循环查询
    const subPattern = `${sessionId}_sub_%`
    const scopes = await prisma.$queryRaw<{ thread_id: string; checkpoint_ns: string }[]>`
        SELECT DISTINCT thread_id, checkpoint_ns
        FROM langgraph.checkpoints
        WHERE thread_id = ${sessionId}
           OR thread_id LIKE ${subPattern}
    `
    if (scopes.length === 0) return { fixed: 0, parseFailures: 0 }

    let fixed = 0
    let parseFailures = 0
    for (const { thread_id, checkpoint_ns } of scopes) {
        const r = await repairSingleScope(thread_id, checkpoint_ns, errorMessage)
        fixed += r.fixed
        if (r.parseFailed) parseFailures += 1
    }
    return { fixed, parseFailures }
}

/**
 * 修复单个 (thread_id, checkpoint_ns) scope 下最新 checkpoint 的 messages blob
 *
 * 返回 `{ fixed, parseFailed }`：
 * - 正常无 orphan → `{ fixed: 0, parseFailed: false }`
 * - 正常修复 N 条 → `{ fixed: N, parseFailed: false }`
 * - blob 解析失败 → `{ fixed: 0, parseFailed: true }`（orphan 可能存在但未修）
 */
async function repairSingleScope(
    threadId: string,
    checkpointNs: string,
    errorMessage: string,
): Promise<{ fixed: number, parseFailed: boolean }> {
    // 1. 查最新 checkpoint 获取 messages 的 version
    const checkpoints = await prisma.$queryRaw<CheckpointRow[]>`
        SELECT checkpoint
        FROM langgraph.checkpoints
        WHERE thread_id = ${threadId}
          AND checkpoint_ns = ${checkpointNs}
        ORDER BY checkpoint_id DESC
        LIMIT 1
    `
    if (checkpoints.length === 0) return { fixed: 0, parseFailed: false }

    const messagesVersion = checkpoints[0]!.checkpoint?.channel_versions?.messages
    if (messagesVersion === undefined || messagesVersion === null) return { fixed: 0, parseFailed: false }

    const versionStr = String(messagesVersion)

    // 2. 查 messages blob
    const blobs = await prisma.$queryRaw<BlobRow[]>`
        SELECT blob, type
        FROM langgraph.checkpoint_blobs
        WHERE thread_id = ${threadId}
          AND checkpoint_ns = ${checkpointNs}
          AND channel = 'messages'
          AND version = ${versionStr}
    `
    if (blobs.length === 0 || !blobs[0]!.blob || blobs[0]!.type !== 'json') {
        return { fixed: 0, parseFailed: false }
    }

    // 3. 反序列化、修复、序列化
    // LangGraph 存储的 JSON blob 可能含尾部 null bytes（参见 langgraph-checkpoint-postgres
    // 源码中 metadata 解析时的 .replace(/\0/g, "")），需在 parse 前先去除
    let messages: SerializedMessage[]
    try {
        const jsonStr = blobs[0]!.blob.toString('utf8').replace(/\0/g, '')
        const parsed = JSON.parse(jsonStr)
        if (!Array.isArray(parsed)) return { fixed: 0, parseFailed: false }
        messages = parsed
    } catch (err) {
        // 升级到 error：解析失败意味着 orphan 可能存在但未修；需要被监控系统捕获
        logger.error(
            `[repairOrphanToolUse] thread=${threadId} ns='${checkpointNs}' JSON parse 失败，orphan 漏扫`,
            err,
        )
        return { fixed: 0, parseFailed: true }
    }

    const { patched, count } = repairSerializedMessages(messages, errorMessage)
    if (count === 0) return { fixed: 0, parseFailed: false }

    // 4. 写回同一 version 的 blob
    const patchedBuffer = Buffer.from(JSON.stringify(patched), 'utf8')
    await prisma.$executeRaw`
        UPDATE langgraph.checkpoint_blobs
        SET blob = ${patchedBuffer}
        WHERE thread_id = ${threadId}
          AND checkpoint_ns = ${checkpointNs}
          AND channel = 'messages'
          AND version = ${versionStr}
    `

    logger.info(
        `[repairOrphanToolUse] thread=${threadId} ns='${checkpointNs}' 修复 ${count} 个 orphan tool_use`,
    )
    return { fixed: count, parseFailed: false }
}
