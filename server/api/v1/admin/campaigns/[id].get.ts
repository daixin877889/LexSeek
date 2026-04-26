import { getCampaignByIdService } from '~~/server/services/campaign/campaign.service'
/**
 * 获取营销活动详情
 *
 * GET /api/v1/admin/campaigns/:id
 */

export default defineEventHandler(async (event) => {
    // 获取路由参数
    const id = parseInt(getRouterParam(event, 'id') || '')
    if (isNaN(id)) {
        return resError(event, 400, '无效的营销活动ID')
    }

    try {
        const campaign = await getCampaignByIdService(id)
        if (!campaign) {
            return resError(event, 404, '营销活动不存在')
        }

        return resSuccess(event, '获取营销活动详情成功', campaign)
    } catch (error) {
        logger.error('获取营销活动详情失败：', error)
        return resError(event, 500, '获取营销活动详情失败')
    }
})
