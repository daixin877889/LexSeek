/**
 * 更新会员级别权益配置
 *
 * PUT /api/v1/admin/membership-benefits/:levelId
 */

import { z } from 'zod'
import type { benefits } from '~~/generated/prisma/client'

/** 请求体验证 */
const bodySchema = z.object({
    benefits: z.array(z.object({
        benefitId: z.number({ message: '权益ID必须是数字' }).int('权益ID必须是整数').positive('权益ID必须是正整数'),
        benefitValue: z.string({ message: '权益值不能为空' }).refine((val) => {
            try {
                const num = BigInt(val)
                return num >= 0
            } catch {
                return false
            }
        }, '权益值必须是非负整数'),
    })),
})

export default defineEventHandler(async (event) => {
    // 获取路由参数
    const levelId = parseInt(getRouterParam(event, 'levelId') || '')
    if (isNaN(levelId)) {
        return resError(event, 400, '无效的会员级别ID')
    }

    // 验证请求体
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0]!!.message)
    }

    const { benefits } = result.data

    try {
        // 检查会员级别是否存在
        const level = await prisma.membershipLevels.findFirst({
            where: { id: levelId, deletedAt: null },
        })
        if (!level) {
            return resError(event, 404, '会员级别不存在')
        }

        // 使用事务更新权益配置（批量预查避免循环内 N+1）
        const benefitIds = benefits.map(b => b.benefitId)

        await prisma.$transaction(async (tx) => {
            const validBenefits = await tx.benefits.findMany({
                where: { id: { in: benefitIds }, deletedAt: null },
                select: { id: true },
            })
            const validBenefitIds = new Set(validBenefits.map(b => b.id))
            for (const item of benefits) {
                if (!validBenefitIds.has(item.benefitId)) {
                    throw new Error(`权益ID ${item.benefitId} 不存在`)
                }
            }

            const existingConfigs = await tx.membershipBenefits.findMany({
                where: { levelId, benefitId: { in: benefitIds }, deletedAt: null },
            })
            const existingMap = new Map(existingConfigs.map(c => [c.benefitId, c]))

            const now = new Date()
            const toCreate = []
            for (const item of benefits) {
                const existing = existingMap.get(item.benefitId)
                if (existing) {
                    await tx.membershipBenefits.update({
                        where: { id: existing.id },
                        data: {
                            benefitValue: BigInt(item.benefitValue),
                            updatedAt: now,
                        },
                    })
                } else {
                    toCreate.push({
                        levelId,
                        benefitId: item.benefitId,
                        benefitValue: BigInt(item.benefitValue),
                        createdAt: now,
                        updatedAt: now,
                    })
                }
            }
            if (toCreate.length > 0) {
                await tx.membershipBenefits.createMany({ data: toCreate })
            }
        })

        return resSuccess(event, '更新会员权益配置成功', null)
    } catch (error) {
        logger.error('更新会员权益配置失败：', error)
        return resError(event, 500, '更新会员权益配置失败')
    }
})
