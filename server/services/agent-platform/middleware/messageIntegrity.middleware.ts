/**
 * messageIntegrity 中间件
 *
 * 双钩子兜底:
 *
 * ### beforeModel: 修复 orphan tool_use
 * 扫描即将喂给模型的 state.messages,对每个 orphan tool_use(AIMessage.tool_calls
 * 后未紧跟 ToolMessage)立即插入合成 ToolMessage 占位,防止 Anthropic/OpenAI
 * 兼容 Provider 返回 "tool_use without tool_result" 400 错误。
 *
 * ### afterModel: 抢救 invalid_tool_calls + 自动 retry
 * 当 LLM 输出的 tool_use args 是 malformed JSON 时(常见于含中文长文本字段的
 * 工具如 save_document_draft),LangChain 会把它放进 invalid_tool_calls,tool_calls
 * 变成空数组。ReactAgent 路由器看 tool_calls.length === 0 直接走 exitNode,graph
 * 终止——用户看到 LLM 文本但工具没执行。
 *
 * 本钩子检测到这种情况后:
 * 1. 把 invalid_tool_calls 提升为合成的合法 tool_calls(args={})
 * 2. 追加合成的错误 ToolMessage(用同 tool_call_id),让 router 认为已处理
 * 3. 设 jumpTo='model' 让 ReactAgent 跳回 model 节点,LLM 看到错误反馈后重新生成参数
 * 4. 限制最多 retry 3 次防止死循环
 *
 * ## 为什么需要这一层(而不是只依赖 checkpoint repair)
 *
 * `repairOrphanToolUseCheckpoint` 在 agentWorker 入口/失败路径调用,
 * 直接操作数据库 blob。存在两类漏网:
 * 1. 入口依赖:未来若有新路径绕过 agentWorker,就没兜底;
 * 2. 时序依赖:catch 路径与 LangGraph 异步写 blob 存在 race,
 *    lazy repair 解析失败(如 null byte)会静默跳过。
 *
 * 本中间件作为最后一道防线——不管消息序列怎么来的(从 checkpoint 恢复、
 * summarization 切点、tool 层异常、LLM hallucinated invalid args),只要 LLM
 * 即将看到/刚输出的序列有问题,这里立刻补齐。和 checkpoint repair 互为补充:
 * - checkpoint repair 确保持久化数据干净
 * - 本中间件确保运行时数据干净
 */

