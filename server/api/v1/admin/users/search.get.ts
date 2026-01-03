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

export default defineEventHandler(async (event) => {
    // 验证查询参数
    const query = getQuery(event)
    const result = querySchema.safeParse(query)
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0].message)
    }

    const { keyword } = result.data

    try {
        // 构建查询条件：支持用户ID、手机号或姓名搜索
        const where: Prisma.usersWhereInput = {
            deletedAt: null,
            OR: [
                // 如果是数字，按ID搜索
                ...(isNaN(parseInt(keyword)) ? [] : [{ id: parseInt(keyword) }]),
                // 按手机号搜索
                { phone: { contains: keyword } },
                // 按姓名模糊搜索
                { name: { contains: keyword } },
            ],
        }

        // 查询用户（最多返回10条）
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
