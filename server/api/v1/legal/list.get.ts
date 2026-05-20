/**
 * 法律法规列表 API
 * GET /api/v1/legal/list
 *
 * 支持关键词搜索、多维度筛选、分页功能
 */

import { z } from 'zod'
import dayjs from 'dayjs'
import type { LegalListResponse } from '#shared/types/legal-search'
import { VALIDITY_STATUS_FILTERS } from '#shared/types/legal-search'
import { LegalType } from '#shared/types/legal'
import { recordSearchService } from '~~/server/services/legal/trending.service'

// 请求参数验证
const querySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    keyword: z.string().optional(),
    type: z.nativeEnum(LegalType).optional(),
    issuingAuthority: z.string().optional(), // 单个发文机关
    validityStatus: z.enum(VALIDITY_STATUS_FILTERS).optional().default('all'),
    publishDateFrom: z.string().optional(),
    publishDateTo: z.string().optional(),
    sortBy: z.enum(['publishDate', 'effectiveDate', 'name', 'createdAt']).default('publishDate'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
})

export default defineEventHandler(async (event) => {
    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    try {
        // 解析查询参数
        const query = getQuery(event)
        const result = querySchema.safeParse(query)

        if (!result.success) {
            return resError(event, 400, result.error.issues[0]!!.message)
        }

        const {
            page,
            pageSize,
            keyword,
            type,
            issuingAuthority,
            validityStatus,
            publishDateFrom,
            publishDateTo,
            sortBy,
            sortOrder,
        } = result.data

        // 获取当前日期（用于判断有效性）
        const today = dayjs().format('YYYY-MM-DD')

        // 构建查询条件
        const where: any = {
            deletedAt: null,
        }

        // 关键词搜索（名称或文号）
        if (keyword) {
            where.OR = [
                { name: { contains: keyword, mode: 'insensitive' } },
                { documentNumber: { contains: keyword, mode: 'insensitive' } },
            ]
        }

        // 法律类型筛选
        if (type) {
            where.type = type
        }

        // 发文机关筛选（单选，发文机关字段需包含选中的机关）
        if (issuingAuthority) {
            where.issuingAuthority = { contains: issuingAuthority, mode: 'insensitive' }
        }

        // 发布日期范围筛选
        if (publishDateFrom || publishDateTo) {
            where.publishDate = {}
            if (publishDateFrom) {
                where.publishDate.gte = new Date(publishDateFrom)
            }
            if (publishDateTo) {
                where.publishDate.lte = new Date(publishDateTo)
            }
        }

        // 生效状态筛选
        if (validityStatus === 'valid') {
            // 现行有效：已生效且未失效
            where.AND = where.AND || []
            where.AND.push(
                {
                    OR: [
                        { effectiveDate: null },
                        { effectiveDate: { lte: new Date(today) } },
                    ],
                },
                {
                    OR: [
                        { invalidDate: null },
                        { invalidDate: { gt: new Date(today) } },
                    ],
                },
            )
        } else if (validityStatus === 'pending') {
            // 尚未生效：生效日期在未来
            where.effectiveDate = {
                not: null,
                gt: new Date(today),
            }
        } else if (validityStatus === 'invalid') {
            // 已失效：失效日期已过
            where.invalidDate = {
                not: null,
                lte: new Date(today),
            }
        }

        // 构建排序条件
        const orderBy: any = {}
        orderBy[sortBy] = sortOrder

        // 查询总数
        const total = await prisma.legalMain.count({ where })

        // 查询列表
        const items = await prisma.legalMain.findMany({
            where,
            select: {
                id: true,
                name: true,
                code: true,
                type: true,
                category: true,
                issuingAuthority: true,
                documentNumber: true,
                publishDate: true,
                effectiveDate: true,
                invalidDate: true,
                lastEditedAt: true,
                lastEmbeddingAt: true,
                createdAt: true,
            },
            orderBy,
            skip: (page - 1) * pageSize,
            take: pageSize,
        })

        // 格式化响应
        const response: LegalListResponse = {
            items: items.map(item => ({
                ...item,
                type: item.type as LegalType,
                publishDate: item.publishDate ? dayjs(item.publishDate).format('YYYY-MM-DD') : null,
                effectiveDate: item.effectiveDate ? dayjs(item.effectiveDate).format('YYYY-MM-DD') : null,
                invalidDate: item.invalidDate ? dayjs(item.invalidDate).format('YYYY-MM-DD') : null,
                lastEditedAt: item.lastEditedAt ? item.lastEditedAt.toISOString() : null,
                lastEmbeddingAt: item.lastEmbeddingAt ? item.lastEmbeddingAt.toISOString() : null,
                createdAt: item.createdAt ? item.createdAt.toISOString() : null,
            })),
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize),
        }

        if (keyword && keyword.trim()) {
            await recordSearchService({
                scope: 'legal',
                rawKeyword: keyword,
                userId: user.id,
                resultCount: total,
                resultIds: { ids: items.slice(0, 20).map(i => i.id) },
            })
        }

        return resSuccess(event, '获取列表成功', response)
    } catch (error) {
        logger.error('获取法律法规列表失败:', error)
        return resError(event, 500, '获取列表失败')
    }
})
