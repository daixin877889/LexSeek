/**
 * 批量保存法律条文 API
 * 
 * POST /api/v1/admin/legal-articles/batch-save
 * 
 * 功能：
 * 1. 更新法律法规的 content 字段
 * 2. 删除该法律法规的所有旧条文（软删除）
 * 3. 批量创建新条文
 * 4. 触发向量化任务
 */

import { z } from 'zod'

/**
 * 请求参数验证 Schema
 */
const BatchSaveSchema = z.object({
    /** 法律法规 ID */
    legalId: z.string().uuid('法律法规 ID 格式不正确'),
    /** 法律法规内容（Markdown 格式） */
    content: z.string().min(1, '法律内容不能为空'),
})

export default defineEventHandler(async (event) => {
    // 验证用户权限
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    try {
        // 读取并验证请求参数
        const body = await readBody(event)
        const validationResult = BatchSaveSchema.safeParse(body)

        if (!validationResult.success) {
            const firstError = validationResult.error.issues[0]
            return resError(event, 400, firstError.message)
        }

        const { legalId, content } = validationResult.data

        // 获取法律法规信息（日期字段）
        const legalMain = await prisma.legalMain.findUnique({
            where: { id: legalId },
            select: {
                id: true,
                publishDate: true,
                effectiveDate: true,
                invalidDate: true,
            },
        })

        if (!legalMain) {
            return resError(event, 404, '法律法规不存在')
        }

        // 解析法律内容
        let articles
        try {
            articles = parseContent(content)
        } catch (error) {
            logger.error('解析法律内容失败', { legalId, error })
            return resError(event, 400, `解析法律内容失败: ${error instanceof Error ? error.message : '未知错误'}`)
        }

        if (articles.length === 0) {
            return resError(event, 400, '解析结果为空，请检查内容格式')
        }

        // 批量保存条文（事务操作）
        try {
            await batchSaveArticles({
                legalId,
                content,
                articles,
                publishDate: legalMain.publishDate,
                effectiveDate: legalMain.effectiveDate,
                invalidDate: legalMain.invalidDate,
            })
        } catch (error) {
            logger.error('批量保存条文失败', { legalId, error })
            return resError(event, 500, `批量保存条文失败: ${error instanceof Error ? error.message : '未知错误'}`)
        }

        // 触发向量化任务（异步执行，失败不影响保存结果）
        try {
            // 调用批量向量化 API
            await $fetch('/api/v1/admin/legal-articles/batch-embed', {
                method: 'POST',
                body: { legalId },
                // 使用内部请求，不需要认证
                headers: {
                    'x-internal-request': 'true',
                },
            })

            logger.info('触发向量化任务成功', { legalId })
        } catch (error) {
            // 向量化失败不影响保存结果，只记录日志
            logger.error('触发向量化任务失败', { legalId, error })
        }

        return resSuccess(event, '保存成功', {
            legalId,
            articleCount: articles.length,
        })
    } catch (error) {
        logger.error('批量保存条文 API 异常', { error })
        return resError(event, 500, '服务器内部错误')
    }
})
