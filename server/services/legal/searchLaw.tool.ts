/**
 * 法律条文搜索工具
 *
 * 支持两种搜索模式：
 * 1. 向量搜索：传入 query 参数进行语义搜索
 * 2. SQL 查询：不传入 query 参数，通过元数据筛选
 *
 * 所有日期过滤都使用东八区时区（Asia/Shanghai）处理
 */

import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import type { LawSearchParams, LawSearchResultItem, LawSearchResult, LawEmbeddingMetadata } from '#shared/types/legal'
import { getPool } from './vectorStore.service'
import { retrievalRouterService } from '../retrieval/retrievalRouter.service'
import type { DateFilter, SearchResultItem } from '../retrieval/types'
import { isLawEffective, applyDateFilter } from '../retrieval/postFilter.service'

dayjs.extend(utc)
dayjs.extend(timezone)

const CHINA_TIMEZONE = 'Asia/Shanghai'

/** 搜索参数 */
interface SearchLawParams {
    k?: number
    query?: string
    legalId?: string
    legalName?: string
    legalType?: string
    articleType?: string
    page?: number
    isEffective?: boolean
    invalidDateFilter?: DateFilter
    publishDateFilter?: DateFilter
    effectiveDateFilter?: DateFilter
}

/**
 * 构建 SQL 日期过滤条件
 * @param field 字段名
 * @param dateFilter 日期过滤条件
 * @param params 参数数组
 * @returns SQL 条件字符串
 */
function buildSQLDateFilter(
    field: string,
    dateFilter: DateFilter | undefined,
    params: unknown[]
): string {
    if (!dateFilter) return ''

    const { date, operator } = dateFilter

    // 验证日期格式
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/
    if (!dateRegex.test(date)) {
        throw new Error(`无效的日期格式: ${date}，请使用 YYYY-MM-DD 格式`)
    }

    // 验证操作符
    const validOperators = ['>', '<', '=', '>=', '<=']
    if (!validOperators.includes(operator)) {
        throw new Error(`无效的操作符: ${operator}，请使用 > < = >= <=`)
    }

    // 使用东八区时区处理日期
    const chinaDate = dayjs.tz(date, CHINA_TIMEZONE)
    const formattedDate = chinaDate.format('YYYY-MM-DD')

    params.push(formattedDate)
    return ` AND NULLIF(metadata->>'${field}', '')::date ${operator} $${params.length}::date`
}

/**
 * 搜索法律条文
 * @param params 搜索参数
 * @returns 搜索结果
 */
export async function searchLaw(params: SearchLawParams): Promise<SearchResultItem[]> {
    logger.info('法律搜索参数:', params)

    // 如果有 query 参数，走统一检索路由器
    if (params.query) {
        const results = await retrievalRouterService({
            query: params.query,
            type: 'law',
            k: params.k || 5,
            metadataFilter: {
                ...(params.legalId && { legal_id: params.legalId }),
                ...(params.legalName && { legal_name: params.legalName }),
                ...(params.legalType && { legal_type: params.legalType }),
                ...(params.articleType && { article_type: params.articleType }),
            },
            postFilters: {
                isEffective: params.isEffective,
                invalidDateFilter: params.invalidDateFilter,
                publishDateFilter: params.publishDateFilter,
                effectiveDateFilter: params.effectiveDateFilter,
            },
        })

        // 映射回 SearchResultItem[]（兼容下游）
        return results.map(r => ({
            score: r.score,
            content: r.content,
            metadata: r.metadata,
        }))
    } else {
        // 如果没有 query 参数，使用 SQL 查询
        const pool = getPool()

        let sqlQuery = `
            SELECT text, metadata 
            FROM law_embeddings 
            WHERE 1=1
        `
        const queryParams: unknown[] = []

        // 添加过滤条件（使用 snake_case 字段名）
        if (params.legalId) {
            queryParams.push(params.legalId)
            sqlQuery += ` AND metadata->>'legal_id' = $${queryParams.length}`
        }

        if (params.legalName) {
            queryParams.push(params.legalName)
            sqlQuery += ` AND metadata->>'legal_name' = $${queryParams.length}`
        }

        if (params.legalType) {
            queryParams.push(params.legalType)
            sqlQuery += ` AND metadata->>'legal_type' = $${queryParams.length}`
        }

        if (params.articleType) {
            queryParams.push(params.articleType)
            sqlQuery += ` AND metadata->>'article_type' = $${queryParams.length}`
        }

        // 添加日期过滤条件（使用 snake_case 字段名）
        sqlQuery += buildSQLDateFilter('invalid_date', params.invalidDateFilter, queryParams)
        sqlQuery += buildSQLDateFilter('publish_date', params.publishDateFilter, queryParams)
        sqlQuery += buildSQLDateFilter('effective_date', params.effectiveDateFilter, queryParams)

        // 处理分页参数
        const pageSize = params.k || 5
        const page = params.page || 1
        const offset = (page - 1) * pageSize

        queryParams.push(pageSize)
        sqlQuery += ` ORDER BY id LIMIT $${queryParams.length}`

        if (page > 1) {
            queryParams.push(offset)
            sqlQuery += ` OFFSET $${queryParams.length}`
        }

        const result = await pool.query(sqlQuery, queryParams)

        let results: SearchResultItem[] = result.rows.map((row: { text: string; metadata: Record<string, unknown> }) => ({
            score: 1,
            content: row.text,
            metadata: row.metadata,
        }))

        // 应用是否有效过滤
        if (params.isEffective !== undefined) {
            results = results.filter(item => {
                const isEffective = isLawEffective(
                    item.metadata.effective_date as string | null,
                    item.metadata.invalid_date as string | null
                )
                return isEffective === params.isEffective
            })
        }

        return results
    }
}


