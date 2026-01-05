/**
 * 法律条文向量嵌入服务
 *
 * 提供法律条文的向量化处理功能，包括：
 * - 构建嵌入文本
 * - 构建元数据
 * - 嵌入单个条文
 * - 删除条文嵌入
 * - 批量更新法律嵌入
 */

import { Document } from '@langchain/core/documents'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { v4 as uuidv4 } from 'uuid'
import dayjs from 'dayjs'
import type { legalMain, legalArticles } from '~~/generated/prisma/client'
import type { LawEmbeddingMetadata, LegalType, ArticleType } from '#shared/types/legal'
import { LegalTypeLabels } from '#shared/types/legal'
import {
    getVectorStore,
    deleteEmbeddingsByMetadata,
    getPool,
} from './vectorStore.service'

// 文本分割配置
const TEXT_CHUNK_SIZE = 2000
const TEXT_CHUNK_OVERLAP = 200

/**
 * 获取法律类型的中文名称
 * @param type 法律类型
 * @returns 中文名称
 */
function getLegalTypeName(type: string): string {
    return LegalTypeLabels[type as LegalType] || '其他'
}

/**
 * 构建层级路径
 * @param article 法律条文
 * @returns 层级路径字符串
 */
export function buildHierarchyPath(article: legalArticles): string {
    const parts: string[] = []
    if (article.l1) parts.push(article.l1)
    if (article.l2) parts.push(article.l2)
    if (article.l3) parts.push(article.l3)
    if (article.l4) parts.push(article.l4)
    if (article.l5) parts.push(article.l5)
    return parts.join(' > ')
}

/**
 * 获取条文的可嵌入文本内容
 * 优先使用 content，如果为空则使用 L5 → L4 → L3 → L2 → L1 中最后一级存在的标题
 * @param article 法律条文
 * @returns 可嵌入的文本内容
 */
export function getEmbeddableContent(article: legalArticles): string {
    // 如果有 content，直接返回
    if (article.content && article.content.trim()) {
        return article.content
    }

    // 否则使用最后一级存在的标题（L5 优先级最高，L1 最低）
    if (article.l5 && article.l5.trim()) return article.l5
    if (article.l4 && article.l4.trim()) return article.l4
    if (article.l3 && article.l3.trim()) return article.l3
    if (article.l2 && article.l2.trim()) return article.l2
    if (article.l1 && article.l1.trim()) return article.l1

    return ''
}

/**
 * 构建嵌入文本
 * @param legal 法律法规
 * @param article 法律条文
 * @returns 嵌入文本
 */
export function buildEmbeddingText(legal: legalMain, article: legalArticles): string {
    const hierarchyPath = buildHierarchyPath(article)
    const embeddableContent = getEmbeddableContent(article)
    return `文件：${legal.name}
类型：${getLegalTypeName(legal.type)}
章节：${hierarchyPath}
内容：${embeddableContent}`
}

/**
 * 构建嵌入元数据
 * @param legal 法律法规
 * @param article 法律条文
 * @returns 嵌入元数据
 */
export function buildEmbeddingMetadata(
    legal: legalMain,
    article: legalArticles
): LawEmbeddingMetadata {
    const hierarchyPath = buildHierarchyPath(article)
    const now = new Date()

    // 判断是否有效（未设置失效日期或失效日期在未来）
    const isValid = !article.invalidDate || new Date(article.invalidDate) > now

    return {
        articleId: article.id,
        legalId: legal.id,
        legalName: legal.name,
        legalCode: legal.code,
        legalType: legal.type as LegalType,
        articleType: article.type as ArticleType,
        hierarchyPath,
        publishDate: article.publishDate
            ? dayjs(article.publishDate).format('YYYY-MM-DD')
            : null,
        effectiveDate: article.effectiveDate
            ? dayjs(article.effectiveDate).format('YYYY-MM-DD')
            : null,
        invalidDate: article.invalidDate
            ? dayjs(article.invalidDate).format('YYYY-MM-DD')
            : null,
        isValid,
    }
}

/**
 * 分割文本为多个文档
 * @param text 原始文本
 * @returns 分割后的文档数组
 */
async function splitText(text: string): Promise<Document[]> {
    const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: TEXT_CHUNK_SIZE,
        chunkOverlap: TEXT_CHUNK_OVERLAP,
    })
    return await splitter.splitDocuments([
        new Document({ pageContent: text }),
    ])
}

/**
 * 嵌入单个法律条文
 * @param legal 法律法规
 * @param article 法律条文
 * @returns 嵌入时间，如果跳过则返回 undefined
 */
export async function embedLawArticle(
    legal: legalMain,
    article: legalArticles
): Promise<string | undefined> {
    // 构建嵌入文本
    const text = buildEmbeddingText(legal, article)

    // 检查是否有可嵌入的内容（content 或层级标题）
    const embeddableContent = getEmbeddableContent(article)
    if (!embeddableContent || embeddableContent.trim().length === 0) {
        logger.warn(`法条 ${article.id} 无可嵌入内容（content 和层级标题均为空），跳过嵌入`)
        return undefined
    }

    // 分割文本
    const documents = await splitText(text)

    // 过滤空文档
    const validDocuments = documents.filter(
        doc => doc.pageContent && doc.pageContent.trim().length > 0
    )

    if (validDocuments.length === 0) {
        logger.warn(`法条 ${article.id} 分割后无有效内容，跳过嵌入`)
        return undefined
    }

    // 构建元数据
    const metadata = buildEmbeddingMetadata(legal, article)
    const embeddingTime = dayjs().format('YYYY-MM-DDTHH:mm:ss+08:00')

    // 为每个文档设置元数据和 ID
    const ids: string[] = []
    validDocuments.forEach(doc => {
        ids.push(uuidv4())
        doc.metadata = {
            ...metadata,
            last_embedding_at: embeddingTime,
        }
    })

    // 获取向量存储并添加文档
    const store = await getVectorStore({
        tableName: 'law_embeddings',
        vectorColumnName: 'embedding',
        contentColumnName: 'text',
        metadataColumnName: 'metadata',
    })

    await store.addDocuments(validDocuments, { ids })
    logger.info(`已嵌入法条 ${article.id}，生成 ${validDocuments.length} 个向量`)

    return embeddingTime
}

