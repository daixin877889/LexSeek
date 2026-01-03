/**
 * 创建权益类型
 *
 * POST /api/v1/admin/benefits
 */

import { z } from 'zod'
import { BenefitUnitType, BenefitConsumptionMode } from '#shared/types/benefit'

/** 请求体验证 */
const bodySchema = z.object({
    code: z.string().min(1, '标识码不能为空').max(50, '标识码最多50个字符')
        .regex(/^[a-z][a-z0-9_]*$/, '标识码只能包含小写字母、数字和下划线，且以字母开头'),
    name: z.string().min(1, '名称不能为空').max(100, '名称最多100个字符'),
    description: z.string().max(255, '描述最多255个字符').optional(),
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
    // 验证请求体
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0].message)
    }

    const { code, name, description, unitType, consumptionMode, defaultValue } = result.data

    try {
        // 检查标识码是否已存在
        const existing = await prisma.benefits.findFirst({
            where: { code, deletedAt: null },
        })
        if (existing) {
            return resError(event, 400, '权益标识码已存在')
        }

        // 创建权益
        const benefit = await prisma.benefits.create({
            data: {
                code,
                name,
                description,
                unitType,
                consumptionMode,
                defaultValue: BigInt(defaultValue),
                status: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })

        return resSuccess(event, '创建权益成功', {
            id: benefit.id,
            code: benefit.code,
            name: benefit.name,
        })
    } catch (error) {
        logger.error('创建权益失败：', error)
        return resError(event, 500, '创建权益失败')
    }
})
