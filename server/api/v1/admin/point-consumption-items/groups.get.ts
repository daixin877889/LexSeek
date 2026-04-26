import { getAllGroupsService } from '~~/server/services/point/pointConsumptionItems.service'
/**
 * 获取积分消耗项目分组列表
 *
 * GET /api/v1/admin/point-consumption-items/groups
 * Requirements: 17.3
 */

export default defineEventHandler(async (event) => {
    try {
        const groups = await getAllGroupsService()
        return resSuccess(event, '获取积分消耗项目分组列表成功', groups)
    } catch (error) {
        logger.error('获取积分消耗项目分组列表失败：', error)
        return resError(event, 500, '获取积分消耗项目分组列表失败')
    }
})
