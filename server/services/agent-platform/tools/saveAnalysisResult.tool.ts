/**
 * 保存分析结果工作流工具
 *
 * Agent 专用工具，在模块对话中保存分析结果到 case_analyses 表。
 *
 * 执行流程：
 *   1. 从 runtime.state.messages 倒序找最近一条带文本的 AIMessage（即用户看到的分析报告正文）
 *   2. 在事务内保存 + 激活新版本（saveAndActivateAnalysisService）
 *   3. emit ANALYSIS_RESULT_SAVED → 前端刷新分析结果展示
 *   4. emit ANALYSIS_SUMMARY{phase:'start'} → 前端合成"生成结果摘要" 卡片，input-available
 *   5. await completeAnalysisWithRAG → 真实生成 200-400 字摘要 + embedding 切块
 *   6. emit ANALYSIS_SUMMARY{phase:'end'} → 前端摘要卡片切到 output-available/output-error
 *   7. tool return → save 卡片切到 output-available
 *
 * 设计动因：
 *   - schema 不收正文：避免 LLM 把已生成的 markdown 复述一遍作为工具入参（输出量翻倍）
 *   - summary 同步 await：父 run COMPLETED 后 SSE 流立即关闭，fire-and-forget 的事件到不了前端
 *
 * 注意：本工具仍然从 Agent 状态中读取 _totalTokensConsumed，记录 token 消耗数据。
 */

import { tool } from '@langchain/core/tools'
import type { ToolRuntime } from '@langchain/core/tools'
import type { BaseMessage } from '@langchain/core/messages'
import { z } from 'zod'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { ToolContext, ToolDefinition } from './types'
import { saveAndActivateAnalysisService } from '~~/server/services/case/analysis.service'
import { completeAnalysisWithRAG } from '~~/server/services/case/initAnalysis.service'
import { publishCustomEvent } from '~~/server/services/agent/agentEventBridge'
import { SSECustomEventType } from '#shared/types/agentEvent'
import type { AnalysisSummaryPayload } from '#shared/types/agentEvent'

/**
 * 参数 schema：空对象。
 *
 * langchain 的 tool() 工厂要求 schema 必须存在，但这里我们刻意不收任何参数 ——
 * 分析报告正文从 state.messages 自动读取，避免 LLM 复述输出。
 */
const schema = z.object({})

/** 工具定义 */
export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'save_analysis_result',
    description: '保存分析结果。当你完成该模块的分析后，请按以下顺序：1) 先以纯文本形式输出完整的分析报告（Markdown 格式）；2) 然后调用此工具（无需任何参数）。工具会自动从你刚输出的报告中读取内容保存。请勿在工具参数中重复正文。',
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
     * 获取 Agent 状态的函数（用于读取 _totalTokensConsumed 等跨 worker 共享状态）
     * runtime.state 已带 LangGraph state（含 messages 与 stateSchema 声明的字段），
     * 此处保留是为了兼容历史 Redis-side state 写入路径
     */
    getState?: () => Promise<Record<string, any> | null>
    /** 用于 RAG summary 生成的模型实例 */
    model: BaseChatModel
}

/**
 * LangGraph state 形态（stateSchema 含 messages + pointConsumption 注入的 token 字段）。
 *
 * 必须显式带 index signature 让 TS 把它视作 Record<string, unknown> 子类型，
 * 否则 ToolRuntime<TState>.state 的条件分支会回退到 unknown（第二条 extends Record 失败）。
 */
type AgentStateShape = {
    messages: BaseMessage[]
    _totalTokensConsumed?: number
    _totalPointsConsumed?: number
    [key: string]: unknown
}

/**
 * 从消息历史倒序找最近一条带文本内容的 AIMessage。
 *
 * 兼容三种 content 形态：
 *   - string                       （OpenAI / DeepSeek 标准）
 *   - Array<{type:'text',text}>    （Anthropic content blocks）
 *   - Array<含 thinking/reasoning> （只取 type==='text' 部分，排除思考块）
 *
 * 倒序往前找的原因：当 LLM 把"调工具"和"输出正文"分到两条 AIMessage 时，
 * 最后一条 AIMessage 可能 content 为空（只带 tool_calls），需要回退到前一条带正文的。
 *
 * @returns 找到的 AIMessage 的 id 与文本，找不到时返回 null
 */
