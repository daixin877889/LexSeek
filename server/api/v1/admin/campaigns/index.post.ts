/**
 * 创建营销活动
 *
 * POST /api/v1/admin/campaigns
 */

import { z } from 'zod'
import dayjs from 'dayjs'
import { CampaignType, CampaignStatus } from '#shared/types/campaign'

/** 请求体验证 */
const bodySchema = z.object({
    name: z.string().min(1, '名称不能为空').max(100, '名称最多100个字符'),
    type: z.nativeEnum(CampaignType, { errorMap: () => ({ message: '活动类型无效' }) }),
    levelId: z.number().int().positive('会员级别ID必须为正整数').nullable().optional(),
    duration: z.number().int().min(1, '时长至少为1天').nullable().optional(),
    giftPoint: z.number().int().min(0, '赠送积分不能为负').nullable().optional(),
    startAt: z.string().refine((val) => dayjs(val).isValid(), '开始时间格式无效'),
    endAt: z.string().refine((val) => dayjs(val).isValid(), '结束时间格式无效').nullable().optional(),
    status: z.nativeEnum(CampaignStatus).optional(),
    remark: z.string().max(500, '备注最多500个字符').nullable().optional(),
}).refine((data) => {
    // 如果有结束时间，验证结束时间必须晚于开始时间
    if (data.endAt) {
        return dayjs(data.endAt).isAfter(dayjs(data.startAt))
    }
    return true
}, { message: '结束时间必须晚于开始时间', path: ['endAt'] })

export default defineEventHandler(async (event) => {
    // 验证请求体
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0].message)
    }

    const { name, type, levelId, duration, giftPoint, startAt, endAt, status, remark } = result.data

    try {
        const campaign = await createCampaignService({
            name,
            type,
            levelId: levelId ?? null,
            duration: duration ?? null,
            giftPoint: giftPoint ?? null,
            startAt: dayjs(startAt).toDate(),
            endAt: endAt ? dayjs(endAt).toDate() : null,
            status,
            remark: remark ?? null,
        })

        return resSuccess(event, '创建营销活动成功', campaign)
    } catch (error) {
        logger.error('创建营销活动失败：', error)
        return resError(event, 500, '创建营销活动失败')
    }
})
