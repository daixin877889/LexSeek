/**
 * 获取营销活动列表
 *
 * GET /api/v1/campaigns
 *
 * 返回营销活动列表（分页）
 */
import dayjs from 'dayjs'
import { z } from 'zod'
// import { findAllCampaignsDao } from '~/server/services/campaign/campaign.dao'
import { CampaignType, CampaignStatus, type CampaignInfo } from '#shared/types/campaign'

// 查询参数验证 schema
const querySchema = z.object({
    page: z.string().regex(/^\d+$/).transform(Number).optional().default(1),
    pageSize: z.string().regex(/^\d+$/).transform(Number).optional().default(10),
    type: z.string().regex(/^\d+$/).transform(Number).optional(),
    status: z.string().regex(/^[01]$/).transform(Number).optional(),
})

export default defineEventHandler(async (event) => {
    try {
        // 验证查询参数
        const query = getQuery(event)
        const result = querySchema.safeParse(query)

        if (!result.success) {
            return resError(event, 400, result.error.issues[0].message)
        }

        const { page, pageSize, type, status } = result.data

        // 查询营销活动列表
        const { list, total } = await findAllCampaignsDao({
            page,
            pageSize,
            type: type as CampaignType,
            status: status as CampaignStatus,
        })

        // 转换为响应格式
        const data: CampaignInfo[] = list.map((campaign) => ({
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
        }))

        return resSuccess(event, '获取营销活动列表成功', {
            list: data,
            total,
            page,
            pageSize,
        })
    } catch (error) {
        logger.error('获取营销活动列表失败：', error)
        return resError(event, 500, '获取营销活动列表失败')
    }
})
