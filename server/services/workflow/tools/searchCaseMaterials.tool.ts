/**
 * 案件材料检索工作流工具
 *
 * 工作流工具层 - 调用 material 服务层的查询逻辑
 * 支持三种检索模式：
 * - query only: 语义搜索，caseId→sourceId 限定范围
 * - query + sourceId: 语义搜索，限定到指定 sourceId
 * - sourceId only: 精确查询完整内容
 * Requirements: 12.2.1-12.2.4
 */

import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { Document } from '@langchain/core/documents'
import {
    similaritySearchWithScore,
    type VectorStoreConfig,
} from '~~/server/services/legal/vectorStore.service'
import {
    caseMaterialVectorConfig,
    type ContentEmbeddingMetadata,
} from '../../material/materialEmbedding.service'
import { getMaterialsByCaseIdService } from '../../material/material.service'
import { getSourceId, fetchMaterialContents } from '../../material/materialPipeline.service'
import type { ToolDefinition, ToolContext } from './types'

/** 参数 schema（唯一数据源） */
const schema = z.object({
    query: z.string().optional().describe('语义查询内容，用于搜索相关的材料片段'),
    sourceId: z.number().optional().describe('材料 sourceId，精确检索或限定语义搜索范围到指定材料'),
    k: z.number().optional().default(5).describe('返回结果数量，默认为 5'),
}).refine(
    data => data.query || data.sourceId,
    { message: '至少需要提供 query 或 sourceId' }
)

/** 工具定义（单一数据源） */
export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'search_case_materials',
    description: '检索当前案件的材料内容。支持语义搜索（传 query）、精确检索（传 sourceId）、或组合检索（query + sourceId 限定范围）。返回最相关的材料内容片段及来源信息。',
    schema,
}

/**
 * 创建案件材料检索工具
 *
 * @param context 工具上下文（包含 userId、caseId、sessionId）
 * @returns LangGraph 工具实例
 */
export function createTool(context: ToolContext) {
    const { userId, caseId } = context

    return tool(
        async (input) => {
            const { query, sourceId, k = 5 } = input

            logger.info('执行材料检索工作流工具', {
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
            name: toolDefinition.name,
            description: toolDefinition.description,
            schema: toolDefinition.schema,
        }
    )
}
