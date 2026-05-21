/**
 * 分析结果持久化中间件
 *
 * beforeAgent: 创建 IN_PROGRESS 分析记录
 * afterAgent: 提取 AIMessage 内容，更新为 COMPLETED 并设置 isActive
 *
 * 放在 middleware 数组末位，确保 afterAgent 在所有其他中间件之后执行
 */

import { createMiddleware } from 'langchain'
import { z } from 'zod'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import {
    createAnalysisDao,
    updateAnalysisDao,
    getNextVersionDao,
    findAnalysisBySessionAndNodeDao,
    findAnalysisByIdDao,
    AnalysisStatus,
} from '~~/server/services/case/analysis.dao'
import { failAnalysisService } from '~~/server/services/case/analysis.service'
import { completeAnalysisWithRAG } from '~~/server/services/case/initAnalysis.service'
import { getNodeByNameService } from '~~/server/services/node/node.service'
import { publishCustomEvent } from '~~/server/services/agent/agentEventBridge'
import { SSECustomEventType } from '#shared/types/agentEvent'
import { stripContentBeforeFirstH1 } from '#shared/utils/markdown'

/** 中间件参数 */
interface AnalysisResultPersistenceOptions {
    /** Agent 名称（对应 nodes 表 name 字段） */
    agentName: string
    /** 案件 ID */
    caseId: number
    /** 会话 ID（子代理也用主流 sessionId 让前端能收到事件） */
    sessionId: string
    /** 用于生成 summary 的模型实例 */
    model: BaseChatModel
    /**
     * 主 Agent run id（agentRuns.id）。
     * 子代理跑完后用这个 runId publish ANALYSIS_RESULT_SAVED 事件让前端列表刷新。
     * 不传则跳过事件发送（向后兼容，不阻塞历史调用）。
     */
    runId?: string
}

/**
 * 从消息列表中提取最后一条 AIMessage 的文本内容
 */
export function extractLastAIMessageContent(messages: any[]): string | null {
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i]
        if (msg._getType?.() === 'ai' || msg.constructor?.name === 'AIMessage') {
            const content = msg.content
            if (typeof content === 'string') {
                return content
            }
            if (Array.isArray(content)) {
                return content
                    .filter((c: any) => c.type === 'text')
                    .map((c: any) => c.text)
                    .join('')
            }
        }
    }
    return null
}

/**
 * 分析结果持久化中间件
 */
