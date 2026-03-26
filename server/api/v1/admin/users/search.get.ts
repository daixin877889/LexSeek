/**
 * 搜索用户（用于权益发放）
 *
 * GET /api/v1/admin/users/search
 */

import { z } from 'zod'
import type { Prisma } from '~~/generated/prisma/client'

/** 查询参数验证 */
const querySchema = z.object({
    keyword: z.string().min(1, '请输入搜索关键词'),
})

/** int32 最大值 */
const MAX_INT32 = 2147483647

/** 验证是否为用户 ID（正整数且在安全范围内） */
function isValidUserId(value: string): boolean {
    // 必须是纯数字字符串
    if (!/^\d+$/.test(value)) return false
    const num = Number(value)
    // 检查是否为有效数字且在 int32 范围内
    return !isNaN(num) && num > 0 && num <= MAX_INT32 && String(num) === value
}

export default defineEventHandler(async (event) => {
    // 验证查询参数
    const query = getQuery(event)
    const result = querySchema.safeParse(query)
    if (!result.success) {
        const firstError = result.error.issues[0]!!
        return resError(event, 400, '参数错误：' + (firstError?.message || '未知错误'))
    }

    const { keyword } = result.data

    try {
        // 构建查询条件：支持用户 ID、手机号或姓名搜索
        const where: Prisma.usersWhereInput = {
            deletedAt: null,
            OR: [
                // 如果是有效的数字 ID（且在安全范围内），按 ID 搜索
                ...(isValidUserId(keyword) ? [{ id: Number(keyword) }] : []),
                // 按手机号搜索
                { phone: { contains: keyword } },
                // 按姓名模糊搜索
                { name: { contains: keyword } },
            ],
        }

        // 查询用户（最多返回 10 条）
        const users = await prisma.users.findMany({
            where,
            take: 10,
            select: {
                id: true,
                phone: true,
                name: true,
            },
            orderBy: { id: 'desc' },
        })

        return resSuccess(event, '搜索成功', { users })
    } catch (error) {
        logger.error('搜索用户失败：', error)
        return resError(event, 500, '搜索用户失败')
    }
})
