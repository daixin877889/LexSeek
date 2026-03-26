/**
 * 更新嵌入记录元数据
 * PUT /api/v1/admin/law-embeddings/:id
 */
import { z } from 'zod'
import { findEmbeddingByIdDao } from '~~/server/services/legal/lawEmbeddings.dao'
import { getPool } from '~~/server/services/legal/vectorStore.service'
import type { LawEmbeddingInfo } from '#shared/types/legal'

// 请求体验证
const bodySchema = z.object({
    isValid: z.boolean().optional(),
    invalidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})

export default defineEventHandler(async (event) => {
    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 获取路由参数
    const id = getRouterParam(event, 'id')
    if (!id) {
        return resError(event, 400, '无效的嵌入记录 ID')
    }

    // 解析请求体
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, result.error.issues[0]!!?.message || '参数错误')
    }

    // 检查是否有更新内容
    if (Object.keys(result.data).length === 0) {
        return resError(event, 400, '没有需要更新的内容')
    }

    try {
        // 检查记录是否存在
        const existing = await findEmbeddingByIdDao(id)
        if (!existing) {
            return resError(event, 404, '嵌入记录不存在')
        }

        // 构建更新语句（使用数据库的下划线字段名）
        const pool = getPool()
        const setClauses: string[] = []
        const params: (string | null)[] = [id]
        let paramIndex = 2

        if (result.data.invalidDate !== undefined) {
            setClauses.push(`metadata = jsonb_set(metadata, '{invalid_date}', $${paramIndex}::jsonb)`)
            params.push(JSON.stringify(result.data.invalidDate))
            paramIndex++
        }

        if (setClauses.length === 0) {
            return resError(event, 400, '没有需要更新的内容')
        }

        const query = `
            UPDATE law_embeddings 
            SET ${setClauses.join(', ')}
            WHERE id = $1
            RETURNING id, text, metadata
        `
        const updateResult = await pool.query(query, params)
        const row = updateResult.rows[0]

        if (!row) {
            return resError(event, 500, '更新失败')
        }

        // 直接返回数据库中的 snake_case 格式数据
        const info: LawEmbeddingInfo = {
            id: row.id,
            text: row.text,
            metadata: row.metadata,
            lastEmbeddingAt: row.metadata?.last_embedding_at || null,
        }

        logger.info(`用户 ${user.id} 更新了嵌入记录元数据: ${id}`)
        return resSuccess(event, '更新成功', info)
    } catch (error) {
        const message = error instanceof Error ? error.message : '更新失败'
        logger.error(`更新嵌入元数据失败: ${message}`)
        return resError(event, 500, message)
    }
})