export const analysisResultPersistenceMiddleware = (
    options: AnalysisResultPersistenceOptions
) => {
    const { agentName, caseId, sessionId, model, runId } = options

    return createMiddleware({
        name: 'AnalysisResultPersistenceMiddleware',
        stateSchema: z.object({
            _analysisRecordId: z.number().optional(),
        }),

        beforeAgent: {
            hook: async (_state: any) => {
                try {
                    const node = await getNodeByNameService(agentName)
                    if (!node) {
                        logger.error('分析持久化中间件：节点不存在', { agentName })
                        return
                    }

                    // 1. 查找同 (sessionId, nodeId) 的 FAILED 或 IN_PROGRESS 记录，复用
                    const existingFailed = await findAnalysisBySessionAndNodeDao(
                        sessionId, node.id, AnalysisStatus.FAILED
                    )
                    if (existingFailed) {
                        await updateAnalysisDao(existingFailed.id, {
                            status: AnalysisStatus.IN_PROGRESS,
                            analysisResult: null,
                        })
                        logger.info('分析持久化：复用 FAILED 记录', {
                            analysisId: existingFailed.id,
                            agentName,
                            version: existingFailed.version,
                        })
                        return { _analysisRecordId: existingFailed.id }
                    }

                    const existingInProgress = await findAnalysisBySessionAndNodeDao(
                        sessionId, node.id, AnalysisStatus.IN_PROGRESS
                    )
                    if (existingInProgress) {
                        logger.info('分析持久化：复用 IN_PROGRESS 记录', {
                            analysisId: existingInProgress.id,
                            agentName,
                        })
                        return { _analysisRecordId: existingInProgress.id }
                    }

                    // 2. 无可复用记录，创建新版本
                    const record = await prisma.$transaction(async (tx: any) => {
                        const nextVersion = await getNextVersionDao(caseId, node.id, tx)
                        return await createAnalysisDao({
                            caseId,
                            sessionId,
                            nodeId: node.id,
                            analysisType: agentName,
                            version: nextVersion,
                            status: AnalysisStatus.IN_PROGRESS,
                            isActive: false,
                        }, tx)
                    })

                    logger.info('分析持久化：创建 IN_PROGRESS 记录', {
                        analysisId: record.id,
                        agentName,
                        caseId,
                        version: record.version,
                    })

                    return { _analysisRecordId: record.id }
                } catch (error) {
                    logger.error('分析持久化 beforeAgent 异常', { agentName, caseId, error })
                }
            },
        },

        afterAgent: {
            hook: async (state: any) => {
                const analysisRecordId = state._analysisRecordId
                if (!analysisRecordId) return

                try {
                    // ────────────────────────────────────────────────────────────
                    // 幂等检查：save_analysis_result 工具已用 _analysisRecordId 走过
                    // completeAnalysisWithRAG 把记录改成 COMPLETED 时，afterAgent
                    // 必须跳过——否则 RAG 切块会重复写一份、summary 也会被重算覆盖。
                    // 仅当记录仍是 IN_PROGRESS 时（LLM 没调工具 / 工具异常退出）
                    // afterAgent 才走兜底落库，保障"分析结果一定保存"的不变量。
                    // ────────────────────────────────────────────────────────────
                    const existing = await findAnalysisByIdDao(analysisRecordId)
                    if (existing && existing.status === AnalysisStatus.COMPLETED) {
                        logger.info('分析持久化：工具已完成保存，afterAgent 跳过', {
                            analysisRecordId,
                            agentName,
                        })
                        return
                    }

                    const resultText = extractLastAIMessageContent(state.messages ?? [])
                    if (!resultText) {
                        logger.warn('分析持久化：未找到 AIMessage 内容，跳过落库', { analysisRecordId, agentName })
                        return
                    }
                    // 清洗 LLM 偶发的前言说明文字，落库前必须去掉一级标题之前的内容
                    const cleanedResultText = stripContentBeforeFirstH1(resultText)

                    // 提取 token 用量。两条路双保险：
                    //   1) 优先遍历 state.messages 累加 AIMessage.usage_metadata.total_tokens
                    //      —— 这是 LangChain SDK 直接填的 provider 响应字段，**不经任何 middleware
                    //      reducer**，最稳。pointConsumption 内部 getTokenCount 也是先读这个字段。
                    //   2) 兜底：state._totalTokensConsumed（pointConsumptionMiddleware 累计），
                    //      仅当上一条路完全没拿到时使用。
                    let tokensFromMessages = 0
                    for (const m of (state.messages ?? []) as any[]) {
                        const t = m?._getType?.() ?? m?.type
                        if (t !== 'ai') continue
                        const used = m?.usage_metadata?.total_tokens
                        if (typeof used === 'number' && used > 0) tokensFromMessages += used
                    }
                    const tokensFromState = (state._totalTokensConsumed as number | undefined) ?? 0
                    const totalTokens = tokensFromMessages > 0 ? tokensFromMessages : tokensFromState
                    const tokens = totalTokens > 0 ? totalTokens : null
                    const tokenCount = totalTokens > 0 ? Math.ceil(totalTokens / 1000) : null

                    logger.info('分析持久化：token 提取', {
                        analysisRecordId,
                        agentName,
                        tokensFromMessages,
                        tokensFromState,
                        finalTokens: tokens,
                        finalTokenCount: tokenCount,
                    })

                    await completeAnalysisWithRAG({
                        analysisId: analysisRecordId,
                        analysisResult: cleanedResultText,
                        tokens,
                        tokenCount,
                    })

                    logger.info('分析持久化：完成分析记录', {
                        analysisId: analysisRecordId,
                        agentName,
                        resultLength: cleanedResultText.length,
                        tokens,
                        tokenCount,
                    })

                    // 发 ANALYSIS_RESULT_SAVED 事件让前端分析模块列表刷新（caseMain 主流子代理同款体验）
                    if (runId) {
                        try {
                            await publishCustomEvent({
                                type: 'custom_event',
                                runId,
                                sessionId,
                                name: SSECustomEventType.ANALYSIS_RESULT_SAVED,
                                data: {
                                    moduleName: agentName,
                                    analysisId: analysisRecordId,
                                    tokens,
                                    tokenCount,
                                },
                            })
                        } catch (err) {
                            logger.warn('publishCustomEvent(ANALYSIS_RESULT_SAVED) 失败', { analysisRecordId, err })
                        }
                    }
                } catch (error) {
                    logger.error('分析持久化 afterAgent 异常', {
                        analysisRecordId,
                        agentName,
                        error,
                    })
                }
            },
        },
    })
}

/**
 * 标记指定分析记录为失败
 * 用于 Agent 异常时在 catch 块中调用
 */
export const markAnalysisFailedById = async (analysisId: number): Promise<void> => {
    try {
        await failAnalysisService(analysisId)
        logger.info('分析持久化：标记为 FAILED', { analysisId })
    } catch (error) {
        logger.error('标记分析失败异常', { analysisId, error })
    }
}
