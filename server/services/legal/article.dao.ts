/**
 * 法律条文 DAO 层
 *
 * 提供条文的数据库操作
 */

import type { ParsedArticle } from '#shared/types/legal-parser'
import { v7 as uuidv7 } from 'uuid'

/**
 * 更新法律法规的内容字段
 *
 * @param legalId - 法律法规 ID
 * @param content - 法律法规内容（Markdown 格式）
 * @returns 更新后的法律法规对象
 */
export async function updateLegalContentDao(legalId: string, content: string) {
    return await prisma.legalMain.update({
        where: { id: legalId },
        data: {
            content,
            lastEditedAt: new Date(),
        },
    })
}

/**
 * 删除指定法律法规的所有条文（软删除）
 *
 * @param legalId - 法律法规 ID
 * @returns 删除的条文数量
 */
export async function deleteArticlesByLegalIdDao(legalId: string) {
    const result = await prisma.legalArticles.updateMany({
        where: {
            legalId,
            deletedAt: null,
        },
        data: {
            deletedAt: new Date(),
        },
    })

    return result.count
}

/**
 * 构建条文批量插入数据
 *
 * @param legalId - 法律法规 ID
 * @param articles - 解析后的条文数组
 * @param publishDate - 发布日期
 * @param effectiveDate - 生效日期
 * @param invalidDate - 失效日期
 * @returns 构建好的条文数据数组
 */
export function buildArticlesDataDao(
    legalId: string,
    articles: ParsedArticle[],
    publishDate: Date | null,
    effectiveDate: Date | null,
    invalidDate: Date | null
) {
    const now = new Date()

    return articles.map((article, index) => ({
        id: uuidv7(),
        legalId,
        type: article.type,
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
        content: article.content,
        order: index + 1,
        publishDate,
        effectiveDate,
        invalidDate,
        lastEditedAt: now,
        createdAt: now,
        updatedAt: now,
    }))
}

/**
 * 批量创建条文
 *
 * @param legalId - 法律法规 ID
 * @param articles - 解析后的条文数组
 * @param publishDate - 发布日期
 * @param effectiveDate - 生效日期
 * @param invalidDate - 失效日期
 * @returns 创建的条文数据数组
 */
export async function createArticlesDao(
    legalId: string,
    articles: ParsedArticle[],
    publishDate: Date | null,
    effectiveDate: Date | null,
    invalidDate: Date | null
) {
    const data = buildArticlesDataDao(legalId, articles, publishDate, effectiveDate, invalidDate)

    await prisma.legalArticles.createMany({
        data,
    })

    return data
}
