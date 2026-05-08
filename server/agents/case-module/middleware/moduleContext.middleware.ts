/**
 * 模块上下文注入中间件
 *
 * 在 Agent 首次运行时（_moduleContextInjected=false）注入案件档案 +
 * 已完成模块摘要 + 动态上下文（记忆 + 材料清单），富化 5 段式 prompt。
 *
 * 与 caseMaterialContextMiddleware（MATERIAL_CONTEXT=30）互斥，
 * buildMiddlewareStack 会在两者同时挂载时自动抛错。
 *
 * @see server/agents/case-module/agent.config.ts
 */

import { createMiddleware } from 'langchain'
import { HumanMessage } from '@langchain/core/messages'
import { z } from 'zod'
import { buildContextSegments } from '~~/server/services/agent-platform/context/moduleContextBuilder'

/**
 * 模块上下文注入中间件工厂
 *
 * @param caseId   案件 ID
 * @param moduleName 模块名（对应 nodes.name，如 caseAnalysisSummary）
 */
export const moduleContextMiddleware = (caseId: number, moduleName: string) =>
    createMiddleware({
        name: 'ModuleContextMiddleware',
        stateSchema: z.object({
            _moduleContextInjected: z.boolean().default(false),
        }),

        beforeAgent: {
            hook: async (state: any) => {
                // 已注入则跳过（多轮对话只注入一次）
                if (state._moduleContextInjected) return

                const messages: any[] = state.messages ?? []

                // 提取最新用户消息作为 userQuery（用于记忆召回）
                const lastHuman = [...messages].reverse().find(
                    m => m._getType?.() === 'human' || m.constructor?.name === 'HumanMessage',
                )
                const userQuery = typeof lastHuman?.content === 'string' ? lastHuman.content : ''

                try {
                    const segments = await buildContextSegments({ caseId, agentName: moduleName, userQuery })

                    const lines: string[] = []
                    if (segments.caseProfile) lines.push(segments.caseProfile)
                    if (segments.moduleSummaries) lines.push(segments.moduleSummaries)
                    if (segments.dynamicContext) lines.push(segments.dynamicContext)

                    if (lines.length > 0) {
                        // 插入到 SystemMessage 之后（与 caseMaterialContextMiddleware 保持一致）
                        const systemIdx = messages.findIndex(m => m._getType?.() === 'system')
                        const insertIdx = systemIdx >= 0 ? systemIdx + 1 : 0
                        messages.splice(insertIdx, 0, new HumanMessage({
                            content: lines.join('\n\n'),
                            response_metadata: { injectedBy: 'ModuleContextMiddleware' },
                        }))
                    }
                }
                catch (err) {
                    logger.error('[ModuleContextMiddleware] 注入模块上下文失败', { caseId, moduleName, err })
                }

                return { _moduleContextInjected: true }
            },
        },
    })
