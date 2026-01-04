/**
 * 法律条文服务
 * 
 * 提供条文的批量保存、删除和更新功能
 */

import type { ParsedArticle } from '#shared/types/legal-parser'
import { v7 as uuidv7 } from 'uuid'

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
export async function updateLegalContent(legalId: string, content: string) {
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
export async function deleteArticlesByLegalId(legalId: string) {
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
 * 批量创建条文
 * 
 * @param legalId - 法律法规 ID
 * @param articles - 解析后的条文数组
 * @param publishDate - 发布日期
 * @param effectiveDate - 生效日期
 * @param invalidDate - 失效日期
 * @returns 创建的条文数组
 */
export async function createArticles(
    legalId: string,
    articles: ParsedArticle[],
    publishDate: Date | null,
    effectiveDate: Date | null,
    invalidDate: Date | null
) {
    const now = new Date()

    // 构建批量插入数据
    const data = articles.map((article, index) => ({
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

    // 批量插入
    await prisma.legalArticles.createMany({
        data,
    })

    return data
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
export async function batchSaveArticles(params: BatchSaveArticlesParams) {
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
            const now = new Date()
            const data = articles.map((article, index) => ({
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
