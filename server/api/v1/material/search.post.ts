/**
 * 材料检索
 *
 * POST /api/v1/material/search
 *
 * 在指定案件的材料范围内进行向量相似度搜索
 * Requirements: 12.1.1-12.1.4
 */

import { z } from 'zod'
import { searchCaseMaterialsService } from '~~/server/services/material/materialEmbedding.service'

// 请求体验证
const searchMaterialSchema = z.object({
    /** 案件 ID */
    caseId: z.number({ message: '案件 ID 必须为数字' }).int().positive({ message: '案件 ID 必须为正整数' }),
    /** 查询内容 */
    query: z.string({ message: '查询内容不能为空' }).min(1, { message: '查询内容不能为空' }).max(1000, { message: '查询内容不能超过 1000 个字符' }),
    /** 返回结果数量（默认 5） */
    k: z.number().int().positive().max(20).optional().default(5),
})

export default defineEventHandler(async (event) => {
    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 解析请求体
    const body = await readBody(event)
    const result = searchMaterialSchema.safeParse(body)

    if (!result.success) {
        return resError(event, 400, parseErrorMessage(result.error, '参数验证失败'))
    }

    const { caseId, query, k } = result.data

    try {
        // 验证案件是否属于当前用户
        const caseRecord = await prisma.cases.findFirst({
            where: { id: caseId, userId: user.id, deletedAt: null },
        })

        if (!caseRecord) {
            return resError(event, 404, '案件不存在或无权访问')
        }

        // 执行材料检索
        const searchResults = await searchCaseMaterialsService(user.id, caseId, query, k)

        logger.info('材料检索成功', {
            caseId,
            query: query.substring(0, 50),
            resultCount: searchResults.length,
            userId: user.id,
        })

        return resSuccess(event, '检索成功', {
            results: searchResults.map((item, index) => ({
                index: index + 1,
                content: item.content,
                sourceId: item.sourceId,
                sourceName: item.sourceName,
                score: Number(item.score.toFixed(4)),
                chunkIndex: item.chunkIndex,
            })),
            total: searchResults.length,
        })
    } catch (error: any) {
        logger.error('材料检索失败', {
            caseId,
            query: query.substring(0, 50),
            userId: user.id,
            error: error.message,
        })
        return resError(event, 500, error.message || '材料检索失败')
    }
})
