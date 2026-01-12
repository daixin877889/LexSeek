/**
 * 案件材料检索工具
 *
 * 提供 LangGraph 工作流中使用的材料检索工具
 * 用于在 AI 分析过程中检索当前案件的相关材料内容
 * Requirements: 12.1.1-12.1.4
 */

import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import {
    searchCaseMaterialsService,
    type MaterialSearchResult,
} from './materialEmbedding.service'

/** 材料检索工具输入参数 */
export interface MaterialSearchToolInput {
    /** 查询内容 */
    query: string
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
            const { query, k = 5 } = input

            logger.info('执行材料检索工具', {
                userId,
                caseId,
                query,
                k,
            })

            try {
                // 调用材料检索服务
                const results = await searchCaseMaterialsService(userId, caseId, query, k)

                // 格式化返回结果
                const formattedResults = formatSearchResults(results)

                logger.info('材料检索完成', {
                    caseId,
                    resultCount: results.length,
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
            description: '检索当前案件的材料内容，用于查找与分析相关的材料片段。仅在当前案件的材料范围内搜索，返回最相关的材料内容片段及来源信息。',
            schema: z.object({
                query: z.string().describe('查询内容，用于搜索相关的材料片段'),
                k: z.number().optional().default(5).describe('返回结果数量，默认为 5'),
            }),
        }
    )
}

/**
 * 格式化检索结果
 *
 * 将检索结果转换为适合 AI 阅读的格式
 * @param results 检索结果列表
 * @returns 格式化后的结果
 */
function formatSearchResults(results: MaterialSearchResult[]): FormattedSearchResult[] {
    return results.map((result, index) => ({
        index: index + 1,
        content: result.content,
        source: {
            materialId: result.materialId,
            materialName: result.materialName,
            chunkIndex: result.chunkIndex,
        },
        relevanceScore: Number(result.score.toFixed(4)),
    }))
}

/** 格式化后的检索结果 */
interface FormattedSearchResult {
    /** 结果序号 */
    index: number
    /** 内容片段 */
    content: string
    /** 来源信息 */
    source: {
        /** 材料 ID */
        materialId: number
        /** 材料名称 */
        materialName: string
        /** 分块索引 */
        chunkIndex: number
    }
    /** 相关度分数 */
    relevanceScore: number
}

/**
 * 直接调用材料检索（非工具形式）
 *
 * 提供给非 LangGraph 场景使用的检索方法
 * @param userId 用户 ID
 * @param caseId 案件 ID
 * @param query 查询内容
 * @param k 返回结果数量
 * @returns 检索结果
 */
export async function searchCaseMaterials(
    userId: number,
    caseId: number,
    query: string,
    k: number = 5
): Promise<MaterialSearchResult[]> {
    return searchCaseMaterialsService(userId, caseId, query, k)
}

/**
 * 获取材料检索工具的元信息
 *
 * 用于在工作流配置中展示工具信息
 */
export const materialSearchToolMeta = {
    name: 'search_case_materials',
    description: '检索当前案件的材料内容，用于查找与分析相关的材料片段',
    parameters: {
        query: {
            type: 'string',
            description: '查询内容，用于搜索相关的材料片段',
            required: true,
        },
        k: {
            type: 'number',
            description: '返回结果数量，默认为 5',
            required: false,
            default: 5,
        },
    },
}