/**
 * 删除指定条文的所有嵌入记录
 * @param articleId 条文 ID
 * @returns 删除的记录数
 */
export async function deleteEmbeddingsByArticleId(articleId: string): Promise<number> {
    return await deleteEmbeddingsByMetadata('articleId', articleId, 'law_embeddings')
}

/**
 * 更新法律的所有条文嵌入
 * @param legalId 法律 ID
 */
export async function updateLegalEmbeddings(legalId: string): Promise<void> {
    // 查询法律及其条文
    const legal = await prisma.legalMain.findUnique({
        where: { id: legalId, deletedAt: null },
        include: {
            legalArticles: {
                where: { deletedAt: null },
                orderBy: { order: 'asc' },
            },
        },
    })

    if (!legal) {
        throw new Error(`法律 ID ${legalId} 不存在`)
    }

    // 检查每个条文是否需要更新嵌入
    for (const article of legal.legalArticles) {
        const needsUpdate = await checkArticleNeedsEmbedding(article)

        if (needsUpdate) {
            // 删除旧的嵌入记录
            await deleteEmbeddingsByArticleId(article.id)

            // 创建新的嵌入
            const embeddingTime = await embedLawArticle(legal, article)

            if (embeddingTime) {
                // 更新条文的最后嵌入时间
                await prisma.legalArticles.update({
                    where: { id: article.id },
                    data: { lastEmbeddingAt: new Date() },
                })
                logger.info(`已更新法条嵌入: ${article.id}`)
            }
        }
    }

    // 更新法律的最后嵌入时间
    await prisma.legalMain.update({
        where: { id: legalId },
        data: { lastEmbeddingAt: new Date() },
    })

    logger.info(`完成法律嵌入更新: ${legal.name}`)
}

/**
 * 检查条文是否需要重新嵌入
 * @param article 法律条文
 * @returns 是否需要重新嵌入
 */
async function checkArticleNeedsEmbedding(article: legalArticles): Promise<boolean> {
    // 如果从未嵌入过，需要嵌入
    if (!article.lastEmbeddingAt) {
        return true
    }

    // 如果编辑时间晚于嵌入时间，需要重新嵌入
    if (article.lastEditedAt && article.lastEditedAt > article.lastEmbeddingAt) {
        return true
    }

    // 检查数据库中是否存在嵌入记录
    const pool = getPool()
    const query = `
        SELECT COUNT(*) as count 
        FROM law_embeddings 
        WHERE metadata->>'articleId' = $1
    `
    const result = await pool.query(query, [article.id])
    const count = parseInt(result.rows[0]?.count || '0', 10)

    // 如果没有嵌入记录，需要嵌入
    return count === 0
}

/**
 * 更新法律条文的失效状态到嵌入元数据
 * @param legalId 法律 ID
 * @param invalidDate 失效日期
 */
export async function updateEmbeddingsValidStatus(
    legalId: string,
    invalidDate: Date | null
): Promise<void> {
    const pool = getPool()
    const isValid = !invalidDate || invalidDate > new Date()

    // 更新所有相关嵌入记录的 isValid 字段
    const query = `
        UPDATE law_embeddings 
        SET metadata = jsonb_set(
            jsonb_set(
                metadata,
                '{isValid}',
                $2::jsonb
            ),
            '{invalidDate}',
            $3::jsonb
        )
        WHERE metadata->>'legalId' = $1
    `
    const invalidDateStr = invalidDate
        ? `"${dayjs(invalidDate).format('YYYY-MM-DD')}"`
        : 'null'

    await pool.query(query, [legalId, isValid.toString(), invalidDateStr])
    logger.info(`已更新法律 ${legalId} 的嵌入有效状态: isValid=${isValid}`)
}

/**
 * 嵌入单个条文（用于新建或更新条文时）
 * @param articleId 条文 ID
 */
export async function embedSingleArticle(articleId: string): Promise<void> {
    // 查询条文及其关联的法律
    const article = await prisma.legalArticles.findUnique({
        where: { id: articleId, deletedAt: null },
        include: { legalMain: true },
    })

    if (!article || !article.legalMain) {
        throw new Error(`条文 ID ${articleId} 不存在或已删除`)
    }

    // 删除旧的嵌入记录
    await deleteEmbeddingsByArticleId(articleId)

    // 创建新的嵌入
    const embeddingTime = await embedLawArticle(article.legalMain, article)

    if (embeddingTime) {
        // 更新条文的最后嵌入时间
        await prisma.legalArticles.update({
            where: { id: articleId },
            data: { lastEmbeddingAt: new Date() },
        })
    }
}
