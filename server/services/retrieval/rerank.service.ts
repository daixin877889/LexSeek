/**
 * Rerank 精排服务
 *
 * 通用 Rerank API 客户端，支持阈值过滤和降级处理。
 *
 * 兼容标准 Rerank 协议（Cohere / Jina / SiliconFlow / 阿里云兼容端点等）
 * 以及阿里云 DashScope 原生格式（嵌套 input/parameters）。
 *
 * 管理员在后台配置模型时，baseUrl 应填写完整的 API 端点 URL，例如：
 * - 阿里云 qwen3-rerank:  https://dashscope.aliyuncs.com/compatible-api/v1/reranks
 * - 阿里云 gte-rerank-v2: https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank
 * - Cohere:               https://api.cohere.com/v2/rerank
 * - Jina:                 https://api.jina.ai/v1/rerank
 * - SiliconFlow:          https://api.siliconflow.cn/v1/rerank
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

/** DashScope 原生 API 路径特征（用于自动检测请求格式） */
const DASHSCOPE_NATIVE_PATTERN = '/api/v1/services/'

/**
 * 判断是否使用 DashScope 原生嵌套格式
 *
 * DashScope 原生 API 的 URL 包含 /api/v1/services/，
 * 需要嵌套的 input/parameters 请求体和 output.results 响应。
 * 其他所有供应商（含阿里云兼容端点）使用标准扁平格式。
 */
function isDashScopeNativeApi(url: string): boolean {
    return url.includes(DASHSCOPE_NATIVE_PATTERN)
}

/**
 * 调用 Rerank API 对文档进行精排
 *
 * baseUrl 即完整 API 端点，代码不拼接路径。
 *
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
    const modelName = model || config.model
    const url = config.baseUrl
    const isNative = isDashScopeNativeApi(url)

    // DashScope 原生格式：嵌套 input/parameters；标准格式：扁平
    const body = isNative
        ? { model: modelName, input: { query, documents }, parameters: { top_n: topN } }
        : { model: modelName, query, documents, top_n: topN }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), RERANK_TIMEOUT_MS)

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        })

        if (!response.ok) {
            throw new Error(`Rerank API 错误: ${response.status} ${response.statusText}`)
        }

        const data = await response.json()

        // 兼容两种响应格式：标准 data.results 或 DashScope data.output.results
        const results: RerankApiResult[] = data.results ?? data.output?.results
        if (!results) {
            throw new Error('Rerank API 响应格式异常：缺少 results 字段')
        }

        return results
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
