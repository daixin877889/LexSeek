/**
 * 法律法规服务层
 *
 * 提供法律法规的业务逻辑处理，包括：
 * - 获取列表（分页、筛选、排序）
 * - 获取详情
 * - 创建
 * - 更新（含 lastEditedAt 更新）
 * - 删除（软删除）
 * - 失效状态同步
 */

import type {
    LegalMainInfo,
    LegalMainListItem,
    LegalMainListQuery,
    CreateLegalMainRequest,
    UpdateLegalMainRequest,
    PaginatedResponse,
    LegalType,
} from '#shared/types/legal'
import dayjs from 'dayjs'
import {
    createLegalMainDao,
    findLegalMainByIdDao,
    findLegalMainByCodeDao,
    findLegalMainListDao,
    updateLegalMainDao,
    deleteLegalMainDao,
} from './legalMain.dao'
import {
    updateLegalArticlesInvalidDateDao,
    deleteLegalArticlesByLegalIdDao,
} from './legalArticles.dao'
import { updateEmbeddingsValidStatus } from './lawEmbedding.service'

/**
 * 格式化日期为字符串
 * @param date 日期对象
 * @returns 格式化后的字符串或 null
 */
function formatDate(date: Date | null | undefined): string | null {
    if (!date) return null
    return dayjs(date).format('YYYY-MM-DD')
}

/**
 * 格式化日期时间为字符串
 * @param date 日期对象
 * @returns 格式化后的字符串或 null
 */
function formatDateTime(date: Date | null | undefined): string | null {
    if (!date) return null
    return dayjs(date).format('YYYY-MM-DD HH:mm:ss')
}

/**
 * 获取法律法规列表
 * @param query 查询参数
 * @returns 分页响应
 */
export async function getLegalMainListService(
    query: LegalMainListQuery & { status?: 'valid' | 'invalid' | 'pending' }
): Promise<PaginatedResponse<LegalMainListItem>> {
    const { page = 1, pageSize = 10 } = query

    const { list, total } = await findLegalMainListDao({
        page,
        pageSize,
        keyword: query.keyword,
        type: query.type,
        issuingAuthority: query.issuingAuthority,
        status: query.status,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
    })

    const items: LegalMainListItem[] = list.map(item => ({
        id: item.id,
        name: item.name,
        code: item.code,
        type: item.type as LegalType,
        category: item.category,
        issuingAuthority: item.issuingAuthority,
        documentNumber: item.documentNumber,
        publishDate: formatDate(item.publishDate),
        effectiveDate: formatDate(item.effectiveDate),
        invalidDate: formatDate(item.invalidDate),
        lastEditedAt: formatDateTime(item.lastEditedAt),
        lastEmbeddingAt: formatDateTime(item.lastEmbeddingAt),
        createdAt: formatDateTime(item.createdAt),
    }))

    return {
        items,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
    }
}

/**
 * 获取法律法规详情
 * @param id 法律法规 ID
 * @returns 法律法规详情或 null
 */
export async function getLegalMainDetailService(
    id: string
): Promise<LegalMainInfo | null> {
    const legal = await findLegalMainByIdDao(id)
    if (!legal) return null

    return {
        id: legal.id,
        name: legal.name,
        code: legal.code,
        type: legal.type as LegalType,
        category: legal.category,
        content: legal.content,
        issuingAuthority: legal.issuingAuthority,
        documentNumber: legal.documentNumber,
        publishDate: formatDate(legal.publishDate),
        effectiveDate: formatDate(legal.effectiveDate),
        invalidDate: formatDate(legal.invalidDate),
        lastEditedAt: formatDateTime(legal.lastEditedAt),
        lastEmbeddingAt: formatDateTime(legal.lastEmbeddingAt),
        createdAt: formatDateTime(legal.createdAt),
        updatedAt: formatDateTime(legal.updatedAt),
    }
}

/**
 * 创建法律法规
 * @param data 创建数据
 * @returns 创建的法律法规
 */
