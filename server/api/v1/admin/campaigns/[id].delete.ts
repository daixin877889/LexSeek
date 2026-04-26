import { deleteCampaignService } from '~~/server/services/campaign/campaign.service'
/**
 * 删除营销活动（软删除）
 *
 * DELETE /api/v1/admin/campaigns/:id
 */

export default defineEventHandler(async (event) => {
    // 获取路由参数
    const id = parseInt(getRouterParam(event, 'id') || '')
    if (isNaN(id)) {
        return resError(event, 400, '无效的营销活动ID')
    }

    try {
        await deleteCampaignService(id)
        return resSuccess(event, '删除营销活动成功', { deleted: true })
    } catch (error: any) {
        if (error.message === '营销活动不存在') {
            return resError(event, 404, error.message)
        }
        logger.error('删除营销活动失败：', error)
        return resError(event, 500, '删除营销活动失败')
    }
})