function extractLastAiText(messages: BaseMessage[] | undefined): { messageId: string; text: string } | null {
    if (!messages?.length) return null
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i]
        if (!m) continue
        const type = (m as any)._getType?.() ?? (m as any).type
        if (type !== 'ai') continue

        const content = (m as any).content
        let text = ''
        if (typeof content === 'string') {
            text = content
        } else if (Array.isArray(content)) {
            text = content
                .filter((b: any) => b && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string')
                .map((b: any) => b.text)
                .join('')
        }

        if (text.trim()) {
            return {
                messageId: (m as any).id ?? '',
                text,
            }
        }
    }
    return null
}

/**
 * 创建保存分析结果工具
 *
 * @param context 模块工具上下文
 * @returns LangGraph 工具实例
 */
export function createTool(context: ModuleToolContext) {
    return tool(
        async (_input: z.infer<typeof schema>, runtime: ToolRuntime<AgentStateShape>) => {
            try {
                // ── 1. 校验上下文 ──
                if (context.caseId == null) {
                    throw new Error('save_analysis_result 工具需要 caseId，当前上下文缺失（可能 scope 路由错误）')
                }

                // ── 2. 从 state.messages 提取分析报告正文 ──
                const lastAi = extractLastAiText(runtime.state?.messages)
                if (!lastAi) {
                    throw new Error('未找到带文本内容的 AI 消息，请先以纯文本形式输出完整的分析报告，再调用此工具')
                }

                // ── 3. 读取 token 消耗（与改造前同口径）──
                let tokenCount: number | null = null
                let tokens: number | null = null

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

                if (tokens === null || tokens === 0) {
                    const stateFromRuntime = runtime.state
                    if (stateFromRuntime) {
                        const totalTokens = stateFromRuntime._totalTokensConsumed ?? 0
                        if (totalTokens > 0) {
                            tokens = totalTokens
                            tokenCount = Math.ceil(totalTokens / 1000)
                        }
                    }
                }

                // ── 4. 保存 + 激活（事务内）──
                const analysis = await saveAndActivateAnalysisService({
                    caseId: context.caseId,
                    sessionId: context.sessionId,
                    nodeId: context.nodeId,
                    analysisType: context.moduleName,
                    analysisResult: lastAi.text,
                    tokenCount,
                    tokens,
                })

                // ── 5. 通知前端刷新分析结果 ──
                await publishCustomEvent({
                    type: 'custom_event',
                    runId: context.runId,
                    sessionId: context.sessionId,
                    name: SSECustomEventType.ANALYSIS_RESULT_SAVED,
                    data: {
                        version: analysis.version,
                        moduleName: context.moduleName,
                        analysisId: analysis.id,
                        tokens,
                        tokenCount,
                    },
                })

                // ── 6. 摘要进度卡片：start 事件 ──
                // parentMessageId 用 lastAi.messageId 让前端把合成卡片挂到触发 save 的那条 AIMessage 上，
                // 这样它紧跟在 save_analysis_result 卡片之后渲染，视觉上构成两张并列的工具卡片。
                const summaryToolCallId = crypto.randomUUID()
                const startPayload: AnalysisSummaryPayload = {
                    phase: 'start',
                    toolCallId: summaryToolCallId,
                    parentMessageId: lastAi.messageId,
                    analysisId: analysis.id,
                }
                await publishCustomEvent({
                    type: 'custom_event',
                    runId: context.runId,
                    sessionId: context.sessionId,
                    name: SSECustomEventType.ANALYSIS_SUMMARY,
                    data: startPayload,
                })

                // ── 7. 同步生成摘要 + RAG embedding ──
                // 这里必须 await：父 run 进入 COMPLETED 时 SSE 流会立即关闭，
                // fire-and-forget 的 end 事件到不了前端
                let endPayload: AnalysisSummaryPayload
                try {
                    const summary = await completeAnalysisWithRAG({
                        analysisId: analysis.id,
                        analysisResult: lastAi.text,
                    })
                    endPayload = {
                        phase: 'end',
                        toolCallId: summaryToolCallId,
                        parentMessageId: lastAi.messageId,
                        analysisId: analysis.id,
                        success: true,
                        summary,
                    }
                } catch (e: any) {
                    logger.warn('completeAnalysisWithRAG 失败（save 已落库，仅摘要降级）', { error: e })
                    endPayload = {
                        phase: 'end',
                        toolCallId: summaryToolCallId,
                        parentMessageId: lastAi.messageId,
                        analysisId: analysis.id,
                        success: false,
                        error: e?.message || '生成摘要失败',
                    }
                }

                await publishCustomEvent({
                    type: 'custom_event',
                    runId: context.runId,
                    sessionId: context.sessionId,
                    name: SSECustomEventType.ANALYSIS_SUMMARY,
                    data: endPayload,
                })

                // ── 8. tool return（save 卡片完成态）──
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
