/**
 * 保存分析结果工作流工具
 *
 * Agent 专用工具，在模块对话中保存分析结果到 case_analyses 表
 * 在单个事务内完成保存 + 激活，并通过自定义事件通知前端刷新
 *
 * 注意：本工具会从 Agent 状态中读取 _totalTokensConsumed 和 _totalPointsConsumed，
 * 并在保存分析结果时记录 token 消耗数据。
 */

import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { ToolContext, ToolDefinition } from './types'
import { saveAndActivateAnalysisService } from '~~/server/services/case/analysis.service'
import { completeAnalysisWithRAG } from '~~/server/services/case/initAnalysis.service'
import { publishCustomEvent } from '~~/server/services/agent/agentEventBridge'
import { getTokenCount } from '~~/server/services/agent-platform/middleware/pointConsumption.middleware'

/** 参数 schema */
const schema = z.object({
    analysisResult: z.string().describe('分析结果内容，Markdown 格式'),
})

/** 工具定义 */
export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'save_analysis_result',
    description: '保存分析结果。当你生成或更新了该模块的分析结果时，必须调用此工具保存。',
    schema,
}

/** 模块对话工具上下文（扩展基础 ToolContext） */
export interface ModuleToolContext extends ToolContext {
    /** 模块名称 */
    moduleName: string
    /** 节点 ID */
    nodeId: number
    /** 运行 ID（必填） */
    runId: string
    /**
     * 获取 Agent 状态的函数
     * 用于读取 token 消耗等状态信息
     */
    getState?: () => Promise<Record<string, any> | null>
    /** 用于 RAG summary 生成的模型实例 */
    model: BaseChatModel
}

/**
 * 创建保存分析结果工具
 *
 * @param context 模块工具上下文
 * @returns LangGraph 工具实例
 */
export function createTool(context: ModuleToolContext) {
    return tool(
        async (input, config) => {
            try {
                // 从 Agent 状态中读取 token 消耗
                let tokenCount: number | null = null
                let tokens: number | null = null

                // 尝试从状态中获取 token 信息
                if (context.getState) {
                    const state = await context.getState()
                    if (state) {
                        const totalTokens = state._totalTokensConsumed ?? 0
                        if (totalTokens > 0) {
                            tokens = totalTokens
                            tokenCount = Math.ceil(totalTokens / 1000)
                        }
                    }
                }

                // 如果通过 getState 没有获取到 token 信息，尝试从 config 中获取
                if (tokens === null || tokens === 0) {
                    // 尝试从 config 的 configurable 中获取状态
                    const configurable = config?.configurable as Record<string, any> | undefined
                    const state = configurable?.state as Record<string, any> | undefined
                    if (state) {
                        const totalTokens = state._totalTokensConsumed ?? 0
                        if (totalTokens > 0) {
                            tokens = totalTokens
                            tokenCount = Math.ceil(totalTokens / 1000)
                        }
                    }
                }

                // 保存 + 激活（事务内完成）
                // caseId 是模块对话场景的必需字段；若为 undefined 说明上游路由错误（assistant 域误入）
                if (context.caseId == null) {
                    throw new Error('save_analysis_result 工具需要 caseId，当前上下文缺失（可能 scope 路由错误）')
                }
                const analysis = await saveAndActivateAnalysisService({
                    caseId: context.caseId,
                    sessionId: context.sessionId,
                    nodeId: context.nodeId,
                    analysisType: context.moduleName,
                    analysisResult: input.analysisResult,
                    tokenCount,
                    tokens,
                })

                // Fire-and-forget：生成 summary + 写 embeddings，不阻塞工具响应
                completeAnalysisWithRAG({
                    analysisId: analysis.id,
                    analysisResult: input.analysisResult,
                    model: context.model,
                }).catch((e) => logger.warn('completeAnalysisWithRAG fire-and-forget 失败', { error: e }))

                // 发布自定义事件通知前端
                await publishCustomEvent({
                    type: 'custom_event',
                    runId: context.runId,
                    sessionId: context.sessionId,
                    name: 'analysis_result_saved',
                    data: {
                        version: analysis.version,
                        moduleName: context.moduleName,
                        analysisId: analysis.id,
                        tokens,
                        tokenCount,
                    },
                })

                return JSON.stringify({
                    success: true,
                    version: analysis.version,
                    message: `分析结果已保存为第${analysis.version}版`,
                    tokens,
                    tokenCount,
                })
            }
            catch (error: any) {
                logger.error('save_analysis_result 工具执行失败', { error })
                return JSON.stringify({
                    success: false,
                    error: error.message || '保存分析结果失败',
                })
            }
        },
        {
            name: toolDefinition.name,
            description: toolDefinition.description,
            schema: toolDefinition.schema,
        },
    )
}
