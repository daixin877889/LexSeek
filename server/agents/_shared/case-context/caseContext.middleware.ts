/**
 * 案件上下文注入中间件（createAgent 路径用）
 *
 * 在 Agent 首次运行时（_caseContextInjected=false）注入：
 * - 案件档案（caseProfile）
 * - 已完成模块摘要（moduleSummaries，按 agentName 排除自身）
 * - 动态上下文（召回记忆 + 材料清单）
 *
 * 与 5 段式上下文管线（buildContextSegments / buildSystemPromptForAgent）共用同一构建器，
 * 区别是注入位置：本中间件以 HumanMessage 形式插到 SystemMessage 之后；
 * stateGraph 路径（moduleAgent / documentMainAgent / contractReviewMainAgent / assistantAgent）
 * 直接调 buildSystemPromptForAgent 把 4 段嵌进 SystemMessage。
 *
 * 当前唯一使用方：caseMain（小索，走 createAgent 路径）。
 */

import { createMiddleware } from 'langchain'
import { HumanMessage } from '@langchain/core/messages'
import { z } from 'zod'
import { buildContextSegments } from '~~/server/services/agent-platform/context/moduleContextBuilder'

/**
 * 案件上下文注入中间件工厂
 *
 * @param caseId    案件 ID（必填）
 * @param agentName 当前 agent 名（caseMain / 模块 nodeName 如 caseAnalysisSummary）
 *                  传给 buildContextSegments 用于 `NOT { analysisType: agentName }` 排除自身模块结果。
 *                  caseMain 传 'caseMain' 时不会匹配任何 analysisType，自然包含全部模块摘要。
 */
export const caseContextMiddleware = (caseId: number, agentName: string) =>
    createMiddleware({
        name: 'CaseContextMiddleware',
        stateSchema: z.object({
            _caseContextInjected: z.boolean().default(false),
        }),

        beforeAgent: {
            hook: async (state: any) => {
                // 已注入则跳过（多轮对话只注入一次）
                if (state._caseContextInjected) return

                const messages: any[] = state.messages ?? []

                // 提取最新用户消息作为 userQuery（用于记忆召回）
                const lastHuman = [...messages].reverse().find(
                    m => m._getType?.() === 'human' || m.constructor?.name === 'HumanMessage',
                )
                const userQuery = typeof lastHuman?.content === 'string' ? lastHuman.content : ''

                try {
                    const segments = await buildContextSegments({ caseId, agentName, userQuery })

                    const lines: string[] = []
                    if (segments.caseProfile) lines.push(segments.caseProfile)
                    if (segments.moduleSummaries) lines.push(segments.moduleSummaries)
                    if (segments.dynamicContext) lines.push(segments.dynamicContext)

                    if (lines.length > 0) {
                        // 插入到 SystemMessage 之后
                        const systemIdx = messages.findIndex(m => m._getType?.() === 'system')
                        const insertIdx = systemIdx >= 0 ? systemIdx + 1 : 0
                        messages.splice(insertIdx, 0, new HumanMessage({
                            content: lines.join('\n\n'),
                            response_metadata: { injectedBy: 'CaseContextMiddleware' },
                        }))
                    }
                }
                catch (err) {
                    logger.error('[CaseContextMiddleware] 注入案件上下文失败', { caseId, agentName, err })
                }

                return { _caseContextInjected: true }
            },
        },
    })
