/**
 * 切换营销活动状态
 *
 * PATCH /api/v1/admin/campaigns/:id/status
 */

export default defineEventHandler(async (event) => {
    // 获取路由参数
    const id = parseInt(getRouterParam(event, 'id') || '')
    if (isNaN(id)) {
        return resError(event, 400, '无效的营销活动ID')
    }

    try {
        const campaign = await toggleCampaignStatusService(id)
        return resSuccess(event, '切换营销活动状态成功', campaign)
    } catch (error: any) {
        if (error.message === '营销活动不存在') {
            return resError(event, 404, error.message)
        }
        logger.error('切换营销活动状态失败：', error)
        return resError(event, 500, '切换营销活动状态失败')
    }
})
