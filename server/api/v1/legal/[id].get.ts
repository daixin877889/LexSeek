/**
 * 法律法规详情 API
 * GET /api/v1/legal/:id
 *
 * 返回法律法规详情及其条文列表
 */

import { z } from 'zod'
import dayjs from 'dayjs'
import type { LegalDetailResponse } from '#shared/types/legal-search'
import type { LegalArticleInfo } from '#shared/types/legal'
import { LegalType, ArticleType } from '#shared/types/legal'

// 路由参数验证
const paramsSchema = z.object({
    id: z.string().uuid('无效的法律 ID'),
})

export default defineEventHandler(async (event) => {
    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    try {
        // 获取路由参数
        const id = getRouterParam(event, 'id')
        const result = paramsSchema.safeParse({ id })

        if (!result.success) {
            return resError(event, 400, result.error.issues[0]!!.message)
        }

        // 查询法律法规详情
        const legal = await prisma.legalMain.findUnique({
            where: {
                id: result.data.id,
                deletedAt: null,
            },
            select: {
                id: true,
                name: true,
                code: true,
                type: true,
                category: true,
                content: true,
                issuingAuthority: true,
                documentNumber: true,
                publishDate: true,
                effectiveDate: true,
                invalidDate: true,
            },
        })

        if (!legal) {
            return resError(event, 404, '法律法规不存在')
        }

        // 查询条文列表（按 order 升序排列）
        const articles = await prisma.legalArticles.findMany({
            where: {
                legalId: result.data.id,
                deletedAt: null,
            },
            select: {
                id: true,
                legalId: true,
                type: true,
                l1: true,
                l1I: true,
                l2: true,
                l2I: true,
                l3: true,
                l3I: true,
                l4: true,
                l4I: true,
                l5: true,
                l5I: true,
                order: true,
                content: true,
                publishDate: true,
                effectiveDate: true,
                invalidDate: true,
                lastEditedAt: true,
                lastEmbeddingAt: true,
                createdAt: true,
            },
            orderBy: {
                order: 'asc',
            },
        })

        // 格式化响应
        const response: LegalDetailResponse = {
            id: legal.id,
            name: legal.name,
            code: legal.code,
            type: legal.type as LegalType,
            category: legal.category,
            content: legal.content,
            issuingAuthority: legal.issuingAuthority,
            documentNumber: legal.documentNumber,
            publishDate: legal.publishDate ? dayjs(legal.publishDate).format('YYYY-MM-DD') : null,
            effectiveDate: legal.effectiveDate ? dayjs(legal.effectiveDate).format('YYYY-MM-DD') : null,
            invalidDate: legal.invalidDate ? dayjs(legal.invalidDate).format('YYYY-MM-DD') : null,
            articles: articles.map(article => ({
                id: article.id,
                legalId: article.legalId,
                type: article.type as ArticleType,
                l1: article.l1,
                l1I: article.l1I,
                l2: article.l2,
                l2I: article.l2I,
                l3: article.l3,
                l3I: article.l3I,
                l4: article.l4,
                l4I: article.l4I,
                l5: article.l5,
                l5I: article.l5I,
                order: article.order,
                content: article.content,
                publishDate: article.publishDate ? dayjs(article.publishDate).format('YYYY-MM-DD') : null,
                effectiveDate: article.effectiveDate ? dayjs(article.effectiveDate).format('YYYY-MM-DD') : null,
                invalidDate: article.invalidDate ? dayjs(article.invalidDate).format('YYYY-MM-DD') : null,
                lastEditedAt: article.lastEditedAt ? article.lastEditedAt.toISOString() : null,
                lastEmbeddingAt: article.lastEmbeddingAt ? article.lastEmbeddingAt.toISOString() : null,
                createdAt: article.createdAt ? article.createdAt.toISOString() : null,
            })) as LegalArticleInfo[],
        }

        return resSuccess(event, '获取详情成功', response)
    } catch (error) {
        logger.error('获取法律法规详情失败:', error)
        return resError(event, 500, '获取详情失败')
    }
})
