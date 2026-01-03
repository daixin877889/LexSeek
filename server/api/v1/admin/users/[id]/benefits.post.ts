/**
 * 发放用户权益
 *
 * POST /api/v1/admin/users/:id/benefits
 */

import { z } from 'zod'
import { BenefitSourceType } from '#shared/types/benefit'

/** 请求体验证 */
const bodySchema = z.object({
    benefitId: z.number().int().positive('请选择权益类型'),
    benefitValue: z.string().refine((val) => {
        try {
            const num = BigInt(val)
            return num > 0
        } catch {
            return false
        }
    }, '权益值必须是正整数'),
    effectiveAt: z.string().refine((val) => !isNaN(Date.parse(val)), '生效时间格式无效'),
    expiredAt: z.string().refine((val) => !isNaN(Date.parse(val)), '过期时间格式无效'),
    remark: z.string().max(255, '备注最多255个字符').optional(),
})

export default defineEventHandler(async (event) => {
    // 获取路由参数
    const userId = parseInt(getRouterParam(event, 'id') || '')
    if (isNaN(userId)) {
        return resError(event, 400, '无效的用户ID')
    }

    // 验证请求体
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0].message)
    }

    const { benefitId, benefitValue, effectiveAt, expiredAt, remark } = result.data

    // 验证时间
    const effectiveDate = new Date(effectiveAt)
    const expiredDate = new Date(expiredAt)
    if (expiredDate <= effectiveDate) {
        return resError(event, 400, '过期时间必须晚于生效时间')
    }

    try {
        // 检查用户是否存在
        const user = await prisma.users.findFirst({
            where: { id: userId, deletedAt: null },
        })
        if (!user) {
            return resError(event, 404, '用户不存在')
        }

        // 检查权益是否存在
        const benefit = await prisma.benefits.findFirst({
            where: { id: benefitId, deletedAt: null },
        })
        if (!benefit) {
            return resError(event, 404, '权益类型不存在')
        }

        // 创建用户权益记录
        const userBenefit = await prisma.userBenefits.create({
            data: {
                userId,
                benefitId,
                benefitValue: BigInt(benefitValue),
                sourceType: BenefitSourceType.ADMIN_GIFT,
                effectiveAt: effectiveDate,
                expiredAt: expiredDate,
                remark,
                status: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })

        // 记录审计日志
        const admin = event.context.auth?.user
        logger.info(`管理员 ${admin?.id} 给用户 ${userId} 发放权益：${benefit.name}，值：${benefitValue}`)

        return resSuccess(event, '发放权益成功', {
            id: userBenefit.id,
        })
    } catch (error) {
        logger.error('发放用户权益失败：', error)
        return resError(event, 500, '发放用户权益失败')
    }
})
