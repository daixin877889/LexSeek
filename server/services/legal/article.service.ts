/**
 * 法律条文服务层
 *
 * 提供条文的批量保存、删除和更新功能
 * 数据库操作委托给 DAO 层
 */

import type { ParsedArticle } from '#shared/types/legal-parser'
import {
    updateLegalContentDao,
    deleteArticlesByLegalIdDao,
    createArticlesDao,
    buildArticlesDataDao,
} from './article.dao'

/**
 * 批量保存条文的参数
 */
export interface BatchSaveArticlesParams {
    /** 法律法规 ID */
    legalId: string
    /** 法律法规内容（Markdown 格式） */
    content: string
    /** 解析后的条文数组 */
    articles: ParsedArticle[]
    /** 发布日期 */
    publishDate: Date | null
    /** 生效日期 */
    effectiveDate: Date | null
    /** 失效日期 */
    invalidDate: Date | null
}

/**
 * 更新法律法规的内容字段
 *
 * @param legalId - 法律法规 ID
 * @param content - 法律法规内容（Markdown 格式）
 * @returns 更新后的法律法规对象
 */
export async function updateLegalContentService(legalId: string, content: string) {
    return await updateLegalContentDao(legalId, content)
}

/**
 * 删除指定法律法规的所有条文（软删除）
 *
 * @param legalId - 法律法规 ID
 * @returns 删除的条文数量
 */
export async function deleteArticlesByLegalIdService(legalId: string) {
    return await deleteArticlesByLegalIdDao(legalId)
}

/**
 * 批量创建条文
 *
 * @param legalId - 法律法规 ID
 * @param articles - 解析后的条文数组
 * @param publishDate - 发布日期
 * @param effectiveDate - 生效日期
 * @param invalidDate - 失效日期
 * @returns 创建的条文数组
 */
export async function createArticlesService(
    legalId: string,
    articles: ParsedArticle[],
    publishDate: Date | null,
    effectiveDate: Date | null,
    invalidDate: Date | null
) {
    return await createArticlesDao(legalId, articles, publishDate, effectiveDate, invalidDate)
}

/**
 * 批量保存条文（事务操作）
 *
 * 执行步骤：
 * 1. 更新法律法规的 content 字段
 * 2. 软删除该法律法规的所有旧条文
 * 3. 批量创建新条文
 *
 * @param params - 批量保存参数
 * @returns 创建的条文数组
 * @throws 事务失败时抛出错误
 */
export async function batchSaveArticlesService(params: BatchSaveArticlesParams) {
    const { legalId, content, articles, publishDate, effectiveDate, invalidDate } = params

    try {
        // 使用事务确保原子性
        const result = await prisma.$transaction(async (tx) => {
            // 1. 更新法律法规的 content 字段
            await tx.legalMain.update({
                where: { id: legalId },
                data: {
                    content,
                    lastEditedAt: new Date(),
                },
            })

            // 2. 软删除该法律法规的所有旧条文
            await tx.legalArticles.updateMany({
                where: {
                    legalId,
                    deletedAt: null,
                },
                data: {
                    deletedAt: new Date(),
                },
            })

            // 3. 批量创建新条文
            const data = buildArticlesDataDao(
                legalId,
                articles,
                publishDate,
                effectiveDate,
                invalidDate
            )

            await tx.legalArticles.createMany({
                data,
            })

            return data
        })

        logger.info('批量保存条文成功', { legalId, count: articles.length })
        return result
    } catch (error) {
        logger.error('批量保存条文失败', { legalId, error })
        throw new Error(`批量保存条文失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
}
