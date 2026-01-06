/**
 * 法律法规统计 API
 * GET /api/v1/legal/statistics
 * 
 * 返回法律法规的分类统计信息
 */

import dayjs from 'dayjs'
import type { LegalStatisticsResponse } from '#shared/types/legal-search'

export default defineEventHandler(async (event) => {
    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    try {
        // 获取当前日期（用于判断有效性）
        const today = dayjs().format('YYYY-MM-DD')

        // 按类型统计
        const typeStats = await prisma.legalMain.groupBy({
            by: ['type'],
            where: {
                deletedAt: null,
            },
            _count: {
                id: true,
            },
        })

        // 构建类型统计对象
        const byType = {
            law: 0,
            regulation: 0,
            judicial_interp: 0,
            guideline: 0,
        }

        for (const stat of typeStats) {
            if (stat.type in byType) {
                byType[stat.type as keyof typeof byType] = stat._count.id
            }
        }

        // 统计有效法律数量（已生效且未失效）
        const validCount = await prisma.legalMain.count({
            where: {
                deletedAt: null,
                OR: [
                    { effectiveDate: null },
                    { effectiveDate: { lte: new Date(today) } },
                ],
                AND: [
                    {
                        OR: [
                            { invalidDate: null },
                            { invalidDate: { gt: new Date(today) } },
                        ],
                    },
                ],
            },
        })

        // 统计已失效法律数量
        const invalidCount = await prisma.legalMain.count({
            where: {
                deletedAt: null,
                invalidDate: {
                    not: null,
                    lte: new Date(today),
                },
            },
        })

        // 计算总数
        const total = byType.law + byType.regulation + byType.judicial_interp + byType.guideline

        const statistics: LegalStatisticsResponse = {
            total,
            byType,
            byStatus: {
                valid: validCount,
                invalid: invalidCount,
            },
        }

        return resSuccess(event, '获取统计成功', statistics)
    } catch (error) {
        logger.error('获取法律法规统计失败:', error)
        return resError(event, 500, '获取统计失败')
    }
})
