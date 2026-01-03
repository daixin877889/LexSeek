/**
 * 更新会员级别权益配置
 *
 * PUT /api/v1/admin/membership-benefits/:levelId
 */

import { z } from 'zod'

/** 请求体验证 */
const bodySchema = z.object({
    benefits: z.array(z.object({
        benefitId: z.number().int().positive(),
        benefitValue: z.string().refine((val) => {
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
        return resError(event, 400, '参数错误：' + result.error.issues[0].message)
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

        // 使用事务更新权益配置
        await prisma.$transaction(async (tx) => {
            for (const item of benefits) {
                // 检查权益是否存在
                const benefit = await tx.benefits.findFirst({
                    where: { id: item.benefitId, deletedAt: null },
                })
                if (!benefit) {
                    throw new Error(`权益ID ${item.benefitId} 不存在`)
                }

                // 查找现有配置
                const existing = await tx.membershipBenefits.findFirst({
                    where: { levelId, benefitId: item.benefitId, deletedAt: null },
                })

                if (existing) {
                    // 更新现有配置
                    await tx.membershipBenefits.update({
                        where: { id: existing.id },
                        data: {
                            benefitValue: BigInt(item.benefitValue),
                            updatedAt: new Date(),
                        },
                    })
                } else {
                    // 创建新配置
                    await tx.membershipBenefits.create({
                        data: {
                            levelId,
                            benefitId: item.benefitId,
                            benefitValue: BigInt(item.benefitValue),
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        },
                    })
                }
            }
        })

        return resSuccess(event, '更新会员权益配置成功', null)
    } catch (error) {
        logger.error('更新会员权益配置失败：', error)
        return resError(event, 500, '更新会员权益配置失败')
    }
})
