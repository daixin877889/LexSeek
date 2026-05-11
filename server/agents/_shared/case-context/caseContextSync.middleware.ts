/**
 * 案件上下文同步中间件
 *
 * 替代旧 caseContextMiddleware，统一三个 Agent（小索 / 模块对话 / 文书生成）
 * 的"案件相关上下文"管线：
 *
 * - 每轮 Agent 启动时（beforeAgent 钩子）实时拉案件 4 段（caseProfile +
 *   moduleSummaries + materialList + memoryRecall），文书 Agent 还会通过
 *   draftLoader 拉草稿当前字段 + 模板占位符 2 段。
 * - 拼成单一字符串构造 HumanMessage，splice 原地插入到本轮 user message 之前。
 * - 双轨打 injectedBy='CaseContextSyncMiddleware' metadata
 *   （response_metadata + additional_kwargs 兜底 SDK 序列化丢字段）。
 * - hook 显式 return {} 触发 LangGraph state merge 路径
 *   （沿用现有 caseContextMiddleware 已生产 1 年模式：splice + truthy return；
 *    return undefined 会让框架走早退分支 `{ jumpTo: void 0 }`，跳过 state merge）。
 *
 * 不依赖 LangGraph add_messages reducer 的 return-数组重排能力（reducer 不会按
 * return 顺序重排，见 spec §3.1 决策表）。
 *
 * @see docs/superpowers/specs/2026-05-05-agent-context-sync-unification-design.md §4.1
 */

import { createMiddleware } from 'langchain'
import { HumanMessage } from '@langchain/core/messages'
import { buildContextSegments } from '~~/server/services/agent-platform/context/moduleContextBuilder'

interface DraftLoaderResult {
    /** 模板待填占位符清单（已渲染好的字符串，闭包外捕获不变） */
    placeholdersWithHints: string
    /** 实时拉 draft.values 序列化为 JSON（每轮调用） */
    draftValuesJSON: () => Promise<string>
}

interface CaseContextSyncOptions {
    caseId: number | null
    agentName: string
    draftLoader?: () => Promise<DraftLoaderResult | null>
}

export const caseContextSyncMiddleware = (options: CaseContextSyncOptions) =>
    createMiddleware({
        name: 'CaseContextSyncMiddleware',

        beforeAgent: {
            hook: async (state: any) => {
                const messages: any[] = state.messages ?? []

                try {
                    const lastHumanIdx = messages.findLastIndex(
                        (m: any) => m._getType?.() === 'human' || m.constructor?.name === 'HumanMessage',
                    )
                    const lastHuman = lastHumanIdx >= 0 ? messages[lastHumanIdx] : undefined
                    const userQuery = typeof lastHuman?.content === 'string' ? lastHuman.content : ''

                    const lines: string[] = []

                    // 案件 4 段
                    if (options.caseId !== null) {
                        const segs = await buildContextSegments({
                            caseId: options.caseId,
                            agentName: options.agentName,
                            userQuery,
                        })
                        if (segs.caseProfile) lines.push(segs.caseProfile)
                        if (segs.moduleSummaries) lines.push(segs.moduleSummaries)
                        if (segs.dynamicContext) lines.push(segs.dynamicContext)
                    }

                    // 文书 2 段：外层 try/catch 处理 draftLoader() 整体抛错；内层 try/catch
                    // 处理 draftValuesJSON() 抛错（spec §5.2：仅 currentValues 置空，placeholders 仍展示）
                    if (options.draftLoader) {
                        try {
                            const draft = await options.draftLoader()
                            if (draft) {
                                let valuesJSON = '{}'
                                try {
                                    valuesJSON = await draft.draftValuesJSON()
                                } catch (innerErr) {
                                    logger.warn('[CaseContextSyncMiddleware] draftValuesJSON 失败，currentValues 置空保留 placeholders', { err: innerErr })
                                }
                                lines.push(`## 当前已填字段\n\`\`\`json\n${valuesJSON}\n\`\`\``)
                                lines.push(`## 模板待填占位符\n${draft.placeholdersWithHints}`)
                            }
                        } catch (err) {
                            logger.warn('[CaseContextSyncMiddleware] draftLoader 失败，跳过文书段', { err })
                        }
                    }

                    if (lines.length === 0) return {}

                    const contextMsg = new HumanMessage({
                        content: lines.join('\n\n'),
                        response_metadata: { injectedBy: 'CaseContextSyncMiddleware' },
                        additional_kwargs: { injectedBy: 'CaseContextSyncMiddleware' },
                    })

                    // splice 原地插入：插到末尾 HumanMessage 之前（lastHumanIdx 在上面已计算）
                    const insertIdx = lastHumanIdx >= 0 ? lastHumanIdx : messages.length
                    messages.splice(insertIdx, 0, contextMsg)
                } catch (err) {
                    logger.error('[CaseContextSyncMiddleware] 注入案件上下文失败', {
                        caseId: options.caseId,
                        agentName: options.agentName,
                        err,
                    })
                }

                // 显式 return {} 触发 LangGraph state merge 路径（沿用现有 caseContextMiddleware
                // 1 年生产模式）；return undefined 会让 langchain middleware 节点走早退
                // `{ jumpTo: void 0 }`，跳过 state merge，splice mutation 跨 super-step 行为
                // undocumented，可能不可靠。
                return {}
            },
        },
    })
