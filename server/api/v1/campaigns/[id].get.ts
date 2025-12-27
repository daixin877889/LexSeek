/**
 * 获取营销活动详情
 *
 * GET /api/v1/campaigns/:id
 *
 * 返回指定 ID 的营销活动详情
 */
import dayjs from 'dayjs'
import { z } from 'zod'
// import { findCampaignByIdDao } from '~/server/services/campaign/campaign.dao'
import { CampaignType, CampaignStatus, type CampaignInfo } from '#shared/types/campaign'

// 参数验证 schema
const paramsSchema = z.object({
    id: z.string().regex(/^\d+$/, 'ID 必须是数字').transform(Number),
})

export default defineEventHandler(async (event) => {
    try {
        // 验证路由参数
        const params = getRouterParams(event)
        const result = paramsSchema.safeParse(params)

        if (!result.success) {
            return resError(event, 400, result.error.issues[0].message)
        }

        const { id } = result.data

        // 查询营销活动
        const campaign = await findCampaignByIdDao(id)

        if (!campaign) {
            return resError(event, 404, '营销活动不存在')
        }

        // 转换为响应格式
        const data: CampaignInfo = {
            id: campaign.id,
            name: campaign.name,
            type: campaign.type as CampaignType,
            levelId: campaign.levelId,
            levelName: campaign.level?.name || null,
            duration: campaign.duration,
            giftPoint: campaign.giftPoint,
            startAt: dayjs(campaign.startAt).format('YYYY-MM-DD HH:mm:ss'),
            endAt: dayjs(campaign.endAt).format('YYYY-MM-DD HH:mm:ss'),
            status: campaign.status as CampaignStatus,
            remark: campaign.remark,
        }

        return resSuccess(event, '获取营销活动详情成功', data)
    } catch (error) {
        logger.error('获取营销活动详情失败：', error)
        return resError(event, 500, '获取营销活动详情失败')
    }
})
