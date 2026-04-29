/**
 * messageIntegrity 中间件
 *
 * 在 beforeModel 钩子扫描即将喂给模型的 state.messages，
 * 对每个 orphan tool_use（AIMessage.tool_calls 后未紧跟 ToolMessage）
 * 立即插入合成 ToolMessage 占位，防止 Anthropic/OpenAI 兼容 Provider
 * 返回 "tool_use without tool_result" 400 错误。
 *
 * ## 为什么需要这一层（而不是只依赖 checkpoint repair）
 *
 * `repairOrphanToolUseCheckpoint` 在 agentWorker 入口/失败路径调用，
 * 直接操作数据库 blob。存在两类漏网：
 * 1. 入口依赖：未来若有新路径绕过 agentWorker，就没兜底；
 * 2. 时序依赖：catch 路径与 LangGraph 异步写 blob 存在 race，
 *    lazy repair 解析失败（如 null byte）会静默跳过。
 *
 * 本中间件作为最后一道防线——不管消息序列怎么来的（从 checkpoint 恢复、
 * summarization 切点、tool 层异常），只要 LLM 即将看到的序列有 orphan，
 * 这里立刻补齐。和 checkpoint repair 互为补充：
 * - checkpoint repair 确保持久化数据干净
 * - 本中间件确保运行时数据干净
 */

import { createMiddleware } from 'langchain'
import { z } from 'zod'
import type { BaseMessage } from '@langchain/core/messages'
import { repairRuntimeMessages } from '~~/server/services/workflow/repairOrphanToolUse'

/**
 * 创建 messageIntegrity 中间件
 *
 * 挂载时机：**所有 agent 的 middleware 数组最前面**——早于 summarization、safetyTrim、
 * scopeGuard 等任何可能修改消息的 middleware，确保其它 middleware 和模型调用
 * 拿到的 state.messages 已是完整的 tool_use/tool_result 配对。
 */
export function createMessageIntegrityMiddleware() {
    return createMiddleware({
        name: 'MessageIntegrityMiddleware',
        stateSchema: z.object({
            _messageIntegrityFixedTotal: z.number().default(0),
        }),
        beforeModel: {
            hook: async (state: { messages: BaseMessage[], _messageIntegrityFixedTotal?: number }) => {
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

                const { patched, fixed } = repairRuntimeMessages(
                    state.messages,
                    '上一轮工具调用未产生 tool_result（运行时兜底修复）',
                )
                if (fixed === 0) return

                // 原地替换，绕过 add_messages reducer 的"追加"语义
                state.messages.splice(0, state.messages.length, ...patched)

                logger.warn(
                    `[MessageIntegrity] 补齐 ${fixed} 个 orphan tool_use（运行时兜底）`,
                    { fixed, totalMessages: patched.length },
                )

                return {
                    _messageIntegrityFixedTotal: (state._messageIntegrityFixedTotal ?? 0) + fixed,
                }
            },
        },
    })
}
