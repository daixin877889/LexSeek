/**
 * 更新营销活动
 *
 * PUT /api/v1/admin/campaigns/:id
 */

import { z } from 'zod'
import dayjs from 'dayjs'
import { CampaignType, CampaignStatus } from '#shared/types/campaign'

/** 请求体验证 */
const bodySchema = z.object({
    name: z.string().min(1, '名称不能为空').max(100, '名称最多100个字符').optional(),
    type: z.nativeEnum(CampaignType, { errorMap: () => ({ message: '活动类型无效' }) }).optional(),
    levelId: z.number().int().positive('会员级别ID必须为正整数').nullable().optional(),
    duration: z.number().int().min(1, '时长至少为1天').nullable().optional(),
    giftPoint: z.number().int().min(0, '赠送积分不能为负').nullable().optional(),
    startAt: z.string().refine((val) => dayjs(val).isValid(), '开始时间格式无效').optional(),
    endAt: z.string().refine((val) => dayjs(val).isValid(), '结束时间格式无效').nullable().optional(),
    status: z.nativeEnum(CampaignStatus).optional(),
    remark: z.string().max(500, '备注最多500个字符').nullable().optional(),
})

export default defineEventHandler(async (event) => {
    // 获取路由参数
    const id = parseInt(getRouterParam(event, 'id') || '')
    if (isNaN(id)) {
        return resError(event, 400, '无效的营销活动ID')
    }

    // 验证请求体
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0].message)
    }

    const { name, type, levelId, duration, giftPoint, startAt, endAt, status, remark } = result.data

    try {
        // 构建更新参数
        const updateParams: any = {}
        if (name !== undefined) updateParams.name = name
        if (type !== undefined) updateParams.type = type
        if (levelId !== undefined) updateParams.levelId = levelId
        if (duration !== undefined) updateParams.duration = duration
        if (giftPoint !== undefined) updateParams.giftPoint = giftPoint
        if (startAt !== undefined) updateParams.startAt = dayjs(startAt).toDate()
        if (endAt !== undefined) updateParams.endAt = endAt ? dayjs(endAt).toDate() : null
        if (status !== undefined) updateParams.status = status
        if (remark !== undefined) updateParams.remark = remark

        const campaign = await updateCampaignService(id, updateParams)
        return resSuccess(event, '更新营销活动成功', campaign)
    } catch (error: any) {
        if (error.message === '营销活动不存在') {
            return resError(event, 404, error.message)
        }
        logger.error('更新营销活动失败：', error)
        return resError(event, 500, '更新营销活动失败')
    }
})
