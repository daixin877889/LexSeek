/**
 * 批量触发条文向量化
 * POST /api/v1/admin/legal-articles/batch-embed
 * 
 * 智能判断是否需要嵌入：
 * - 条文被编辑过（last_edited_at > last_embedding_at）
 * - 或条文没有对应的嵌入记录
 */
import { z } from 'zod'
import { getPool } from '~~/server/services/legal/vectorStore.service'

// 请求体验证
const bodySchema = z.object({
    // 法律 ID（批量处理该法律下所有条文）
    legalId: z.string().optional(),
    // 条文 ID 列表（指定特定条文）
    articleIds: z.array(z.string()).optional(),
    // 是否强制重新嵌入所有条文（默认 false，即智能判断）
    forceAll: z.boolean().default(false),
}).refine(
    data => data.legalId || (data.articleIds && data.articleIds.length > 0),
    { message: '必须指定 legalId 或 articleIds' }
)

export default defineEventHandler(async (event) => {
    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 解析请求体
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, result.error.issues[0]?.message || '参数错误')
    }

    const { legalId, articleIds, forceAll } = result.data

    try {
        // 获取条文列表
        let articles: { id: string; content: string | null; lastEditedAt: Date | null; lastEmbeddingAt: Date | null }[] = []

        if (legalId) {
            articles = await prisma.legalArticles.findMany({
                where: {
                    legalId,
                    deletedAt: null,
                },
                select: {
                    id: true,
                    content: true,
                    lastEditedAt: true,
                    lastEmbeddingAt: true,
                },
            })
        } else if (articleIds && articleIds.length > 0) {
            articles = await prisma.legalArticles.findMany({
                where: {
                    id: { in: articleIds },
                    deletedAt: null,
                },
                select: {
                    id: true,
                    content: true,
                    lastEditedAt: true,
                    lastEmbeddingAt: true,
                },
            })
        }

        // 过滤掉没有内容的条文
        const articlesWithContent = articles.filter(a => a.content && a.content.trim())
        const noContentCount = articles.length - articlesWithContent.length

        // 如果不是强制全部重新嵌入，需要智能判断
        let articlesToEmbed: typeof articlesWithContent = []
        let alreadyUpToDate = 0

        if (forceAll) {
            // 强制模式：嵌入所有有内容的条文
            articlesToEmbed = articlesWithContent
        } else {
            // 智能模式：查询哪些条文已有嵌入记录
            const pool = getPool()
            const articleIdsToCheck = articlesWithContent.map(a => a.id)

            // 查询已存在嵌入记录的条文 ID（元数据使用驼峰命名）
            const embeddedResult = await pool.query(
                `SELECT DISTINCT metadata->>'articleId' as article_id 
                 FROM law_embeddings 
                 WHERE metadata->>'articleId' = ANY($1)`,
                [articleIdsToCheck]
            )
            const embeddedArticleIds = new Set(embeddedResult.rows.map(r => r.article_id))

            for (const article of articlesWithContent) {
                const hasEmbedding = embeddedArticleIds.has(article.id)
                const lastEdited = article.lastEditedAt?.getTime() || 0
                const lastEmbedded = article.lastEmbeddingAt?.getTime() || 0

                // 调试日志
                logger.debug(`条文 ${article.id}: hasEmbedding=${hasEmbedding}, lastEdited=${lastEdited}, lastEmbedded=${lastEmbedded}, needsEmbed=${!hasEmbedding || lastEdited > lastEmbedded}`)

                // 需要嵌入的条件：
                // 1. 没有嵌入记录
                // 2. 或者编辑时间晚于嵌入时间
                if (!hasEmbedding || lastEdited > lastEmbedded) {
                    articlesToEmbed.push(article)
                } else {
                    alreadyUpToDate++
                }
            }
        }

        if (articlesToEmbed.length === 0) {
            return resSuccess(event, '所有条文已是最新，无需重新嵌入', {
                total: articles.length,
                processed: 0,
                skipped: noContentCount,
                upToDate: alreadyUpToDate,
                failed: 0,
            })
        }

        // 批量处理
        let processed = 0
        let failed = 0
        const errors: string[] = []

        for (const article of articlesToEmbed) {
            try {
                await triggerArticleEmbeddingService(article.id)
                processed++
            } catch (error) {
                failed++
                const message = error instanceof Error ? error.message : '未知错误'
                errors.push(`${article.id}: ${message}`)
                logger.error(`批量向量化失败 [${article.id}]: ${message}`)
            }
        }

        logger.info(`用户 ${user.id} 批量向量化完成: 总数=${articles.length}, 成功=${processed}, 跳过(无内容)=${noContentCount}, 已最新=${alreadyUpToDate}, 失败=${failed}`)

        const message = forceAll
            ? `向量化完成：成功 ${processed} 条，跳过 ${noContentCount} 条（无内容），失败 ${failed} 条`
            : `向量化完成：成功 ${processed} 条，已最新 ${alreadyUpToDate} 条，跳过 ${noContentCount} 条（无内容），失败 ${failed} 条`

        return resSuccess(event, message, {
            total: articles.length,
            processed,
            skipped: noContentCount,
            upToDate: alreadyUpToDate,
            failed,
            errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : '批量向量化失败'
        logger.error(`批量向量化失败: ${message}`)
        return resError(event, 500, message)
    }
})
