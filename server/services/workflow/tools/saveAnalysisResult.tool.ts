/**
 * 保存分析结果工作流工具
 *
 * Agent 专用工具，在模块对话中保存分析结果到 case_analyses 表
 * 在单个事务内完成保存+激活，并通过自定义事件通知前端刷新
 */

import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { ToolContext, ToolDefinition } from './types'
import { saveAndActivateAnalysisService } from '../../case/analysis.service'
import { publishCustomEvent } from '../../agent/agentEventBridge'

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
}

/**
 * 创建保存分析结果工具
 *
 * @param context 模块工具上下文
 * @returns LangGraph 工具实例
 */
export function createTool(context: ModuleToolContext) {
    return tool(
        async (input) => {
            try {
                // 保存+激活（事务内完成）
                const analysis = await saveAndActivateAnalysisService({
                    caseId: context.caseId,
                    sessionId: context.sessionId,
                    nodeId: context.nodeId,
                    analysisType: context.moduleName,
                    analysisResult: input.analysisResult,
                })

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
                    },
                })

                return JSON.stringify({
                    success: true,
                    version: analysis.version,
                    message: `分析结果已保存为第${analysis.version}版`,
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
