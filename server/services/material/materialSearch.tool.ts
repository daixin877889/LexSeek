/**
 * 案件材料检索工具
 *
 * 提供 LangGraph 工作流中使用的材料检索工具
 * 用于在 AI 分析过程中检索当前案件的相关材料内容
 * 支持三种检索模式：语义搜索、精确检索、组合检索
 * Requirements: 12.1.1-12.1.4
 */

import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { Document } from '@langchain/core/documents'
import {
    searchCaseMaterialsService,
    caseMaterialVectorConfig,
    type MaterialSearchResult,
    type ContentEmbeddingMetadata,
} from './materialEmbedding.service'
import {
    similaritySearchWithScore,
} from '~~/server/services/legal/vectorStore.service'
import { getMaterialsByCaseIdService } from './material.service'
import { getSourceId, fetchMaterialContents } from './materialPipeline.service'

/** 材料检索工具输入参数 */
export interface MaterialSearchToolInput {
    /** 查询内容 */
    query?: string
    /** 材料 sourceId */
    sourceId?: number
    /** 返回结果数量，默认 5 */
    k?: number
}

/** 材料检索工具上下文（运行时注入） */
export interface MaterialSearchToolContext {
    /** 用户 ID */
    userId: number
    /** 案件 ID */
    caseId: number
}

/**
 * 创建案件材料检索工具
 *
 * 由于 LangGraph 工具需要在运行时获取 userId 和 caseId，
 * 因此使用工厂函数创建工具实例，将上下文信息绑定到工具中
 *
 * @param context 工具上下文（包含 userId 和 caseId）
 * @returns LangGraph 工具实例
 */
export function createMaterialSearchTool(context: MaterialSearchToolContext) {
    const { userId, caseId } = context

    return tool(
        async (input: MaterialSearchToolInput): Promise<string> => {
            const { query, sourceId, k = 5 } = input

            logger.info('执行材料检索工具', {
                userId,
                caseId,
                query,
                sourceId,
                k,
            })

            try {
                // 1. 获取案件材料列表
                const allMaterials = await getMaterialsByCaseIdService(caseId)

                // 2. 按 sourceId 过滤（如果指定）
                const targetMaterials = sourceId
                    ? allMaterials.filter(m => getSourceId(m) === sourceId)
                    : allMaterials

                if (targetMaterials.length === 0) {
                    return JSON.stringify({ error: '未找到指定材料' })
                }

                // 3. 无 query → 精确查询完整内容
                if (!query) {
                    const contentMap = await fetchMaterialContents(targetMaterials)
                    const exactResults = targetMaterials.map((m, index) => ({
                        index: index + 1,
                        content: contentMap.get(m.id) || '[暂无内容]',
                        source: {
                            sourceId: getSourceId(m),
                            sourceName: m.name,
                        },
                    }))
                    return JSON.stringify(exactResults)
                }

                // 4. 有 query → 向量语义搜索，用 sourceId IN 限定范围
                const sourceIds = targetMaterials.map(m => getSourceId(m))
                const filter: Record<string, any> = {
                    userId,
                    sourceId: { in: sourceIds.map(String) },
                }
                const results = await similaritySearchWithScore(query, k, filter, caseMaterialVectorConfig)

                // 5. 格式化结果
                const formattedResults = results.map(([doc, score]: [Document, number], index: number) => {
                    const metadata = doc.metadata as ContentEmbeddingMetadata
                    return {
                        index: index + 1,
                        content: doc.pageContent,
                        source: {
                            sourceId: metadata.sourceId,
                            sourceName: metadata.sourceName,
                            chunkIndex: metadata.chunkIndex,
                        },
                        relevanceScore: Number(score.toFixed(4)),
                    }
                })

                logger.info('材料检索完成', {
                    caseId,
                    resultCount: formattedResults.length,
                })

                return JSON.stringify(formattedResults)
            } catch (error) {
                logger.error('材料检索失败:', error)
                return JSON.stringify({
                    error: '材料检索失败',
                    message: error instanceof Error ? error.message : '未知错误',
                })
            }
        },
        {
            name: 'search_case_materials',
            description: '检索当前案件的材料内容。支持语义搜索（传 query）、精确检索（传 sourceId）、或组合检索（query + sourceId 限定范围）。返回最相关的材料内容片段及来源信息。',
            schema: z.object({
                query: z.string().optional().describe('语义查询内容，用于搜索相关的材料片段'),
                sourceId: z.number().optional().describe('材料 sourceId，精确检索或限定语义搜索范围到指定材料'),
                k: z.number().optional().default(5).describe('返回结果数量，默认为 5'),
            }).refine(
                data => data.query || data.sourceId,
                { message: '至少需要提供 query 或 sourceId' }
            ),
        }
    )
}

/**
 * 直接调用材料检索（非工具形式）
 *
 * 提供给非 LangGraph 场景使用的检索方法
 * @param userId 用户 ID
 * @param caseId 案件 ID
 * @param query 查询内容
 * @param k 返回结果数量
 * @param sourceIds 限定检索范围的 sourceId 列表
 * @returns 检索结果
 */
export async function searchCaseMaterials(
    userId: number,
    caseId: number,
    query: string,
    k: number = 5,
    sourceIds?: number[],
): Promise<MaterialSearchResult[]> {
    return searchCaseMaterialsService(userId, caseId, query, k, sourceIds)
}

/**
 * 获取材料检索工具的元信息
 *
 * 用于在工作流配置中展示工具信息
 */
export const materialSearchToolMeta = {
    name: 'search_case_materials',
    description: '检索当前案件的材料内容。支持语义搜索、精确检索、组合检索',
    parameters: {
        query: {
            type: 'string',
            description: '语义查询内容，用于搜索相关的材料片段',
            required: false,
        },
        sourceId: {
            type: 'number',
            description: '材料 sourceId，精确检索或限定语义搜索范围到指定材料',
            required: false,
        },
        k: {
            type: 'number',
            description: '返回结果数量，默认为 5',
            required: false,
            default: 5,
        },
    },
}
