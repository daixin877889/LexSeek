/**
 * Rerank 精排服务
 *
 * 调用阿里云百炼 Rerank API 对检索结果进行精排，支持阈值过滤和降级处理
 */

import { getRerankConfigWithFallbackService } from '../model/modelConfig.service'
import type { SearchResultItem } from './types'

/** Rerank API 单条结果 */
interface RerankApiResult {
    index: number
    relevance_score: number
}

/** Rerank 最大输入文档数 */
const MAX_RERANK_DOCS = 20

/** Rerank API 超时时间（毫秒） */
const RERANK_TIMEOUT_MS = 5000

/**
 * 调用 Rerank API 对文档进行精排
 * @param query 查询文本
 * @param documents 待排序文档列表
 * @param topN 返回前 N 条
 * @param model 可选模型名称，不传则使用配置中的默认模型
 * @returns 精排结果列表（含原始索引和相关性分数）
 */
export async function rerankService(
    query: string,
    documents: string[],
    topN: number,
    model?: string,
): Promise<RerankApiResult[]> {
    const config = await getRerankConfigWithFallbackService()
    const url = `${config.baseUrl}/v1/rerank`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), RERANK_TIMEOUT_MS)

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: model || config.model,
                query,
                documents,
                top_n: topN,
            }),
            signal: controller.signal,
        })

        if (!response.ok) {
            throw new Error(`Rerank API 错误: ${response.status} ${response.statusText}`)
        }

        const data = await response.json()
        return data.results as RerankApiResult[]
    } finally {
        clearTimeout(timeout)
    }
}

/**
 * 对检索结果进行 Rerank 精排 + 阈值过滤
 *
 * API 失败时降级返回原始结果前 k 条
 *
 * @param query 查询文本
 * @param results 原始检索结果列表
 * @param k 期望返回条数
 * @param type 检索类型（法律/材料），用于确定阈值
 * @returns 精排并过滤后的结果列表
 */
export async function rerankAndFilterService(
    query: string,
    results: SearchResultItem[],
    k: number,
    type: 'law' | 'case_material',
): Promise<SearchResultItem[]> {
    if (results.length === 0) return []

    const candidateResults = results.slice(0, MAX_RERANK_DOCS)
    const documents = candidateResults.map(r => r.content)

    // 阈值：法律 0.3，材料 0.2，从环境变量读取
    const threshold =
        type === 'law'
            ? parseFloat(process.env.NUXT_LAW_RERANK_THRESHOLD || '0.3')
            : parseFloat(process.env.NUXT_MATERIAL_RERANK_THRESHOLD || '0.2')

    try {
        const rerankResults = await rerankService(query, documents, k)

        return rerankResults
            .filter(r => r.relevance_score >= threshold)
            .map(r => ({
                ...candidateResults[r.index],
                score: r.relevance_score,
            }))
    } catch (error) {
        logger.warn('Rerank API 调用失败，降级返回原始结果:', error)
        return candidateResults.slice(0, k)
    }
}
