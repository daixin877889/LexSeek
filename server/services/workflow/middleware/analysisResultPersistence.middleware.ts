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
import {
    createAnalysisDao,
    updateAnalysisDao,
    getNextVersionDao,
    deactivateVersionsDao,
    AnalysisStatus,
} from '../../case/analysis.dao'
import { failAnalysisService } from '../../case/analysis.service'
import { getNodeByNameService } from '../../node/node.service'

/** 中间件参数 */
interface AnalysisResultPersistenceOptions {
    /** Agent 名称（对应 nodes 表 name 字段） */
    agentName: string
    /** 案件 ID */
    caseId: number
    /** 会话 ID */
    sessionId: string
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
    const { agentName, caseId, sessionId } = options

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
                    const node = await getNodeByNameService(agentName)
                    if (!node) return

                    const resultText = extractLastAIMessageContent(state.messages ?? [])
                    if (!resultText) {
                        logger.warn('分析持久化：未找到 AIMessage 内容', { analysisRecordId, agentName })
                    }

                    await prisma.$transaction(async (tx: any) => {
                        await deactivateVersionsDao(caseId, node.id, tx)
                        await updateAnalysisDao(analysisRecordId, {
                            analysisResult: resultText ?? '',
                            status: AnalysisStatus.COMPLETED,
                            isActive: true,
                        }, tx)
                    })

                    logger.info('分析持久化：完成分析记录', {
                        analysisId: analysisRecordId,
                        agentName,
                        resultLength: resultText?.length ?? 0,
                    })
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
