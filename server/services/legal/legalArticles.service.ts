/**
 * 法律条文服务层
 *
 * 提供法律条文的业务逻辑处理，包括：
 * - 获取列表（按 legalId）
 * - 获取详情
 * - 创建（含触发嵌入）
 * - 更新（含触发重新嵌入）
 * - 删除（含删除嵌入）
 */

import type {
    LegalArticleInfo,
    LegalArticleListItem,
    LegalArticleListQuery,
    CreateLegalArticleRequest,
    UpdateLegalArticleRequest,
    PaginatedResponse,
    ArticleType,
} from '#shared/types/legal'
import dayjs from 'dayjs'
import {
    createLegalArticleDao,
    findLegalArticleByIdDao,
    findLegalArticleWithLegalByIdDao,
    findLegalArticlesListDao,
    updateLegalArticleDao,
    deleteLegalArticleDao,
} from './legalArticles.dao'
import { findLegalMainByIdDao } from './legalMain.dao'
import {
    embedSingleArticle,
    deleteEmbeddingsByArticleId,
    buildHierarchyPath,
} from './lawEmbedding.service'

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
 * 获取法律条文列表
 * @param query 查询参数
 * @returns 分页响应
 */
export async function getLegalArticlesListService(
    query: LegalArticleListQuery
): Promise<PaginatedResponse<LegalArticleListItem>> {
    const { legalId, page = 1, pageSize = 100, type, keyword, l1, l2, l3, l4, l5 } = query

    // 检查法律是否存在
    const legal = await findLegalMainByIdDao(legalId)
    if (!legal) {
        throw new Error(`法律 ${legalId} 不存在`)
    }

    const { list, total } = await findLegalArticlesListDao({
        legalId,
        page,
        pageSize,
        type,
        keyword,
        l1,
        l2,
        l3,
        l4,
        l5,
    })

    const items: LegalArticleListItem[] = list.map(item => ({
        id: item.id,
        legalId: item.legalId,
        type: item.type as ArticleType,
        l1: item.l1,
        l1I: item.l1I,
        l2: item.l2,
        l2I: item.l2I,
        l3: item.l3,
        l3I: item.l3I,
        l4: item.l4,
        l4I: item.l4I,
        l5: item.l5,
        l5I: item.l5I,
        order: item.order,
        content: item.content,
        publishDate: formatDate(item.publishDate),
        effectiveDate: formatDate(item.effectiveDate),
        invalidDate: formatDate(item.invalidDate),
        lastEditedAt: formatDateTime(item.lastEditedAt),
        lastEmbeddingAt: formatDateTime(item.lastEmbeddingAt),
        createdAt: formatDateTime(item.createdAt),
        hierarchyPath: buildHierarchyPath(item),
        isEmbedded: item.lastEmbeddingAt !== null,
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
 * 获取法律条文详情
 * @param id 条文 ID
 * @returns 条文详情或 null
 */
export async function getLegalArticleDetailService(
    id: string
): Promise<LegalArticleInfo | null> {
    const article = await findLegalArticleByIdDao(id)
    if (!article) return null

    return {
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
        publishDate: formatDate(article.publishDate),
        effectiveDate: formatDate(article.effectiveDate),
        invalidDate: formatDate(article.invalidDate),
        lastEditedAt: formatDateTime(article.lastEditedAt),
        lastEmbeddingAt: formatDateTime(article.lastEmbeddingAt),
        createdAt: formatDateTime(article.createdAt),
    }
}

/**
 * 创建法律条文
 * @param data 创建数据
 * @param triggerEmbedding 是否触发嵌入（默认 true）
 * @returns 创建的条文
 */
export async function createLegalArticleService(
    data: CreateLegalArticleRequest,
    triggerEmbedding: boolean = true
): Promise<LegalArticleInfo> {
    // 检查法律是否存在
    const legal = await findLegalMainByIdDao(data.legalId)
    if (!legal) {
        throw new Error(`法律 ${data.legalId} 不存在`)
    }

    const article = await createLegalArticleDao({
        legalMain: { connect: { id: data.legalId } },
        type: data.type,
        l1: data.l1,
        l1I: data.l1I,
        l2: data.l2,
        l2I: data.l2I,
        l3: data.l3,
        l3I: data.l3I,
        l4: data.l4,
        l4I: data.l4I,
        l5: data.l5,
        l5I: data.l5I,
        order: data.order,
        content: data.content,
        publishDate: data.publishDate ? new Date(data.publishDate) : null,
        effectiveDate: data.effectiveDate ? new Date(data.effectiveDate) : null,
        invalidDate: data.invalidDate ? new Date(data.invalidDate) : legal.invalidDate,
    })

    // 触发嵌入
    if (triggerEmbedding && article.content) {
        try {
            await embedSingleArticle(article.id)
        } catch (error) {
            logger.error(`条文 ${article.id} 嵌入失败:`, error)
            // 嵌入失败不影响创建结果
        }
    }

    return {
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
        publishDate: formatDate(article.publishDate),
        effectiveDate: formatDate(article.effectiveDate),
        invalidDate: formatDate(article.invalidDate),
        lastEditedAt: formatDateTime(article.lastEditedAt),
        lastEmbeddingAt: formatDateTime(article.lastEmbeddingAt),
        createdAt: formatDateTime(article.createdAt),
    }
}

/**
 * 更新法律条文
 * @param id 条文 ID
 * @param data 更新数据
 * @param triggerEmbedding 是否触发重新嵌入（默认 true）
 * @returns 更新后的条文
 */
export async function updateLegalArticleService(
    id: string,
    data: UpdateLegalArticleRequest,
    triggerEmbedding: boolean = true
): Promise<LegalArticleInfo> {
    // 检查是否存在
    const existing = await findLegalArticleByIdDao(id)
    if (!existing) {
        throw new Error(`条文 ${id} 不存在`)
    }

    // 检查内容是否变更（用于判断是否需要重新嵌入）
    const contentChanged = data.content !== undefined && data.content !== existing.content

    const article = await updateLegalArticleDao(id, {
        ...(data.type !== undefined && { type: data.type }),
        ...(data.l1 !== undefined && { l1: data.l1 }),
        ...(data.l1I !== undefined && { l1I: data.l1I }),
        ...(data.l2 !== undefined && { l2: data.l2 }),
        ...(data.l2I !== undefined && { l2I: data.l2I }),
        ...(data.l3 !== undefined && { l3: data.l3 }),
        ...(data.l3I !== undefined && { l3I: data.l3I }),
        ...(data.l4 !== undefined && { l4: data.l4 }),
        ...(data.l4I !== undefined && { l4I: data.l4I }),
        ...(data.l5 !== undefined && { l5: data.l5 }),
        ...(data.l5I !== undefined && { l5I: data.l5I }),
        ...(data.order !== undefined && { order: data.order }),
        ...(data.content !== undefined && { content: data.content }),
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

    // 如果内容变更，触发重新嵌入
    if (triggerEmbedding && contentChanged) {
        try {
            await embedSingleArticle(article.id)
        } catch (error) {
            logger.error(`条文 ${article.id} 重新嵌入失败:`, error)
            // 嵌入失败不影响更新结果
        }
    }

    return {
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
        publishDate: formatDate(article.publishDate),
        effectiveDate: formatDate(article.effectiveDate),
        invalidDate: formatDate(article.invalidDate),
        lastEditedAt: formatDateTime(article.lastEditedAt),
        lastEmbeddingAt: formatDateTime(article.lastEmbeddingAt),
        createdAt: formatDateTime(article.createdAt),
    }
}

/**
 * 删除法律条文（软删除）
 * @param id 条文 ID
 */
export async function deleteLegalArticleService(id: string): Promise<void> {
    // 检查是否存在
    const existing = await findLegalArticleByIdDao(id)
    if (!existing) {
        throw new Error(`条文 ${id} 不存在`)
    }

    // 删除嵌入记录
    try {
        await deleteEmbeddingsByArticleId(id)
    } catch (error) {
        logger.error(`删除条文 ${id} 的嵌入记录失败:`, error)
        // 嵌入删除失败不影响条文删除
    }

    // 软删除条文
    await deleteLegalArticleDao(id)

    logger.info(`已删除条文: ${id}`)
}

/**
 * 手动触发条文嵌入
 * @param id 条文 ID
 */
export async function triggerArticleEmbeddingService(id: string): Promise<void> {
    // 检查是否存在
    const article = await findLegalArticleWithLegalByIdDao(id)
    if (!article) {
        throw new Error(`条文 ${id} 不存在`)
    }

    // 检查是否有可嵌入的内容（content 或层级标题）
    const hasEmbeddableContent = !!(
        (article.content && article.content.trim()) ||
        article.l1 || article.l2 || article.l3 || article.l4 || article.l5
    )
    if (!hasEmbeddableContent) {
        throw new Error(`条文 ${id} 没有可嵌入的内容（content 和层级标题均为空）`)
    }

    // 触发嵌入
    await embedSingleArticle(id)

    logger.info(`已手动触发条文嵌入: ${id}`)
}


import {
    findLegalArticlesForSortTreeDao,
    batchUpdateLegalArticlesOrderDao,
} from './legalArticles.dao'
import type { SortTreeNode, SortTreeQuery, BatchSortRequest } from '#shared/types/legal'

/**
 * 获取条文标题（用于排序树显示）
 */
function getArticleTitle(article: {
    type: string
    l1: string | null
    l2: string | null
    l3: string | null
    l4: string | null
    l5: string | null
    content: string | null
}): string {
    switch (article.type) {
        case 'l1':
            return article.l1 || '未命名编'
        case 'l2':
            return article.l2 || '未命名分编'
        case 'l3':
            return article.l3 || '未命名章'
        case 'l4':
            return article.l4 || '未命名节'
        case 'l5':
            return article.l5 || (article.content?.slice(0, 30) + '...' || '未命名条')
        case 'notice':
            return '通知: ' + (article.content?.slice(0, 20) || '')
        case 'header':
            return '正文头部'
        case 'footer':
            return '正文尾部'
        case 'annex':
            return '附件'
        default:
            return article.content?.slice(0, 30) || '未命名'
    }
}

/**
 * 获取条文的层级深度
 */
function getArticleDepth(type: string): number {
    const depthMap: Record<string, number> = {
        notice: 0,
        header: 0,
        footer: 0,
        annex: 0,
        l1: 0,
        l2: 1,
        l3: 2,
        l4: 3,
        l5: 4,
    }
    return depthMap[type] ?? 0
}

/**
 * 生成条文的路径键（用于确定父子关系）
 */
function getArticlePathKey(article: {
    type: string
    l1: string | null
    l2: string | null
    l3: string | null
    l4: string | null
    l5: string | null
}): string {
    const parts: string[] = []
    if (article.l1) parts.push(article.l1)
    if (article.l2) parts.push(article.l2)
    if (article.l3) parts.push(article.l3)
    if (article.l4) parts.push(article.l4)
    if (article.l5) parts.push(article.l5)
    return parts.join('/')
}

/**
 * 获取父级路径键
 * 根据条文类型和层级信息，计算其父级的路径
 */
function getParentPathKey(article: {
    type: string
    l1: string | null
    l2: string | null
    l3: string | null
    l4: string | null
}): string {
    const parts: string[] = []
    const type = article.type

    // 根据类型确定父级路径
    // l5（条）的父级可能是 l4（节）或 l3（章）
    if (type === 'l5') {
        if (article.l1) parts.push(article.l1)
        if (article.l2) parts.push(article.l2)
        if (article.l3) parts.push(article.l3)
        if (article.l4) parts.push(article.l4)  // 如果有节，则父级是节
    } else if (type === 'l4') {
        // l4（节）的父级是 l3（章）
        if (article.l1) parts.push(article.l1)
        if (article.l2) parts.push(article.l2)
        if (article.l3) parts.push(article.l3)
    } else if (type === 'l3') {
        // l3（章）的父级是 l2（分编）或 l1（编）
        if (article.l1) parts.push(article.l1)
        if (article.l2) parts.push(article.l2)
    } else if (type === 'l2') {
        // l2（分编）的父级是 l1（编）
        if (article.l1) parts.push(article.l1)
    }

    return parts.join('/')
}

/**
 * 获取排序树
 * @param query 查询参数
 * @returns 排序树节点列表
 */
export async function getSortTreeService(query: SortTreeQuery): Promise<SortTreeNode[]> {
    const { legalId, parentPath, parentType } = query

    logger.info(`获取排序树，legalId: ${legalId}, parentPath: ${parentPath}, parentType: ${parentType}`)

    // 检查法律是否存在
    const legal = await findLegalMainByIdDao(legalId)
    if (!legal) {
        throw new Error(`法律 ${legalId} 不存在`)
    }

    logger.info(`法律存在: ${legal.name}`)

    // 获取所有条文
    const articles = await findLegalArticlesForSortTreeDao(legalId)

    logger.info(`获取到 ${articles.length} 条法律条文`)

    // 如果没有指定父级路径，返回顶层节点
    if (!parentPath && !parentType) {
        const topNodes = buildTopLevelNodes(articles)
        logger.info(`构建了 ${topNodes.length} 个顶层节点`)
        return topNodes
    }

    // 返回指定父级下的子节点
    const childNodes = buildChildNodes(articles, parentPath || '', parentType || 'l1')
    logger.info(`构建了 ${childNodes.length} 个子节点`)
    return childNodes
}

/**
 * 构建顶层节点（自动检测最顶层的层级类型）
 */
function buildTopLevelNodes(articles: Array<{
    id: string
    type: string
    l1: string | null
    l2: string | null
    l3: string | null
    l4: string | null
    l5: string | null
    order: number | null
    content: string | null
}>): SortTreeNode[] {
    const nodes: SortTreeNode[] = []

    // 统计类型分布
    const typeCount = new Map<string, number>()
    for (const article of articles) {
        typeCount.set(article.type, (typeCount.get(article.type) || 0) + 1)
    }
    logger.info(`条文类型分布: ${JSON.stringify(Object.fromEntries(typeCount))}`)

    // 确定最顶层的层级类型（按优先级：l1 > l2 > l3 > l4 > l5）
    let topLevelType: string | null = null
    const hierarchyTypes = ['l1', 'l2', 'l3', 'l4', 'l5']
    for (const type of hierarchyTypes) {
        if (typeCount.has(type)) {
            topLevelType = type
            break
        }
    }

    logger.info(`检测到的顶层类型: ${topLevelType}`)

    // 处理非层级类型（总是作为顶层节点）
    for (const article of articles) {
        if (['notice', 'header', 'footer', 'annex'].includes(article.type)) {
            nodes.push({
                id: article.id,
                type: article.type as ArticleType,
                title: getArticleTitle(article),
                order: article.order,
                childCount: 0,
                depth: 0,
                pathKey: article.id,
            })
        }
    }

    // 如果没有层级类型，直接返回非层级节点
    if (!topLevelType) {
        nodes.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        return nodes
    }

    // 处理层级类型的顶层节点
    const processedKeys = new Set<string>()

    for (const article of articles) {
        if (article.type !== topLevelType) continue

        // 获取该节点的路径键
        const pathKey = getArticlePathKey(article)
        if (processedKeys.has(pathKey)) continue
        processedKeys.add(pathKey)

        // 统计直接子节点数量
        const childCount = countDirectChildren(articles, article)

        nodes.push({
            id: article.id,
            type: article.type as ArticleType,
            title: getArticleTitle(article),
            order: article.order,
            childCount,
            depth: 0,
            pathKey,
        })
    }

    // 按 order 排序
    nodes.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

    return nodes
}

/**
 * 统计直接子节点数量
 */
function countDirectChildren(
    articles: Array<{
        id: string
        type: string
        l1: string | null
        l2: string | null
        l3: string | null
        l4: string | null
        l5: string | null
        order: number | null
        content: string | null
    }>,
    parent: {
        type: string
        l1: string | null
        l2: string | null
        l3: string | null
        l4: string | null
        l5: string | null
    }
): number {
    const parentPath = getArticlePathKey(parent)

    // 确定可能的子类型
    const childTypesMap: Record<string, string[]> = {
        l1: ['l2', 'l3'],
        l2: ['l3'],
        l3: ['l4', 'l5'],
        l4: ['l5'],
    }
    const possibleChildTypes = childTypesMap[parent.type] || []

    let count = 0
    for (const article of articles) {
        if (!possibleChildTypes.includes(article.type)) continue

        const articleParentPath = getParentPathKey(article)
        if (articleParentPath === parentPath) {
            // 检查跳级情况
            if (parent.type === 'l1' && article.type === 'l3' && article.l2) continue
            if (parent.type === 'l3' && article.type === 'l5' && article.l4) continue
            count++
        }
    }

    return count
}

/**
 * 构建子节点
 * 支持跳级情况：如章直接包含条（没有节）
 */
function buildChildNodes(
    articles: Array<{
        id: string
        type: string
        l1: string | null
        l2: string | null
        l3: string | null
        l4: string | null
        l5: string | null
        order: number | null
        content: string | null
    }>,
    parentPath: string,
    parentType: string
): SortTreeNode[] {
    const nodes: SortTreeNode[] = []
    const pathParts = parentPath.split('/').filter(Boolean)

    // 根据父级类型确定可能的子级类型
    // 支持跳级：l1 -> l2 或 l3，l2 -> l3，l3 -> l4 或 l5，l4 -> l5
    const childTypesMap: Record<string, string[]> = {
        l1: ['l2', 'l3'],  // 编下面可能是分编或章
        l2: ['l3'],        // 分编下面是章
        l3: ['l4', 'l5'],  // 章下面可能是节或条
        l4: ['l5'],        // 节下面是条
    }
    const childTypes = childTypesMap[parentType]

    if (!childTypes) return nodes

    // 筛选直接子节点
    for (const article of articles) {
        if (!childTypes.includes(article.type)) continue

        // 检查是否属于指定父级
        const articleParentPath = getParentPathKey(article)
        if (articleParentPath !== parentPath) continue

        // 对于跳级情况，需要额外检查
        // 例如：l1 下的 l3 必须没有 l2
        if (parentType === 'l1' && article.type === 'l3' && article.l2) continue
        // l3 下的 l5 必须没有 l4
        if (parentType === 'l3' && article.type === 'l5' && article.l4) continue

        // 统计该节点下的子节点数量
        const articlePath = getArticlePathKey(article)
        const childTypesForThis = childTypesMap[article.type] || []
        const children = articles.filter(a => {
            if (!childTypesForThis.includes(a.type)) return false
            const aParentPath = getParentPathKey(a)
            return aParentPath === articlePath
        })

        nodes.push({
            id: article.id,
            type: article.type as ArticleType,
            title: getArticleTitle(article),
            order: article.order,
            childCount: children.length,
            depth: getArticleDepth(article.type),
            pathKey: articlePath,
        })
    }

    // 按 order 排序
    nodes.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

    return nodes
}

/**
 * 批量更新条文排序
 * @param request 批量排序请求
 * @returns 更新的条文数量
 */
export async function batchSortArticlesService(request: BatchSortRequest): Promise<number> {
    const { legalId, items } = request

    // 检查法律是否存在
    const legal = await findLegalMainByIdDao(legalId)
    if (!legal) {
        throw new Error(`法律 ${legalId} 不存在`)
    }

    if (!items || items.length === 0) {
        return 0
    }

    // 批量更新排序
    const count = await batchUpdateLegalArticlesOrderDao(items)

    logger.info(`已更新 ${count} 条条文的排序`)

    return count
}