export async function createLegalMainService(
    data: CreateLegalMainRequest
): Promise<LegalMainInfo> {
    // 检查代码是否已存在
    const existing = await findLegalMainByCodeDao(data.code)
    if (existing) {
        throw new Error(`法律代码 ${data.code} 已存在`)
    }

    const legal = await createLegalMainDao({
        name: data.name,
        code: data.code,
        type: data.type,
        category: data.category,
        content: data.content,
        issuingAuthority: data.issuingAuthority,
        documentNumber: data.documentNumber,
        publishDate: data.publishDate ? new Date(data.publishDate) : null,
        effectiveDate: data.effectiveDate ? new Date(data.effectiveDate) : null,
        invalidDate: data.invalidDate ? new Date(data.invalidDate) : null,
    })

    return {
        id: legal.id,
        name: legal.name,
        code: legal.code,
        type: legal.type as LegalType,
        category: legal.category,
        content: legal.content,
        issuingAuthority: legal.issuingAuthority,
        documentNumber: legal.documentNumber,
        publishDate: formatDate(legal.publishDate),
        effectiveDate: formatDate(legal.effectiveDate),
        invalidDate: formatDate(legal.invalidDate),
        lastEditedAt: formatDateTime(legal.lastEditedAt),
        lastEmbeddingAt: formatDateTime(legal.lastEmbeddingAt),
        createdAt: formatDateTime(legal.createdAt),
        updatedAt: formatDateTime(legal.updatedAt),
    }
}

/**
 * 更新法律法规
 * @param id 法律法规 ID
 * @param data 更新数据
 * @returns 更新后的法律法规
 */
export async function updateLegalMainService(
    id: string,
    data: UpdateLegalMainRequest
): Promise<LegalMainInfo> {
    // 检查是否存在
    const existing = await findLegalMainByIdDao(id)
    if (!existing) {
        throw new Error(`法律法规 ${id} 不存在`)
    }

    // 如果更新代码，检查是否与其他记录冲突
    if (data.code && data.code !== existing.code) {
        const codeExists = await findLegalMainByCodeDao(data.code)
        if (codeExists) {
            throw new Error(`法律代码 ${data.code} 已存在`)
        }
    }

    // 检查失效日期是否变更
    const oldInvalidDate = existing.invalidDate
    const newInvalidDate = data.invalidDate !== undefined
        ? (data.invalidDate ? new Date(data.invalidDate) : null)
        : existing.invalidDate

    const legal = await updateLegalMainDao(id, {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.code !== undefined && { code: data.code }),
        ...(data.type !== undefined && { type: data.type }),
        ...(data.category !== undefined && { category: data.category }),
        ...(data.content !== undefined && { content: data.content }),
        ...(data.issuingAuthority !== undefined && { issuingAuthority: data.issuingAuthority }),
        ...(data.documentNumber !== undefined && { documentNumber: data.documentNumber }),
        ...(data.publishDate !== undefined && {
            publishDate: data.publishDate ? new Date(data.publishDate) : null,
        }),
        ...(data.effectiveDate !== undefined && {
            effectiveDate: data.effectiveDate ? new Date(data.effectiveDate) : null,
        }),
        ...(data.invalidDate !== undefined && {
            invalidDate: data.invalidDate ? new Date(data.invalidDate) : null,
        }),
    })

    // 如果失效日期变更，同步更新条文和嵌入
    const invalidDateChanged = (
        (oldInvalidDate === null && newInvalidDate !== null) ||
        (oldInvalidDate !== null && newInvalidDate === null) ||
        (oldInvalidDate !== null && newInvalidDate !== null &&
            oldInvalidDate.getTime() !== newInvalidDate.getTime())
    )

    if (invalidDateChanged) {
        await syncInvalidStatusService(id, newInvalidDate)
    }

    return {
        id: legal.id,
        name: legal.name,
        code: legal.code,
        type: legal.type as LegalType,
        category: legal.category,
        content: legal.content,
        issuingAuthority: legal.issuingAuthority,
        documentNumber: legal.documentNumber,
        publishDate: formatDate(legal.publishDate),
        effectiveDate: formatDate(legal.effectiveDate),
        invalidDate: formatDate(legal.invalidDate),
        lastEditedAt: formatDateTime(legal.lastEditedAt),
        lastEmbeddingAt: formatDateTime(legal.lastEmbeddingAt),
        createdAt: formatDateTime(legal.createdAt),
        updatedAt: formatDateTime(legal.updatedAt),
    }
}

