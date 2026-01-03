/**
 * 更新权益类型
 *
 * PUT /api/v1/admin/benefits/:id
 */

import { z } from 'zod'
import { BenefitUnitType, BenefitConsumptionMode } from '#shared/types/benefit'

/** 请求体验证 */
const bodySchema = z.object({
    name: z.string().min(1, '名称不能为空').max(100, '名称最多100个字符'),
    description: z.string().max(255, '描述最多255个字符').optional().nullable(),
    unitType: z.enum([BenefitUnitType.BYTE, BenefitUnitType.COUNT], {
        errorMap: () => ({ message: '单位类型无效' }),
    }),
    consumptionMode: z.enum([BenefitConsumptionMode.SUM, BenefitConsumptionMode.MAX], {
        errorMap: () => ({ message: '计算模式无效' }),
    }),
    defaultValue: z.string().refine((val) => {
        try {
            const num = BigInt(val)
            return num >= 0
        } catch {
            return false
        }
    }, '默认值必须是非负整数'),
})

export default defineEventHandler(async (event) => {
    // 获取路由参数
    const id = parseInt(getRouterParam(event, 'id') || '')
    if (isNaN(id)) {
        return resError(event, 400, '无效的权益ID')
    }

    // 验证请求体
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0].message)
    }

    const { name, description, unitType, consumptionMode, defaultValue } = result.data

    try {
        // 检查权益是否存在
        const existing = await prisma.benefits.findFirst({
            where: { id, deletedAt: null },
        })
        if (!existing) {
            return resError(event, 404, '权益不存在')
        }

        // 更新权益
        const benefit = await prisma.benefits.update({
            where: { id },
            data: {
                name,
                description,
                unitType,
                consumptionMode,
                defaultValue: BigInt(defaultValue),
                updatedAt: new Date(),
            },
        })

        return resSuccess(event, '更新权益成功', {
            id: benefit.id,
            code: benefit.code,
            name: benefit.name,
        })
    } catch (error) {
        logger.error('更新权益失败：', error)
        return resError(event, 500, '更新权益失败')
    }
})