/**
 * 法律搜索工具（用于 LangChain/LangGraph）
 */
export const searchLawTool = tool(
    async (input: SearchLawParams): Promise<string> => {
        const results = await searchLaw({
            k: input.k || 5,
            query: input.query,
            legalId: input.legalId,
            legalName: input.legalName,
            legalType: input.legalType,
            articleType: input.articleType,
            page: input.page,
            isEffective: input.isEffective,
            invalidDateFilter: input.invalidDateFilter,
            publishDateFilter: input.publishDateFilter,
            effectiveDateFilter: input.effectiveDateFilter,
        })

        // 格式化返回结果（使用 snake_case 字段名）
        const formattedResults = results.map(item => ({
            score: item.score,
            content: item.content,
            metadata: {
                legal_name: item.metadata.legal_name,
                document_number: item.metadata.document_number,
                chapter_hierarchy: item.metadata.chapter_hierarchy,
                publish_date: item.metadata.publish_date,
                effective_date: item.metadata.effective_date,
                invalid_date: item.metadata.invalid_date,
            },
        }))

        return JSON.stringify(formattedResults)
    },
    {
        name: 'searchLawTool',
        description: '搜索法律条文内容的专业工具。用于查找相关的法律、法规、司法解释等法律条文内容。支持两种搜索方式：1) 传入 query 参数进行语义搜索；2) 不传入 query 参数直接通过 metadata 筛选获取所有符合条件的法律条文，此模式支持分页查询。',
        schema: z.object({
            k: z.number().optional().describe('返回结果数量，默认为 5。在分页模式下作为每页大小'),
            query: z.string().optional().describe('按语义搜索法律条文内容的关键词，可选参数。如果不传入此参数，将直接通过 metadata 筛选'),
            legalId: z.string().optional().describe('法律 ID，可选参数。用于筛选特定法律的所有条文'),
            legalName: z.string().optional().describe('法律名称，可选参数。用于筛选特定法律的所有条文'),
            legalType: z.enum(['law', 'regulation', 'judicial_interp', 'guideline']).optional().describe('法律类型，可选参数'),
            articleType: z.enum(['notice', 'header', 'footer', 'annex', 'l1', 'l2', 'l3', 'l4', 'l5']).optional().describe('条文类型，可选参数'),
            page: z.number().optional().describe('分页页码，从 1 开始。仅在不使用 query 参数的 SQL 查询模式下生效'),
            isEffective: z.boolean().optional().describe('是否有效，可选参数。true 表示只返回有效条文，false 表示只返回无效条文'),
            invalidDateFilter: z.object({
                date: z.string().describe('失效日期，格式：YYYY-MM-DD'),
                operator: z.enum(['>', '<', '=', '>=', '<=']).describe('日期比较操作符'),
            }).optional().describe('按失效日期过滤，可选参数'),
            publishDateFilter: z.object({
                date: z.string().describe('发布日期，格式：YYYY-MM-DD'),
                operator: z.enum(['>', '<', '=', '>=', '<=']).describe('日期比较操作符'),
            }).optional().describe('按发布日期过滤，可选参数'),
            effectiveDateFilter: z.object({
                date: z.string().describe('生效日期，格式：YYYY-MM-DD'),
                operator: z.enum(['>', '<', '=', '>=', '<=']).describe('日期比较操作符'),
            }).optional().describe('按生效日期过滤，可选参数'),
        }),
    }
)

/**
 * 搜索法律条文（服务层接口）
 * @param params 搜索参数
 * @returns 搜索结果
 */
export async function searchLawService(params: LawSearchParams): Promise<LawSearchResult> {
    const results = await searchLaw({
        k: params.limit || 10,
        query: params.query,
        legalType: params.legalType,
        isEffective: params.validOnly,
        effectiveDateFilter: params.effectiveDateFrom ? {
            date: params.effectiveDateFrom,
            operator: '>=',
        } : undefined,
    })

    // 映射返回结果（从 snake_case 字段读取）
    const items: LawSearchResultItem[] = results.map(item => ({
        articles_id: item.metadata.articles_id as string,
        legal_id: item.metadata.legal_id as string,
        legal_name: item.metadata.legal_name as string,
        content: item.content,
        chapter_hierarchy: Array.isArray(item.metadata.chapter_hierarchy)
            ? (item.metadata.chapter_hierarchy as string[])
            : [],
        score: item.score,
        metadata: item.metadata as unknown as LawEmbeddingMetadata,
    }))

    return {
        items,
        total: items.length,
        mode: params.query ? 'vector' : 'sql',
    }
}