/**
 * 删除法律法规（软删除）
 * @param id 法律法规 ID
 */
export async function deleteLegalMainService(id: string): Promise<void> {
    // 检查是否存在
    const existing = await findLegalMainByIdDao(id)
    if (!existing) {
        throw new Error(`法律法规 ${id} 不存在`)
    }

    // 软删除法律法规
    await deleteLegalMainDao(id)

    // 软删除关联的条文
    await deleteLegalArticlesByLegalIdDao(id)

    logger.info(`已删除法律法规: ${existing.name} (${id})`)
}

/**
 * 同步失效状态到条文和嵌入
 * @param legalId 法律 ID
 * @param invalidDate 失效日期
 */
export async function syncInvalidStatusService(
    legalId: string,
    invalidDate: Date | null
): Promise<void> {
    // 更新所有条文的失效日期
    const count = await updateLegalArticlesInvalidDateDao(legalId, invalidDate)
    logger.info(`已更新 ${count} 个条文的失效日期`)

    // 更新嵌入元数据中的有效状态
    await updateEmbeddingsValidStatus(legalId, invalidDate)
}

/**
 * 检查法律代码是否存在
 * @param code 法律代码
 * @param excludeId 排除的 ID（用于更新时检查）
 * @returns 是否存在
 */
export async function checkLegalCodeExistsService(
    code: string,
    excludeId?: string
): Promise<boolean> {
    const existing = await findLegalMainByCodeDao(code)
    if (!existing) return false
    if (excludeId && existing.id === excludeId) return false
    return true
}

/**
 * 获取法律法规统计信息
 * @param legalId 法律法规 ID
 * @returns 统计信息或 null
 */
export async function getLegalStatisticsService(
    legalId: string
): Promise<import('#shared/types/legal').LegalStatistics | null> {
    // 检查法律法规是否存在
    const legal = await findLegalMainByIdDao(legalId)
    if (!legal) return null

    // 获取条文总数和向量化统计
    const [totalResult, typeDistribution] = await Promise.all([
        // 条文总数
        prisma.legalArticles.count({
            where: {
                legalId,
                deletedAt: null,
            },
        }),
        // 各类型条文数量分布
        prisma.legalArticles.groupBy({
            by: ['type'],
            where: {
                legalId,
                deletedAt: null,
            },
            _count: {
                id: true,
            },
        }),
    ])

    // 通过原生 SQL 查询已向量化条文数（metadata 中的 legalId 字段）
    const embeddedCountResult = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(DISTINCT metadata->>'articleId') as count
        FROM law_embeddings
        WHERE metadata->>'legalId' = ${legalId}
    `
    const embeddedResult = Number(embeddedCountResult[0]?.count || 0)

    // 构建类型分布对象
    const articlesByType = {
        l1: 0,
        l2: 0,
        l3: 0,
        l4: 0,
        l5: 0,
        notice: 0,
        header: 0,
        footer: 0,
        annex: 0,
    }

    // 填充类型分布数据
    for (const item of typeDistribution) {
        const type = item.type as keyof typeof articlesByType
        if (type in articlesByType) {
            articlesByType[type] = item._count.id
        }
    }

    return {
        totalArticles: totalResult,
        embeddedArticles: embeddedResult,
        notEmbeddedArticles: totalResult - embeddedResult,
        articlesByType,
        lastEditedAt: formatDateTime(legal.lastEditedAt),
        lastEmbeddingAt: formatDateTime(legal.lastEmbeddingAt),
    }
}
