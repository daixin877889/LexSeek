/**
 * 用户每轮注入中间件
 *
 * 节点关联的 type=user_injection 提示词，会在每轮 LLM 调用前作为隐藏 HumanMessage 插入到
 * `request.messages` 末尾的最新 HumanMessage 之前——但**不写回 state.messages / 不进
 * checkpoint**。下一轮新调用 wrapModelCall 时再次重新注入。
 *
 * 设计要点：
 * - 注入仅发生在 wrapModelCall 内的 request 副本上，handler 调完直接返回，state 不变
 * - LangGraph checkpointer 仅持久化 state.messages 的更新；这些 ephemeral 消息不会进
 *   checkpoint，第二轮对话历史里看不到
 * - 多个 user_injection 按 displayOrder 升序拼接，段间空行分隔，作为单条 HumanMessage 插入
 *   （减少 messages 数组长度膨胀）
 * - 模板变量未提供时保留 `{{xxx}}` 字面量，避免吞错（与 renderSystemPrompt 行为一致）
 * - 工厂层仅做 filter + sort 的静态预筛；变量展平 + 渲染必须放在 wrapModelCall 内每轮重算，
 *   否则跨午夜运行的 agent 会让 `{{currentDate}}` 等动态变量卡死在启动日（agent 进程
 *   长期复用同一中间件实例）
 *
 * @see docs/superpowers/plans/2026-05-06-prompts-multi-node-and-anti-jailbreak.md Task 6
 */

import { createMiddleware } from 'langchain'
import { HumanMessage } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'
import { renderContent } from '~~/server/services/node/prompt.service'
import { flattenPromptContext } from '~~/server/services/agent-platform/nodeConfig/promptRenderer'
import type { NodePromptConfig } from '~~/server/services/node/node.service'
import type { PromptRenderContext } from '~~/server/services/agent-platform/nodeConfig/promptRenderer'

export interface UserInjectionMiddlewareOptions {
    /** 节点配置中的全部 prompts（middleware 内部 filter type=user_injection） */
    prompts: NodePromptConfig[]
    /** 模板变量上下文（与 renderSystemPrompt 共用类型） */
    context?: PromptRenderContext
}

/**
 * 工厂：返回 wrapModelCall 形态的中间件。
 *
 * - 节点没有 user_injection 提示词 → middleware 仍可挂载，每轮直接 passthrough
 *   handler(request)，零开销
 * - 有则在最新 HumanMessage 之前插入一条隐藏 HumanMessage
 *
 * @returns LangChain createMiddleware 实例
 */
export function userInjectionMiddleware(options: UserInjectionMiddlewareOptions) {
    const allPrompts = options.prompts ?? []
    const context = options.context ?? {}

    // 工厂层仅做静态筛选 + 排序；变量展平 + 模板渲染放到 wrapModelCall 内每轮重算
    const activePrompts = allPrompts
        .filter((p) => p.type === 'user_injection' && p.status === 1)
        .sort((a, b) => (a.displayOrder ?? 100) - (b.displayOrder ?? 100))

    return createMiddleware({
        name: 'userInjectionMiddleware',
        wrapModelCall: async (request, handler) => {
            if (activePrompts.length === 0) {
                return handler(request)
            }

            const variables = flattenPromptContext(context)
            const injectionContent = activePrompts
                .map((p) => renderContent(p.content, variables))
                .join('\n\n')
                .trim()

            if (!injectionContent) {
                return handler(request)
            }

            // 复制 messages 数组（注入不应改动原数组 / state）
            const enhanced: BaseMessage[] = request.messages.slice()
            const injectionMsg = new HumanMessage(injectionContent)

            // 在末尾的 HumanMessage 之前插入；找不到 HumanMessage 时直接 push 末尾
            const lastHumanIdx = enhanced.findLastIndex((m) => m.getType() === 'human')
            if (lastHumanIdx >= 0) {
                enhanced.splice(lastHumanIdx, 0, injectionMsg)
            } else {
                enhanced.push(injectionMsg)
            }

            // 调用 handler 用增强 messages；注意 request 本身是拷贝（解构展开），不动 state
            return handler({ ...request, messages: enhanced })
        },
    })
}