import { createMiddleware } from 'langchain'
import { z } from 'zod'
import { AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import { repairRuntimeMessages } from '~~/server/services/workflow/repairOrphanToolUse'

/** 单 thread 自动 retry invalid_tool_calls 的最大次数,防止 LLM 反复出错导致死循环 */
const MAX_INVALID_TOOL_CALL_RETRIES = 3

/**
 * 创建 messageIntegrity 中间件
 *
 * 挂载时机：**所有 agent 的 middleware 数组最前面**——早于 summarization、safetyTrim、
 * scopeGuard 等任何可能修改消息的 middleware，确保其它 middleware 和模型调用
 * 拿到的 state.messages 已是完整的 tool_use/tool_result 配对。
 */
interface MessageIntegrityState {
    messages: BaseMessage[]
    _messageIntegrityFixedTotal?: number
    _invalidToolCallRetries?: number
}

/**
 * 把 LLM 输出的 invalid_tool_calls 转成合成 tool_calls + 错误 ToolMessage。
 * 调用方负责把 fixedAI 替换 lastMessage 并把 errorToolMessages 追加到序列尾。
 *
 * 设计要点:
 * - 合成 tool_calls 的 args 故意置为空对象 {}——只是为了让 router line 398 不命中
 *   (lastMessage AIMessage.tool_calls 不空),不会被路由到 ToolNode 真的执行
 *   (因为接下来会 jumpTo='model')
 * - 错误 ToolMessage 用同 tool_call_id,让 router 看到 pendingToolCalls=[]
 * - 错误描述里专门提到 LLM 最常犯的错(中文嵌入半角双引号),帮 LLM 下一轮 retry
 */
function reviveInvalidToolCalls(lastMessage: AIMessage): {
    fixedAI: AIMessage
    errorToolMessages: ToolMessage[]
} | null {
    const invalidCalls = (lastMessage as any).invalid_tool_calls as Array<{
        name?: string
        args?: unknown
        id?: string
        error?: string
    }> | undefined

    if (!invalidCalls || invalidCalls.length === 0) return null

    // 合成 tool_calls(必须有 id;LangChain ReactAgent 的 router 用 id 配对 ToolMessage)
    const syntheticToolCalls = invalidCalls.map(c => ({
        name: c.name ?? 'unknown',
        args: {} as Record<string, unknown>,
        id: c.id ?? `synthetic_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        type: 'tool_call' as const,
    }))

    // 合成 ToolMessage(用同 id,让 router 视为已处理→不会再去 ToolNode)
    const errorToolMessages = invalidCalls.map((c, i) => new ToolMessage({
        tool_call_id: syntheticToolCalls[i]!.id,
        content: `Error: 工具 ${c.name ?? 'unknown'} 参数 JSON 解析失败(${c.error ?? 'Malformed args'})。`
            + `常见原因:字符串字段值里嵌入了未转义的半角双引号 "。`
            + `请重新生成完整的工具调用,所有字符串字段值里需要"引用"时一律改用全角「」或单引号 ',`
            + `禁用半角双引号(会破坏 args JSON 解析)。`,
        status: 'error',
    }))

    const fixedAI = new AIMessage({
        id: (lastMessage as any).id,
        content: lastMessage.content,
        tool_calls: syntheticToolCalls,
        invalid_tool_calls: [],
        additional_kwargs: lastMessage.additional_kwargs,
        response_metadata: lastMessage.response_metadata,
    })

    return { fixedAI, errorToolMessages }
}

export function createMessageIntegrityMiddleware() {
    return createMiddleware({
        name: 'MessageIntegrityMiddleware',
        stateSchema: z.object({
            _messageIntegrityFixedTotal: z.number().default(0),
            _invalidToolCallRetries: z.number().default(0),
        }),
        beforeModel: {
            hook: async (state: MessageIntegrityState) => {
                // [ThinkingProbe] 临时调试：dump 每条 AIMessage 的 content 形态，用于定位 thinking 块剥离时机
                // 修复完成后即移除
                const probe = state.messages.map((m, idx) => {
                    const t = (m as any)._getType?.() ?? (m as any).type
                    if (t !== 'ai') return null
                    const c = (m as any).content
                    const tcCount = Array.isArray((m as any).tool_calls) ? (m as any).tool_calls.length : 0
                    if (typeof c === 'string') {
                        return { idx, contentType: 'string', length: c.length, tcCount, blockTypes: [], hasThinking: false }
                    }
                    if (Array.isArray(c)) {
                        const blockTypes = c.map((b: any) => b?.type ?? 'unknown')
                        return { idx, contentType: 'array', length: c.length, tcCount, blockTypes, hasThinking: blockTypes.includes('thinking') }
                    }
                    return { idx, contentType: typeof c, tcCount, blockTypes: [], hasThinking: false }
                }).filter(Boolean)
                logger.warn('[ThinkingProbe] beforeModel 即将喂给 LLM 的 AIMessages', { count: probe.length, probe })

                // 顺序很重要:**先 revive 后 repair**。
                //
                // repairRuntimeMessages 通过 content[*].type==='tool_use' 也能扫到 invalid_tool_calls
                // 的 tool_use block(LangChain 把 LLM 的 raw tool_use 块原样存在 content 里,
                // 即使 args JSON 解析失败也不剔除)。如果先 repair,它会给 invalid 加一条粗糙的
                // 合成 ToolMessage(content="工具执行被中断..."),然后 revive 又加一条带详细错误
                // 提示的合成 ToolMessage,两条同 tool_call_id 触发 Anthropic API 400
                // "each tool_use must have a single result"。
                //
                // 改为先 revive(消化掉所有 invalid + 追加配对 ToolMessage),再让 repair 处理
                // 剩下的真 orphan(被打断/中途崩溃产生的 tool_use)。两者 tool_call_id 不会冲突。

                const reviveLog: Array<{ idx: number, count: number, names: string[] }> = []
                const afterRevive: BaseMessage[] = []
                for (let i = 0; i < state.messages.length; i++) {
                    const msg = state.messages[i]!
                    afterRevive.push(msg)
                    if (!AIMessage.isInstance(msg)) continue
                    if ((msg.tool_calls?.length ?? 0) > 0) continue
                    const result = reviveInvalidToolCalls(msg)
                    if (!result) continue
                    afterRevive.pop()
                    afterRevive.push(result.fixedAI, ...result.errorToolMessages)
                    reviveLog.push({
                        idx: i,
                        count: result.errorToolMessages.length,
                        names: result.errorToolMessages.map(_ => _.tool_call_id),
                    })
                }

                const { patched, fixed } = repairRuntimeMessages(
                    afterRevive,
                    '上一轮工具调用未产生 tool_result（运行时兜底修复）',
                )

                // 去重同 tool_call_id 的 ToolMessage:Anthropic API 严格要求每个 tool_use
                // 只能有一个 tool_result,有多个会返回 400 "each tool_use must have a single result"。
                //
                // 来源:旧 bug 期间(本中间件修复前) checkpoint 写入了同 id 的两条 ToolMessage——
                // 一条是 repair-{id} 的"工具执行被中断"占位,一条是 revive 的"Malformed args 详细
                // 错误"。即使代码改成"先 revive 后 repair",已经污染的 checkpoint 仍需要 inflight
                // 去重,否则历史会话的 thread 无法恢复。
                //
                // 去重策略:同 id 保留第一条(LangGraph add_messages 的自然顺序);丢弃后续重复。
                // 一般第一条是 revive 加的(更详细),repair 加的"工具执行被中断"在 idx 后面被丢。
                const seenToolCallIds = new Set<string>()
                const dedupedMessages: BaseMessage[] = []
                let dedupedCount = 0
                for (const msg of patched) {
                    const tcid = msg instanceof ToolMessage ? msg.tool_call_id : undefined
                    if (tcid && seenToolCallIds.has(tcid)) {
                        dedupedCount++
                        continue
                    }
                    if (tcid) seenToolCallIds.add(tcid)
                    dedupedMessages.push(msg)
                }

                if (fixed === 0 && reviveLog.length === 0 && dedupedCount === 0) return

                // 原地替换，绕过 add_messages reducer 的"追加"语义
                state.messages.splice(0, state.messages.length, ...dedupedMessages)

                if (fixed > 0) {
                    logger.warn(
                        `[MessageIntegrity] 补齐 ${fixed} 个 orphan tool_use(运行时兜底)`,
                        { fixed, totalMessages: dedupedMessages.length },
                    )
                }
                if (reviveLog.length > 0) {
                    logger.warn(
                        `[MessageIntegrity] 抢救 ${reviveLog.length} 处 historical invalid_tool_calls(从 checkpoint 恢复)`,
                        { reviveLog },
                    )
                }
                if (dedupedCount > 0) {
                    logger.warn(
                        `[MessageIntegrity] 去重 ${dedupedCount} 条同 tool_call_id 的 ToolMessage(Anthropic API 兼容)`,
                    )
                }

                return {
                    _messageIntegrityFixedTotal: (state._messageIntegrityFixedTotal ?? 0) + fixed + reviveLog.length + dedupedCount,
                }
            },
        },
        afterModel: {
            // canJumpTo 必填,声明本钩子允许跳转的目标。'model' 通过 parseJumpToTarget
            // 映射成 'model_request' 节点(ReactAgent 的 model 节点),让 LLM 重跑一轮
            canJumpTo: ['model'],
            hook: async (state: MessageIntegrityState) => {
                if (state.messages.length === 0) return undefined

                const lastIdx = state.messages.length - 1
                const lastMessage = state.messages[lastIdx]
                if (!lastMessage || !AIMessage.isInstance(lastMessage)) return undefined

                // 只在 LLM 明确"想调工具但 args 是 malformed JSON"时抢救
                if ((lastMessage.tool_calls?.length ?? 0) > 0) return undefined

                const result = reviveInvalidToolCalls(lastMessage)
                if (!result) return undefined

                // 限制 retry 次数,防止 LLM 反复 hallucinate 导致死循环。
                // 达到上限时仍然抢救消息(让 thread 保持一致),但不再 jumpTo,正常结束。
                const retries = state._invalidToolCallRetries ?? 0
                const reachedLimit = retries >= MAX_INVALID_TOOL_CALL_RETRIES

                state.messages.splice(lastIdx, 1, result.fixedAI, ...result.errorToolMessages)

                logger.warn('[MessageIntegrity] 抢救 invalid_tool_calls', {
                    count: result.errorToolMessages.length,
                    retries: retries + 1,
                    willRetry: !reachedLimit,
                    toolNames: result.errorToolMessages.map(t => t.tool_call_id),
                })

                if (reachedLimit) {
                    return {
                        _invalidToolCallRetries: retries + 1,
                    }
                }

                return {
                    jumpTo: 'model',
                    _invalidToolCallRetries: retries + 1,
                }
            },
        },
    })
}
