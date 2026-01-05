/**
 * 获取营销活动列表
 *
 * GET /api/v1/admin/campaigns
 */

import { z } from 'zod'
import { CampaignType, CampaignStatus } from '#shared/types/campaign'

/** 查询参数验证 */
const querySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    type: z.coerce.number().int().optional(),
    status: z.coerce.number().int().optional(),
})

export default defineEventHandler(async (event) => {
    // 验证查询参数
    const query = getQuery(event)
    const result = querySchema.safeParse(query)
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0].message)
    }

    const { page, pageSize, type, status } = result.data

    try {
        const data = await getCampaignsForAdminService({
            page,
            pageSize,
            type: type as CampaignType | undefined,
            status: status as CampaignStatus | undefined,
        })

        return resSuccess(event, '获取营销活动列表成功', {
            items: data.list,
            total: data.total,
            totalPages: Math.ceil(data.total / pageSize),
        })
    } catch (error) {
        logger.error('获取营销活动列表失败：', error)
        return resError(event, 500, '获取营销活动列表失败')
    }
})
