/**
 * 发文机关列表 API
 * GET /api/v1/legal/issuing-authorities
 *
 * 返回去重后的发文机关列表，用于筛选下拉框
 * 支持将多个发文机关按逗号分割后去重（兼容全角和半角逗号）
 */

import type { IssuingAuthoritiesResponse } from '#shared/types/legal-search'

export default defineEventHandler(async (event) => {
    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    try {
        // 查询所有不为空的发文机关
        const authorities = await prisma.legalMain.findMany({
            where: {
                deletedAt: null,
                issuingAuthority: {
                    not: null,
                },
            },
            select: {
                issuingAuthority: true,
            },
        })

        // 使用 Set 去重
        const uniqueAuthorities = new Set<string>()

        // 遍历所有发文机关，按逗号分割后去重
        for (const item of authorities) {
            if (item.issuingAuthority) {
                // 使用正则匹配全角逗号（，）和半角逗号（,）进行分割
                const parts = item.issuingAuthority.split(/[,，]/)
                for (const part of parts) {
                    const trimmed = part.trim()
                    if (trimmed.length > 0) {
                        uniqueAuthorities.add(trimmed)
                    }
                }
            }
        }

        // 转换为数组并排序
        const items = Array.from(uniqueAuthorities).sort((a, b) => a.localeCompare(b, 'zh-CN'))

        // 格式化响应
        const response: IssuingAuthoritiesResponse = {
            items,
        }

        return resSuccess(event, '获取发文机关列表成功', response)
    } catch (error) {
        logger.error('获取发文机关列表失败:', error)
        return resError(event, 500, '获取发文机关列表失败')
    }
})